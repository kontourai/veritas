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
  resolveProtectedStandardsPaths,
} from './attestations/protected-standards.mjs';
import {
  hashProtectedStandards,
  sha256Hex,
} from './attestations/protected-standards.mjs';
import { computeAdmissibilityWarning } from './attestations/collection.mjs';

const DEFAULT_VALID_UNTIL_DAYS = 90;
const ATTESTATIONS_DIR = '.veritas/attestations';
const HEAD_FILE = 'HEAD';
const PENDING_FILE = 'PENDING';

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
  const path = headPath(rootDir);
  if (!existsSync(path)) return null;
  const pointer = loadJson(path, 'attestation HEAD');
  return typeof pointer.currentAttestationId === 'string' ? pointer.currentAttestationId : null;
}

export function readCurrentAttestation(rootDir) {
  const id = readAttestationHead(rootDir);
  if (!id) return null;
  const path = attestationPath(rootDir, id);
  if (!existsSync(path)) {
    return {
      missing: true,
      id,
      path: relativeRepoPath(rootDir, path),
    };
  }
  return loadJson(path, 'attestation');
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
      surface: 'veritas.attestations',
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
  const priorAttestationId = readAttestationHead(rootDir);
  if (kind === 'bootstrap' && priorAttestationId) {
    throw new Error(`Bootstrap attestation already exists: ${priorAttestationId}`);
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
    authoritySettingsHash: hashes.authoritySettingsHash,
    priorAttestationId: priorAttestationId ?? null,
    validUntilDays,
    notes,
    ...(authorizing ? { authorizing } : {}),
    ...(admissibilityWarning ? { admissibilityWarning, admissibilityWarningReason } : {}),
    metadata: {
      protectedStandardsPaths: hashes.paths,
      supersedes: priorAttestationId ?? null,
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
  const current = readCurrentAttestation(rootDir);
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
      currentAttestationId: current.id,
      pending,
      drift: [{ field: 'currentAttestationId', attested: current.id, current: null }],
      expired: false,
      ageDays: null,
      validUntil: null,
      protectedStandards,
    };
  }
  const hashes = protectedStandards.hashes ?? hashProtectedStandards(rootDir, options);
  const drift = ['repoStandardsHash', 'repoMapHash', 'authoritySettingsHash']
    .filter((field) => current[field] !== hashes[field])
    .map((field) => ({
      field,
      attested: current[field],
      current: hashes[field],
    }));
  const now = options.now ? new Date(options.now) : new Date();
  const attestedAt = new Date(current.attestedAt);
  const ageDays = Math.floor((now.getTime() - attestedAt.getTime()) / 86_400_000);
  const validUntil = new Date(attestedAt.getTime() + current.validUntilDays * 86_400_000);
  return {
    state: drift.length > 0 ? 'drifted' : 'current',
    currentAttestationId: current.id,
    attestation: current,
    pending,
    drift,
    expired: now.getTime() > validUntil.getTime(),
    ageDays,
    validUntil: validUntil.toISOString(),
    protectedStandards,
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
