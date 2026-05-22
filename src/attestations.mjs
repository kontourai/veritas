import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadJson } from './load.mjs';
import { relativeRepoPath } from './paths.mjs';
import * as Surface from '@kontourai/surface';

const DEFAULT_VALID_UNTIL_DAYS = 90;
const ATTESTATIONS_DIR = '.veritas/attestations';
const HEAD_FILE = 'HEAD';
const PENDING_FILE = 'PENDING';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashFile(path) {
  return `sha256:${sha256Hex(readFileSync(path))}`;
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

function rejectNonHumanActor(actorId) {
  if (/(\bbot\b|ci|github-actions|dependabot|buildkite|circleci|jenkins)/i.test(actorId)) {
    throw new Error(`Refusing to create a human attestation for non-human actor: ${actorId}`);
  }
}

export function resolveProtectedStandardsPaths(rootDir, options = {}) {
  return {
    repoStandardsPath: resolve(rootDir, options.repoStandardsPath ?? '.veritas/repo-standards/default.repo-standards.json'),
    adapterPath: resolve(rootDir, options.adapterPath ?? '.veritas/repo.adapter.json'),
    teamProfilePath: resolve(rootDir, options.teamProfilePath ?? '.veritas/team/default.team-profile.json'),
  };
}

export function hashProtectedStandards(rootDir, options = {}) {
  const paths = resolveProtectedStandardsPaths(rootDir, options);
  return {
    repoStandardsHash: hashFile(paths.repoStandardsPath),
    adapterHash: hashFile(paths.adapterPath),
    teamProfileHash: hashFile(paths.teamProfilePath),
    paths: {
      repoStandardsPath: relativeRepoPath(rootDir, paths.repoStandardsPath),
      adapterPath: relativeRepoPath(rootDir, paths.adapterPath),
      teamProfilePath: relativeRepoPath(rootDir, paths.teamProfilePath),
    },
  };
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
  const digest = sha256Hex(`${kind}:${attestedAt}:${hashes.repoStandardsHash}:${hashes.adapterHash}:${hashes.teamProfileHash}`).slice(0, 12);
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
  repoStandardsPath,
  adapterPath,
  teamProfilePath,
} = {}) {
  if (!['bootstrap', 'policy-change', 'recommendation-acceptance'].includes(kind)) {
    throw new Error(`Unsupported attestation kind: ${kind}`);
  }
  if (!actor) {
    throw new Error('veritas attest requires --actor <id>');
  }
  rejectNonHumanActor(actor);
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

  const hashes = hashProtectedStandards(rootDir, { repoStandardsPath, adapterPath, teamProfilePath });
  const actorRecord = buildActor(rootDir, actor, displayName);
  const validUntil = new Date(new Date(timestamp).getTime() + validUntilDays * 86_400_000).toISOString();
  const surfaceClaimId = `veritas.attestation.${nextAttestationId(kind, timestamp, hashes)}`;
  const attestation = {
    schemaVersion: 1,
    id: surfaceClaimId.replace(/^veritas\.attestation\./, ''),
    kind,
    actor: actorRecord,
    attestedAt: timestamp,
    repoStandardsHash: hashes.repoStandardsHash,
    adapterHash: hashes.adapterHash,
    teamProfileHash: hashes.teamProfileHash,
    priorAttestationId: priorAttestationId ?? null,
    validUntilDays,
    notes,
    metadata: {
      protectedStandardsPaths: hashes.paths,
      supersedes: priorAttestationId ?? null,
    },
    surface: buildAttestationSurfaceProjection({
      claimId: surfaceClaimId,
      kind,
      actor: actorRecord,
      attestedAt: timestamp,
      validUntil,
      contentHash: sha256Hex(`${hashes.repoStandardsHash}:${hashes.adapterHash}:${hashes.teamProfileHash}`),
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

export function inspectAttestationStatus(rootDir, options = {}) {
  const current = readCurrentAttestation(rootDir);
  const pending = existsSync(pendingPath(rootDir));
  const protectedStandards = (() => {
    try {
      const hashes = hashProtectedStandards(rootDir, options);
      return {
        hashes: {
          repoStandardsHash: hashes.repoStandardsHash,
          adapterHash: hashes.adapterHash,
          teamProfileHash: hashes.teamProfileHash,
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
  const drift = ['repoStandardsHash', 'adapterHash', 'teamProfileHash']
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
  };
}

export function buildAttestationPolicyResult(status) {
  if (status.state === 'drifted' || status.state === 'broken-head') {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      stage: 'block',
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
        remediation: 'Run veritas attest policy-change --message <text> --actor <authority-id> after authority review.',
      })),
    };
  }
  if (status.state === 'pending' || status.state === 'missing') {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      stage: 'warn',
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
        remediation: 'Run veritas attest bootstrap --actor <authority-id> --non-interactive.',
      }],
    };
  }
  if (status.expired) {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      stage: 'warn',
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
        remediation: 'Run veritas attest policy-change --message <text> --actor <authority-id> to refresh attestation.',
      }],
    };
  }
  return {
    rule_id: 'policy-changes-require-attestation',
    classification: 'hard-invariant',
    stage: 'block',
    message: 'Protected standards changes require a fresh authority-backed attestation.',
    owner: 'repo-core',
    rollback_switch: null,
    implemented: true,
    passed: true,
    status: 'pass',
    summary: `Active attestation ${status.currentAttestationId} matches current protected standards hashes.`,
    findings: [],
  };
}
