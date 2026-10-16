import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadJson } from './load.mjs';
import { relativeRepoPath } from './paths.mjs';
import * as Surface from '@kontourai/surface';
import {
  buildApprovalResolverRequest,
  summarizeApprovalResolverResult,
} from './approval-resolvers.mjs';
import {
  isAuthorityBackedApproval,
  rejectNonHumanActor,
  requireHumanApprovalReference,
  validateApprovalReferencePolicy,
} from './attestations/approval.mjs';
export {
  hashProtectedStandards,
  REPO_MAP_HASH_ALGORITHM,
  resolveProtectedStandardsPaths,
} from './attestations/protected-standards.mjs';
import {
  describeNonRegularProtectedStandardsEntries,
  hashProtectedStandards,
  inspectProtectedStandards,
  matchesLegacyRepoMapHash,
  REPO_MAP_HASH_ALGORITHM,
  sha256Hex,
} from './attestations/protected-standards.mjs';
import { computeAdmissibilityWarning } from './attestations/collection.mjs';
import {
  bindAttestationRecordIntegrity,
  verifyAttestationRecordIntegrity,
} from './attestations/record-integrity.mjs';

const DEFAULT_VALID_UNTIL_DAYS = 90;
const ATTESTATIONS_DIR = '.veritas/attestations';
const HEAD_FILE = 'HEAD';
const PENDING_FILE = 'PENDING';
const LEGACY_ATTESTATION_REFERENCE_PREFIX = 'legacy-attestation-v0';
const UNRESOLVED_ATTESTATION_REFERENCE = 'attestation-reference-unavailable';

function isLegacyRepoMapHash(attestation) {
  return attestation.repoMapHashAlgorithm !== REPO_MAP_HASH_ALGORITHM;
}

function stripLegacyRepoMapHashes(value) {
  if (Array.isArray(value)) return value.map(stripLegacyRepoMapHashes);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'repoMapHash' && key !== 'surface')
    .map(([key, child]) => [key, stripLegacyRepoMapHashes(child)]));
}

function legacyAttestationReference(attestation) {
  // Historical IDs were derived from the raw Repo Map file digest. Never
  // transform that ID directly: even a one-way digest would let callers test
  // candidate low-entropy runtime values offline. This replacement uses only
  // fields that were already safe to publish and deliberately remains stable
  // across historical records which differ solely in their raw file hash.
  const safeIdentity = {
    actorId: typeof attestation.actor?.id === 'string' ? attestation.actor.id : null,
    attestedAt: typeof attestation.attestedAt === 'string' ? attestation.attestedAt : null,
    kind: typeof attestation.kind === 'string' ? attestation.kind : null,
  };
  return `${LEGACY_ATTESTATION_REFERENCE_PREFIX}:${sha256Hex(JSON.stringify(safeIdentity)).slice(0, 16)}`;
}

function publicAttestationId(attestation) {
  return isLegacyRepoMapHash(attestation)
    ? legacyAttestationReference(attestation)
    : attestation.id;
}

function readAttestationHeadRecord(rootDir) {
  const path = headPath(rootDir);
  if (!existsSync(path)) return null;
  const pointer = loadJson(path, 'attestation HEAD');
  return typeof pointer.currentAttestationId === 'string' ? pointer.currentAttestationId : null;
}

function readCurrentAttestationRecord(rootDir) {
  const id = readAttestationHeadRecord(rootDir);
  if (!id) return null;
  const path = attestationPath(rootDir, id);
  if (!existsSync(path)) return { missing: true, id, path };
  return loadJson(path, 'attestation');
}

function publicPriorAttestationId(rootDir, priorAttestationId) {
  if (typeof priorAttestationId !== 'string' || !priorAttestationId) return null;
  // Successors created after migration persist the already-safe opaque
  // reference. It is not a filename and must not be resolved as one.
  if (priorAttestationId.startsWith(`${LEGACY_ATTESTATION_REFERENCE_PREFIX}:`)) {
    return priorAttestationId;
  }
  const path = attestationPath(rootDir, priorAttestationId);
  if (!existsSync(path)) return UNRESOLVED_ATTESTATION_REFERENCE;
  const prior = loadJson(path, 'prior attestation');
  return publicAttestationId(prior);
}

function countTrackedAttestationsWithPublicId(rootDir, publicId) {
  const dir = attestationsDir(rootDir);
  if (!existsSync(dir)) return 0;
  let matches = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.attestation.json')) continue;
    let record;
    try {
      record = loadJson(resolve(dir, name), 'attestation');
    } catch {
      continue;
    }
    if (record && typeof record === 'object' && publicAttestationId(record) === publicId) matches += 1;
  }
  return matches;
}

// Explains how the active attestation links to its predecessor. A successor of
// an unmarked historical record links by the opaque legacy reference, never by
// the stored id, because that id's digest suffix was derived from the raw Repo
// Map file hash. Without this explanation the link reads as a broken chain.
// `resolved` is computed by matching the reference against tracked records and
// reports only a boolean, so it reveals nothing about the redacted id.
function describePriorAttestationLink(rootDir, attestation) {
  if (typeof attestation.priorAttestationId !== 'string' || !attestation.priorAttestationId) return null;
  const reference = publicPriorAttestationId(rootDir, attestation.priorAttestationId);
  if (reference === UNRESOLVED_ATTESTATION_REFERENCE) {
    return {
      reference,
      form: 'unresolved',
      resolved: false,
      explanation: 'The prior attestation this record names is not tracked under .veritas/attestations.',
    };
  }
  if (!reference.startsWith(`${LEGACY_ATTESTATION_REFERENCE_PREFIX}:`)) {
    return {
      reference,
      form: 'attestation-id',
      resolved: true,
      explanation: 'The prior attestation is linked by its attestation id.',
    };
  }
  const resolved = countTrackedAttestationsWithPublicId(rootDir, reference) === 1;
  return {
    reference,
    form: 'legacy-reference',
    resolved,
    explanation: `The prior attestation predates repoMapHashAlgorithm "${REPO_MAP_HASH_ALGORITHM}". Its stored id embeds a digest of the raw Repo Map file, so Veritas links it by an opaque ${LEGACY_ATTESTATION_REFERENCE_PREFIX} reference derived only from its actor id, attestedAt, and kind. This is the expected migration link, not a broken chain. ${resolved
      ? 'The reference matches exactly one tracked attestation record.'
      : 'The reference does not match exactly one tracked attestation record.'}`,
  };
}

function publicAttestationReference(rootDir, attestation) {
  const legacy = isLegacyRepoMapHash(attestation);
  const reference = legacy
    ? stripLegacyRepoMapHashes(attestation)
    : structuredClone(attestation);
  const priorAttestationId = publicPriorAttestationId(rootDir, attestation.priorAttestationId);
  if (legacy) {
    reference.id = legacyAttestationReference(attestation);
    reference.repoMapHashAlgorithm = 'legacy-file-v0';
  }
  if (typeof attestation.priorAttestationId === 'string') {
    reference.priorAttestationId = priorAttestationId;
  }
  if (typeof attestation.metadata?.supersedes === 'string') {
    reference.metadata ??= {};
    reference.metadata.supersedes = publicPriorAttestationId(rootDir, attestation.metadata.supersedes);
  }
  return reference;
}

function readGitConfig(rootDir, key) {
  try {
    const value = execFileSync('git', ['config', '--get', key], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function attestationsDir(rootDir) {
  return resolve(rootDir, ATTESTATIONS_DIR);
}

function attestationPath(rootDir, id) {
  return resolve(attestationsDir(rootDir), `${id}.attestation.json`);
}

function headPath(rootDir) {
  return resolve(attestationsDir(rootDir), HEAD_FILE);
}

function pendingPath(rootDir) {
  return resolve(attestationsDir(rootDir), PENDING_FILE);
}

function nowIso(options = {}) {
  return options.attestedAt ?? new Date().toISOString();
}

function describeValue(value) {
  return value === undefined ? 'missing' : JSON.stringify(value) ?? String(value);
}

// The attestation schema requires validUntilDays to be an integer of at least
// 1 and sets no maximum. A window whose end is past the latest date JavaScript
// can represent cannot be compared with any clock, so it has no valid end.
export function attestationValidityWindow(attestedAt, validUntilDays) {
  if (!Number.isInteger(validUntilDays) || validUntilDays < 1) {
    return { error: `validUntilDays is ${describeValue(validUntilDays)}; it must be a whole number of days, 1 or more` };
  }
  const start = typeof attestedAt === 'string' ? new Date(attestedAt).getTime() : Number.NaN;
  if (!Number.isFinite(start)) {
    return { error: `attestedAt is ${describeValue(attestedAt)}, which is not a valid date` };
  }
  const end = new Date(start + validUntilDays * 86_400_000);
  if (!Number.isFinite(end.getTime())) {
    return { error: 'the validity window would end past the latest date Veritas can represent' };
  }
  return { start: new Date(start), end };
}

function resolveApprovalReferencePolicy({
  rootDir,
  kind,
  actor,
  approvalRef,
  approvalResolverResult,
  timestamp,
  repoStandardsPath,
  repoMapPath,
  authoritySettingsPath,
}) {
  const hashes = hashProtectedStandards(rootDir, { repoStandardsPath, repoMapPath, authoritySettingsPath });
  const resolverRequest = buildApprovalResolverRequest({
    approvalRef,
    attestationKind: kind,
    actor,
    protectedStandards: {
      repoStandardsHash: hashes.repoStandardsHash,
      repoMapHash: hashes.repoMapHash,
      authoritySettingsHash: hashes.authoritySettingsHash,
    },
    requestedAt: timestamp,
  });
  const approvalRefPolicy = validateApprovalReferencePolicy({
    rootDir,
    approvalRef,
    authoritySettingsPath: resolve(rootDir, authoritySettingsPath ?? '.veritas/authority/default.authority-settings.json'),
    approvalResolverResult,
    resolverRequest,
  });
  const resolvedApproval = approvalRefPolicy.approvalResolverResult;
  delete approvalRefPolicy.approvalResolverResult;
  return { hashes, approvalRefPolicy, resolvedApproval };
}

export function readAttestationHead(rootDir) {
  const current = readCurrentAttestationRecord(rootDir);
  if (!current) return null;
  return current.missing ? UNRESOLVED_ATTESTATION_REFERENCE : publicAttestationId(current);
}

export function readCurrentAttestation(rootDir) {
  const current = readCurrentAttestationRecord(rootDir);
  if (!current) return null;
  if (current.missing) {
    return {
      missing: true,
      id: UNRESOLVED_ATTESTATION_REFERENCE,
      path: relativeRepoPath(rootDir, attestationsDir(rootDir)),
    };
  }
  return publicAttestationReference(rootDir, current);
}

export function writePendingAttestationMarker(rootDir, options = {}) {
  const dir = attestationsDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const path = pendingPath(rootDir);
  const marker = {
    status: 'pending',
    createdAt: options.createdAt ?? new Date().toISOString(),
    reason: options.reason ?? 'No human attestation has been recorded yet.',
  };
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return {
    path: relativeRepoPath(rootDir, path),
    marker,
  };
}

// Attestations are committed, often to public repositories, so raw Git identity
// config must never be written: `user.email` can be a personal address, and
// `user.signingkey` can be a home-directory path or an SSH literal key whose
// comment is an address. Only values in a known non-personal shape are
// recorded; anything else becomes null. Nothing verifies against these values.
const GITHUB_NOREPLY_EMAIL = /^[^@\s]+@users\.noreply\.github\.com$/i;
const SIGNING_KEY_ID = /^(?:0x)?[0-9a-f]{8,64}$/i;
const SIGNING_KEY_SHA256_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

function publishableGitEmail(email) {
  return typeof email === 'string' && GITHUB_NOREPLY_EMAIL.test(email) ? email : null;
}

function publishableSigningKey(value) {
  if (typeof value !== 'string') return null;
  return SIGNING_KEY_ID.test(value) || SIGNING_KEY_SHA256_FINGERPRINT.test(value) ? value : null;
}

function buildActor(rootDir, actorId, displayName) {
  return {
    id: actorId,
    displayName: displayName ?? readGitConfig(rootDir, 'user.name') ?? actorId,
    identityEvidence: {
      gitEmail: publishableGitEmail(readGitConfig(rootDir, 'user.email')),
      signingKeyFingerprint: publishableSigningKey(readGitConfig(rootDir, 'user.signingkey')),
    },
  };
}

function nextAttestationId(kind, attestedAt, hashes) {
  const timestamp = attestedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '');
  const digest = sha256Hex(`${kind}:${attestedAt}:${hashes.repoStandardsHash}:${hashes.repoMapHash}:${hashes.authoritySettingsHash}`).slice(0, 12);
  return `${kind}-${timestamp}-${digest}`;
}

function buildAttestationSurfaceProjection({
  claimId,
  kind,
  actor,
  attestedAt,
  validUntil,
  contentHash,
  notes,
  authorityBacked,
}) {
  if (typeof Surface.buildHumanAttestationEvidence !== 'function') {
    throw new Error('Surface buildHumanAttestationEvidence public API is required by Veritas attestations.');
  }
  const evidence = Surface.buildHumanAttestationEvidence({
    subject: {
      claimId,
      sourceRef: 'veritas:protected-standards',
      sourceLocator: '.veritas/attestations',
    },
    actor: {
      id: actor.id,
      displayName: actor.displayName,
    },
    attestedAt,
    validUntil,
    contentHash,
    summary: notes || (authorityBacked
      ? `Authority-backed ${kind} attestation for Veritas Protected Standards.`
      : `Recorded ${kind} attestation for Veritas Protected Standards; its approval reference was not resolved against an approval record.`),
  });
  // The claim is only as strong as the approval check that ran. Without a
  // resolved approval nothing verified the human approval, so the claim stays
  // proposed: the status Surface derives for evidence no verification backs.
  const status = authorityBacked ? 'verified' : 'proposed';
  return {
    claim: {
      id: claimId,
      subjectType: 'veritas-protected-standards',
      subjectId: 'protected-standards',
      facet: 'veritas.attestations',
      claimType: 'veritas-human-attestation',
      fieldOrBehavior: kind,
      value: { contentHash, validUntil },
      createdAt: attestedAt,
      updatedAt: attestedAt,
      status,
      impactLevel: 'high',
      confidenceBasis: {
        sourceQuality: authorityBacked ? 'strong' : 'weak',
        reviewerAuthority: authorityBacked ? 'human' : 'none',
        evidenceStrength: authorityBacked ? 'strong' : 'weak',
        impactLevel: 'high',
      },
    },
    evidence,
    event: {
      id: `${claimId}.${status}`,
      claimId,
      status,
      actor: actor.id,
      method: 'human attestation',
      evidenceIds: [evidence.id],
      createdAt: attestedAt,
      ...(authorityBacked ? { verifiedAt: attestedAt } : {}),
    },
  };
}

export function createAttestation({
  rootDir,
  kind,
  actor,
  displayName,
  notes = '',
  validUntilDays = DEFAULT_VALID_UNTIL_DAYS,
  attestedAt,
  approvalRef,
  approvalResolverResult,
  repoStandardsPath,
  repoMapPath,
  authoritySettingsPath,
  authorizing = null,
} = {}) {
  if (!['bootstrap', 'policy-change', 'recommendation-acceptance'].includes(kind)) {
    throw new Error(`Unsupported attestation kind: ${kind}`);
  }
  if (!actor) {
    throw new Error('veritas attest requires --actor <id>');
  }
  rejectNonHumanActor(actor);
  requireHumanApprovalReference({ kind, approvalRef });
  const timestamp = nowIso({ attestedAt });
  // Refuse a window readiness could not evaluate before anything is written.
  const validityWindow = attestationValidityWindow(timestamp, validUntilDays);
  if (validityWindow.error) {
    throw new Error(`veritas attest refuses --valid-until-days ${describeValue(validUntilDays)}: ${validityWindow.error}.`);
  }
  const priorAttestationId = readAttestationHeadRecord(rootDir);
  const priorAttestation = readCurrentAttestationRecord(rootDir);
  const publicPriorAttestationId = priorAttestation && !priorAttestation.missing
    ? publicAttestationId(priorAttestation)
    : (priorAttestationId ? UNRESOLVED_ATTESTATION_REFERENCE : null);
  if (kind === 'bootstrap' && priorAttestationId) {
    throw new Error(`Bootstrap attestation already exists: ${publicPriorAttestationId}`);
  }
  if (kind !== 'bootstrap' && !priorAttestationId) {
    throw new Error(`${kind} attestation requires an existing prior attestation`);
  }
  if (kind === 'policy-change' && !notes.trim()) {
    throw new Error('veritas attest policy-change requires --message <text>');
  }

  const { hashes, approvalRefPolicy, resolvedApproval } = resolveApprovalReferencePolicy({
    rootDir,
    kind,
    actor,
    approvalRef,
    approvalResolverResult,
    timestamp,
    repoStandardsPath,
    repoMapPath,
    authoritySettingsPath,
  });
  const approvalResolution = resolvedApproval
    ? summarizeApprovalResolverResult(resolvedApproval)
    : null;
  const actorRecord = buildActor(rootDir, actor, displayName);
  const validUntil = validityWindow.end.toISOString();
  const surfaceClaimId = `veritas.attestation.${nextAttestationId(kind, timestamp, hashes)}`;
  const { admissibilityWarning, admissibilityWarningReason } = computeAdmissibilityWarning({
    authorizing,
    changedFields: ['repoStandardsHash', 'repoMapHash', 'authoritySettingsHash'],
    notes,
  });
  const attestation = bindAttestationRecordIntegrity({
    schemaVersion: 1,
    id: surfaceClaimId.replace(/^veritas\.attestation\./, ''),
    kind,
    actor: actorRecord,
    attestedAt: timestamp,
    repoStandardsHash: hashes.repoStandardsHash,
    repoMapHash: hashes.repoMapHash,
    repoMapHashAlgorithm: REPO_MAP_HASH_ALGORITHM,
    authoritySettingsHash: hashes.authoritySettingsHash,
    priorAttestationId: publicPriorAttestationId,
    validUntilDays,
    notes,
    ...(authorizing ? { authorizing } : {}),
    ...(admissibilityWarning ? { admissibilityWarning, admissibilityWarningReason } : {}),
    metadata: {
      protectedStandardsPaths: hashes.paths,
      supersedes: publicPriorAttestationId,
      approvalRef: approvalRef?.trim() ?? null,
      approvalRefPolicy,
      approvalResolution,
    },
    surface: buildAttestationSurfaceProjection({
      claimId: surfaceClaimId,
      kind,
      actor: actorRecord,
      attestedAt: timestamp,
      validUntil,
      contentHash: sha256Hex(`${hashes.repoStandardsHash}:${hashes.repoMapHash}:${hashes.authoritySettingsHash}`),
      notes,
      authorityBacked: isAuthorityBackedApproval({
        approvalRef: approvalRef?.trim() ?? null,
        approvalRefPolicy,
        approvalResolution,
      }),
    }),
  });

  const dir = attestationsDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const path = attestationPath(rootDir, attestation.id);
  if (existsSync(path)) {
    throw new Error(`Refusing to overwrite immutable attestation: ${basename(path)}`);
  }
  writeFileSync(path, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
  writeFileSync(headPath(rootDir), `${JSON.stringify({ currentAttestationId: attestation.id }, null, 2)}\n`, 'utf8');
  return {
    attestation,
    path: relativeRepoPath(rootDir, path),
    headPath: relativeRepoPath(rootDir, headPath(rootDir)),
  };
}

export function assertAttestationApprovalReference({
  rootDir,
  kind,
  actor,
  approvalRef,
  approvalResolverResult,
  attestedAt,
  repoStandardsPath,
  repoMapPath,
  authoritySettingsPath,
} = {}) {
  requireHumanApprovalReference({ kind, approvalRef });
  const timestamp = nowIso({ attestedAt });
  const { approvalRefPolicy, resolvedApproval } = resolveApprovalReferencePolicy({
    rootDir,
    kind,
    actor,
    approvalRef,
    approvalResolverResult,
    timestamp,
    repoStandardsPath,
    repoMapPath,
    authoritySettingsPath,
  });
  return {
    approvalRefPolicy,
    approvalResolution: resolvedApproval ? summarizeApprovalResolverResult(resolvedApproval) : null,
  };
}

function compareProtectedStandardsHashes(rootDir, current, hashes, legacyRepoMapHash, options) {
  // A null current hash marks a protected entry that is not a regular file:
  // it drifts whatever the attestation holds (even a hand-edited null), and it
  // is never read through a link.
  const differs = (field) => hashes[field] === null || current[field] !== hashes[field];
  const drift = ['repoStandardsHash', 'authoritySettingsHash']
    .filter(differs)
    .map((field) => ({
      field,
      attested: current[field],
      current: hashes[field],
    }));
  if (legacyRepoMapHash
    && (hashes.repoMapHash === null || !matchesLegacyRepoMapHash(rootDir, current.repoMapHash, options))) {
    // Preserve the drift record contract without exposing either the legacy
    // raw digest or a derived value that could test candidate runtime inputs.
    drift.push({ field: 'repoMapHash', attested: null, current: null });
  }
  if (!legacyRepoMapHash && differs('repoMapHash')) {
    drift.push({
      field: 'repoMapHash',
      attested: current.repoMapHash,
      current: hashes.repoMapHash,
    });
  }
  return drift;
}

function describeRecordIntegrity({ status, algorithm }) {
  const messages = {
    verified: 'The attestation record matches its recordIntegrity digest, so its actor, notes, approval reference and other fields are as recorded.',
    unbound: 'This attestation predates record integrity, so an edit to its actor, notes or approval reference cannot be detected. The next attestation binds them.',
    mismatch: 'The attestation record does not match its recordIntegrity digest: it was edited after it was recorded.',
    'unsupported-algorithm': `The attestation record is bound with ${algorithm}, which this Veritas version cannot verify.`,
  };
  return { status, algorithm, message: messages[status] };
}

export function inspectAttestationStatus(rootDir, options = {}) {
  const current = readCurrentAttestationRecord(rootDir);
  const pending = existsSync(pendingPath(rootDir));
  const protectedStandards = (() => {
    try {
      const { hashes, nonRegular, paths } = inspectProtectedStandards(rootDir, options);
      return {
        hashes: {
          repoStandardsHash: hashes.repoStandardsHash,
          repoMapHash: hashes.repoMapHash,
          authoritySettingsHash: hashes.authoritySettingsHash,
        },
        paths,
        ...(nonRegular.length > 0 ? { error: describeNonRegularProtectedStandardsEntries(nonRegular) } : {}),
      };
    } catch (error) {
      return {
        error: error.message,
      };
    }
  })();
  if (!current) {
    return {
      state: pending ? 'pending' : 'missing',
      currentAttestationId: null,
      pending,
      drift: [],
      expired: false,
      ageDays: null,
      validUntil: null,
      protectedStandards,
    };
  }
  if (current.missing) {
    return {
      state: 'broken-head',
      currentAttestationId: UNRESOLVED_ATTESTATION_REFERENCE,
      pending,
      drift: [{ field: 'currentAttestationId', attested: UNRESOLVED_ATTESTATION_REFERENCE, current: null }],
      expired: false,
      ageDays: null,
      validUntil: null,
      protectedStandards,
    };
  }
  const legacyRepoMapHash = isLegacyRepoMapHash(current);
  const drift = compareProtectedStandardsHashes(
    rootDir,
    current,
    protectedStandards.hashes ?? hashProtectedStandards(rootDir, options),
    legacyRepoMapHash,
    options,
  );
  const recordIntegrity = verifyAttestationRecordIntegrity(current);
  const integrityFailed = recordIntegrity.status === 'mismatch' || recordIntegrity.status === 'unsupported-algorithm';
  if (integrityFailed) {
    // A legacy record still holds raw Repo Map hash material, so a digest over
    // it is withheld for the same reason its id is.
    drift.push({
      field: 'recordIntegrity',
      attested: legacyRepoMapHash ? null : recordIntegrity.recordedDigest,
      current: legacyRepoMapHash ? null : recordIntegrity.currentDigest,
    });
  }
  const now = options.now ? new Date(options.now) : new Date();
  // A record whose window cannot be evaluated counts as expired, never as
  // open-ended, and says why.
  const validityWindow = attestationValidityWindow(current.attestedAt, current.validUntilDays);
  const ageDays = validityWindow.start
    ? Math.floor((now.getTime() - validityWindow.start.getTime()) / 86_400_000)
    : null;
  const priorAttestationLink = describePriorAttestationLink(rootDir, current);
  const state = recordIntegrity.status === 'mismatch'
    ? 'tampered'
    : recordIntegrity.status === 'unsupported-algorithm'
      ? 'unverifiable'
      : drift.length > 0 ? 'drifted' : 'current';
  return {
    state,
    currentAttestationId: publicAttestationId(current),
    attestation: publicAttestationReference(rootDir, current),
    pending,
    drift,
    expired: validityWindow.error ? true : now.getTime() > validityWindow.end.getTime(),
    ageDays,
    validUntil: validityWindow.error ? null : validityWindow.end.toISOString(),
    ...(validityWindow.error ? { validityWindowError: validityWindow.error } : {}),
    protectedStandards,
    recordIntegrity: describeRecordIntegrity(recordIntegrity),
    ...(priorAttestationLink ? { priorAttestationLink } : {}),
    ...(legacyRepoMapHash ? {
      migrationRecommendation: {
        status: 'recommended',
        message: 'This legacy attestation uses the retired raw Repo Map file-hash algorithm. Its unchanged file state remains valid; record a future policy-change attestation to adopt public-policy-v1.',
      },
    } : {}),
    admissibilityWarning: current.admissibilityWarning ?? false,
    admissibilityWarningReason: current.admissibilityWarningReason ?? null,
  };
}

function legacyPriorLinkNote(link) {
  if (link?.form !== 'legacy-reference') return '';
  return ` It supersedes a pre-${REPO_MAP_HASH_ALGORITHM} attestation linked by the opaque reference ${link.reference} (${link.resolved ? 'matches one tracked record' : 'matches no single tracked record'}); see \`npx --no @kontourai/veritas attest status\` priorAttestationLink.`;
}

function recordIntegrityRemediation(status) {
  return status.state === 'unverifiable'
    ? 'Run a Veritas version that supports the recordIntegrity algorithm this attestation names, then recheck readiness.'
    : 'Restore the attestation file exactly as it was committed, because attestation records are immutable. To correct one, record a new attestation with `npx --no @kontourai/veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference>` instead of editing it.';
}

function unboundRecordNote(recordIntegrity) {
  return recordIntegrity?.status === 'unbound'
    ? ' Its actor, notes and approval reference are not integrity-bound because it predates record integrity; the next attestation binds them.'
    : '';
}

// The stop hook shows this to the agent at every turn end once an attestation
// lapses, so it says plainly that renewal is a human authority's act.
function renewalRemediation(validUntilDays) {
  const days = Number.isInteger(validUntilDays) && validUntilDays >= 1 ? validUntilDays : null;
  const command = `npx --no @kontourai/veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference> --valid-until-days ${days ?? '<days>'}`;
  const window = days
    ? `\`--valid-until-days ${days}\` keeps this attestation's ${days}-day validity window.`
    : 'Give <days> as a whole number of days, 1 or more; 90 is the default.';
  return `A human authority must review the protected standards and run \`${command}\`. An agent must not run it: stop and ask a human authority. ${window}`;
}

export function buildAttestationPolicyResult(status) {
  const integrityFailed = status.state === 'tampered' || status.state === 'unverifiable';
  if (status.state === 'drifted' || status.state === 'broken-head' || integrityFailed) {
    // Status records an error beside drift, and a null current hash, only for
    // protected files that are not regular files. A fresh attestation cannot
    // fix those, so say so.
    const entryError = status.state !== 'broken-head' ? status.protectedStandards?.error : null;
    const nonRegularField = (field) => status.protectedStandards?.hashes?.[field] === null;
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      enforcementLevel: 'Require',
      message: 'Protected standards changes require a fresh attestation.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'fail',
      summary: integrityFailed
        ? `Active attestation ${status.currentAttestationId}: ${status.recordIntegrity.message}`
        : entryError
          ? `Current protected standards do not match the active attestation. ${entryError}`
          : 'Current protected standards hashes do not match the active attestation.',
      findings: status.drift.map((item) => ({
        kind: item.field === 'recordIntegrity' ? 'attestation-record-integrity' : 'attestation-drift',
        artifact: item.field,
        attested: item.attested,
        current: item.current,
        remediation: item.field === 'recordIntegrity'
          ? recordIntegrityRemediation(status)
          : entryError && nonRegularField(item.field)
            ? 'Restore each listed protected standards file as a regular file at its protected path, then recheck readiness.'
            : 'Run `npx --no @kontourai/veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference>` after authority review.',
      })),
    };
  }
  if (status.state === 'pending' || status.state === 'missing') {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      enforcementLevel: 'Guide',
      message: 'No attestation has activated the protected standards yet.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'warn',
      summary: 'No active attestation found; readiness is advisory until bootstrap attestation is recorded.',
      findings: [{
        kind: 'missing-attestation',
        artifact: ATTESTATIONS_DIR,
        remediation: 'Run `npx --no @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive`.',
      }],
    };
  }
  if (status.validityWindowError) {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      enforcementLevel: 'Require',
      message: 'Protected standards require an attestation whose validity window has not expired.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'fail',
      summary: `Active attestation ${status.currentAttestationId} has no valid validity window (${status.validityWindowError}); readiness fails until an authority records a fresh attestation.`,
      findings: [{
        kind: 'invalid-attestation-validity-window',
        artifact: status.currentAttestationId,
        remediation: renewalRemediation(null),
      }],
    };
  }
  if (status.expired) {
    // An expired Validity Window is stale authority, so it blocks like drift.
    // Pending and missing stay advisory above: no authority has approved the
    // standards yet, whereas here an approval existed and has run out.
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      enforcementLevel: 'Require',
      message: 'Protected standards require an attestation whose validity window has not expired.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'fail',
      summary: `Active attestation ${status.currentAttestationId} expired at ${status.validUntil}; readiness fails until an authority records a fresh attestation.`,
      findings: [{
        kind: 'expired-attestation',
        artifact: status.currentAttestationId,
        remediation: renewalRemediation(status.attestation?.validUntilDays),
      }],
    };
  }
  const admissibilityWarningCount = status.admissibilityWarning ? 1 : 0;
  const passAnnotation = admissibilityWarningCount > 0
    ? ` (${admissibilityWarningCount} admissibility ${admissibilityWarningCount === 1 ? 'warning' : 'warnings'})`
    : '';
  return {
    rule_id: 'policy-changes-require-attestation',
    classification: 'hard-invariant',
    enforcementLevel: 'Require',
    message: 'Protected standards changes require a fresh attestation.',
    owner: 'repo-core',
    rollback_switch: null,
    implemented: true,
    passed: true,
    status: 'pass',
    summary: `Active attestation ${status.currentAttestationId} matches current protected standards hashes${passAnnotation}.${legacyPriorLinkNote(status.priorAttestationLink)}${unboundRecordNote(status.recordIntegrity)}`,
    findings: admissibilityWarningCount > 0 ? [{
      kind: 'admissibility-warning',
      artifact: status.currentAttestationId,
      reason: status.admissibilityWarningReason,
    }] : [],
  };
}
