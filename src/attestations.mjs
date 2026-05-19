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

export function resolveZone1Paths(rootDir, options = {}) {
  return {
    policyPackPath: resolve(rootDir, options.policyPackPath ?? '.veritas/policy-packs/default.policy-pack.json'),
    adapterPath: resolve(rootDir, options.adapterPath ?? '.veritas/repo.adapter.json'),
    teamProfilePath: resolve(rootDir, options.teamProfilePath ?? '.veritas/team/default.team-profile.json'),
  };
}

export function hashZone1(rootDir, options = {}) {
  const paths = resolveZone1Paths(rootDir, options);
  return {
    policyPackHash: hashFile(paths.policyPackPath),
    adapterHash: hashFile(paths.adapterPath),
    teamProfileHash: hashFile(paths.teamProfilePath),
    paths: {
      policyPackPath: relativeRepoPath(rootDir, paths.policyPackPath),
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
    identityProof: {
      gitEmail: readGitConfig(rootDir, 'user.email'),
      signingKeyFingerprint: readGitConfig(rootDir, 'user.signingkey'),
    },
  };
}

function nextAttestationId(kind, attestedAt, hashes) {
  const timestamp = attestedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '');
  const digest = sha256Hex(`${kind}:${attestedAt}:${hashes.policyPackHash}:${hashes.adapterHash}:${hashes.teamProfileHash}`).slice(0, 12);
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
      sourceRef: 'veritas:zone1',
      sourceLocator: '.veritas/attestations',
    },
    actor: {
      id: actor.id,
      displayName: actor.displayName,
    },
    attestedAt,
    validUntil,
    contentHash,
    summary: notes || `Human ${kind} attestation for Veritas Zone 1 governance.`,
  });
  return {
    claim: {
      id: claimId,
      subjectType: 'veritas-zone1',
      subjectId: 'governance-core',
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
        proofStrength: 'strong',
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
  policyPackPath,
  adapterPath,
  teamProfilePath,
} = {}) {
  if (!['bootstrap', 'policy-change', 'proposal-acceptance'].includes(kind)) {
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

  const hashes = hashZone1(rootDir, { policyPackPath, adapterPath, teamProfilePath });
  const actorRecord = buildActor(rootDir, actor, displayName);
  const validUntil = new Date(new Date(timestamp).getTime() + validUntilDays * 86_400_000).toISOString();
  const surfaceClaimId = `veritas.attestation.${nextAttestationId(kind, timestamp, hashes)}`;
  const attestation = {
    schemaVersion: 1,
    id: surfaceClaimId.replace(/^veritas\.attestation\./, ''),
    kind,
    actor: actorRecord,
    attestedAt: timestamp,
    policyPackHash: hashes.policyPackHash,
    adapterHash: hashes.adapterHash,
    teamProfileHash: hashes.teamProfileHash,
    priorAttestationId: priorAttestationId ?? null,
    validUntilDays,
    notes,
    metadata: {
      zone1Paths: hashes.paths,
      supersedes: priorAttestationId ?? null,
    },
    surface: buildAttestationSurfaceProjection({
      claimId: surfaceClaimId,
      kind,
      actor: actorRecord,
      attestedAt: timestamp,
      validUntil,
      contentHash: sha256Hex(`${hashes.policyPackHash}:${hashes.adapterHash}:${hashes.teamProfileHash}`),
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
  const zone1 = (() => {
    try {
      const hashes = hashZone1(rootDir, options);
      return {
        hashes: {
          policyPackHash: hashes.policyPackHash,
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
      zone1,
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
      zone1,
    };
  }
  const hashes = zone1.hashes ?? hashZone1(rootDir, options);
  const drift = ['policyPackHash', 'adapterHash', 'teamProfileHash']
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
    zone1,
  };
}

export function buildAttestationPolicyResult(status) {
  if (status.state === 'drifted' || status.state === 'broken-head') {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      stage: 'block',
      message: 'Zone 1 governance changes require a fresh human attestation.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'fail',
      summary: 'Current Zone 1 hashes do not match the active human attestation.',
      findings: status.drift.map((item) => ({
        kind: 'attestation-drift',
        artifact: item.field,
        attested: item.attested,
        current: item.current,
        remediation: 'Run veritas attest policy-change --message <text> --actor <human-id> after human review.',
      })),
    };
  }
  if (status.state === 'pending' || status.state === 'missing') {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      stage: 'warn',
      message: 'No human attestation has activated the policy pack yet.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'warn',
      summary: 'No active human attestation found; shadow run is advisory until bootstrap attestation is recorded.',
      findings: [{
        kind: 'missing-attestation',
        artifact: ATTESTATIONS_DIR,
        remediation: 'Run veritas attest bootstrap --actor <human-id> --non-interactive.',
      }],
    };
  }
  if (status.expired) {
    return {
      rule_id: 'policy-changes-require-attestation',
      classification: 'hard-invariant',
      stage: 'warn',
      message: 'The active human attestation has expired.',
      owner: 'repo-core',
      rollback_switch: null,
      implemented: true,
      passed: false,
      status: 'warn',
      summary: `Active attestation ${status.currentAttestationId} expired at ${status.validUntil}.`,
      findings: [{
        kind: 'expired-attestation',
        artifact: status.currentAttestationId,
        remediation: 'Run veritas attest policy-change --message <text> --actor <human-id> to refresh attestation.',
      }],
    };
  }
  return {
    rule_id: 'policy-changes-require-attestation',
    classification: 'hard-invariant',
    stage: 'block',
    message: 'Zone 1 governance changes require a fresh human attestation.',
    owner: 'repo-core',
    rollback_switch: null,
    implemented: true,
    passed: true,
    status: 'pass',
    summary: `Active attestation ${status.currentAttestationId} matches current Zone 1 hashes.`,
    findings: [],
  };
}
