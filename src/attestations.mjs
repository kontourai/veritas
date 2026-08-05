import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  hashProtectedStandards,
  matchesLegacyRepoMapHash,
  REPO_MAP_HASH_ALGORITHM,
  sha256Hex,
} from './attestations/protected-standards.mjs';
import { computeAdmissibilityWarning } from './attestations/collection.mjs';

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

function buildActor(rootDir, actorId, displayName) {
  return {
    id: actorId,
    displayName: displayName ?? readGitConfig(rootDir, 'user.name') ?? actorId,
    identityEvidence: {
      gitEmail: readGitConfig(rootDir, 'user.email'),
      signingKeyFingerprint: readGitConfig(rootDir, 'user.signingkey'),
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
    summary: notes || `Authority-backed ${kind} attestation for Veritas Protected Standards.`,
  });
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
      status: 'verified',
      impactLevel: 'high',
      confidenceBasis: {
        sourceQuality: 'strong',
        reviewerAuthority: 'human',
        evidenceStrength: 'strong',
        impactLevel: 'high',
      },
    },
    evidence,
    event: {
      id: `${claimId}.verified`,
      claimId,
      status: 'verified',
      actor: actor.id,
      method: 'human attestation',
      evidenceIds: [evidence.id],
      createdAt: attestedAt,
      verifiedAt: attestedAt,
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
  const validUntil = new Date(new Date(timestamp).getTime() + validUntilDays * 86_400_000).toISOString();
  const surfaceClaimId = `veritas.attestation.${nextAttestationId(kind, timestamp, hashes)}`;
  const { admissibilityWarning, admissibilityWarningReason } = computeAdmissibilityWarning({
    authorizing,
    changedFields: ['repoStandardsHash', 'repoMapHash', 'authoritySettingsHash'],
    notes,
  });
  const attestation = {
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
    }),
  };

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

export function inspectAttestationStatus(rootDir, options = {}) {
  const current = readCurrentAttestationRecord(rootDir);
  const pending = existsSync(pendingPath(rootDir));
  const protectedStandards = (() => {
    try {
      const hashes = hashProtectedStandards(rootDir, options);
      return {
        hashes: {
          repoStandardsHash: hashes.repoStandardsHash,
          repoMapHash: hashes.repoMapHash,
          authoritySettingsHash: hashes.authoritySettingsHash,
        },
        paths: hashes.paths,
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
  const hashes = protectedStandards.hashes ?? hashProtectedStandards(rootDir, options);
  const legacyRepoMapHash = isLegacyRepoMapHash(current);
  const drift = ['repoStandardsHash', 'authoritySettingsHash']
    .filter((field) => current[field] !== hashes[field])
    .map((field) => ({
      field,
      attested: current[field],
      current: hashes[field],
    }));
  if (legacyRepoMapHash
    && !matchesLegacyRepoMapHash(rootDir, current.repoMapHash, options)) {
    // Preserve the drift record contract without exposing either the legacy
    // raw digest or a derived value that could test candidate runtime inputs.
    drift.push({ field: 'repoMapHash', attested: null, current: null });
  }
  if (!legacyRepoMapHash && current.repoMapHash !== hashes.repoMapHash) {
    drift.push({
      field: 'repoMapHash',
      attested: current.repoMapHash,
      current: hashes.repoMapHash,
    });
  }
  const now = options.now ? new Date(options.now) : new Date();
  const attestedAt = new Date(current.attestedAt);
  const ageDays = Math.floor((now.getTime() - attestedAt.getTime()) / 86_400_000);
  const validUntil = new Date(attestedAt.getTime() + current.validUntilDays * 86_400_000);
  return {
    state: drift.length > 0 ? 'drifted' : 'current',
    currentAttestationId: publicAttestationId(current),
    attestation: publicAttestationReference(rootDir, current),
    pending,
    drift,
    expired: now.getTime() > validUntil.getTime(),
    ageDays,
    validUntil: validUntil.toISOString(),
    protectedStandards,
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

export function buildAttestationPolicyResult(status) {
  if (status.state === 'drifted' || status.state === 'broken-head') {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      enforcementLevel: 'Require',
      message: 'Protected standards changes require a fresh authority-backed attestation.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'fail',
      summary: 'Current protected standards hashes do not match the active attestation.',
      findings: status.drift.map((item) => ({
        kind: 'attestation-drift',
        artifact: item.field,
        attested: item.attested,
        current: item.current,
        remediation: 'Run veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference> after authority review.',
      })),
    };
  }
  if (status.state === 'pending' || status.state === 'missing') {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      enforcementLevel: 'Guide',
      message: 'No authority-backed attestation has activated the protected standards yet.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'warn',
      summary: 'No active attestation found; readiness is advisory until bootstrap attestation is recorded.',
      findings: [{
        kind: 'missing-attestation',
        artifact: ATTESTATIONS_DIR,
        remediation: 'Run veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive.',
      }],
    };
  }
  if (status.expired) {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      enforcementLevel: 'Guide',
      message: 'The active protected-standards attestation has expired.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'warn',
      summary: `Active attestation ${status.currentAttestationId} expired at ${status.validUntil}.`,
      findings: [{
        kind: 'expired-attestation',
        artifact: status.currentAttestationId,
        remediation: 'Run veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference> to refresh attestation.',
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
    message: 'Protected standards changes require a fresh authority-backed attestation.',
    owner: 'repo-core',
    rollback_switch: null,
    implemented: true,
    passed: true,
    status: 'pass',
    summary: `Active attestation ${status.currentAttestationId} matches current protected standards hashes${passAnnotation}.`,
    findings: admissibilityWarningCount > 0 ? [{
      kind: 'admissibility-warning',
      artifact: status.currentAttestationId,
      reason: status.admissibilityWarningReason,
    }] : [],
  };
}
