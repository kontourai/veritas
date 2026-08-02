import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrustReport } from '@kontourai/surface';
import Ajv from 'ajv/dist/2020.js';
import {
  createAttestation,
  buildExplainText,
  generateVeritasReport,
  inspectAttestationStatus,
  writeBootstrapStarterKit,
} from '../src/index.mjs';
import {
  readAttestationHead as readAttestationHeadFromEngine,
  readCurrentAttestation as readCurrentAttestationFromEngine,
} from '../src/engine.mjs';
import { hashProtectedStandards } from '../src/attestations/protected-standards.mjs';
import { validateTrustBundleSchema } from '../src/surface/trust-bundle-validator.mjs';
import {
  commitAll,
  repoRootDir,
  initCommittedRepo,
  parseCliJson,
  readJsonFromAbsolute,
} from './helpers.mjs';

function bootstrapVeritasRepo(prefix = 'veritas-attest-') {
  const rootDir = initCommittedRepo(prefix);
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'attestation-fixture',
    evidenceCheck: 'npm test',
    force: true,
  });
  // These fixtures isolate attestation behavior. They intentionally have no
  // canonical required Evidence Check, so --skip-evidence-check is a
  // non-blocking diagnostic setup rather than a merge-readiness bypass.
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.requiredEvidenceCheckIds = [];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap Veritas');
  return rootDir;
}

async function attestationSurfaceClaims(rootDir, options = {}) {
  const result = await generateVeritasReport({
    rootDir,
    includeAttestationGate: true,
    skipEvidenceCheck: true,
    runId: options.runId ?? `attestation-surface-${Date.now()}`,
    timestamp: options.timestamp ?? '2026-05-11T00:00:00.000Z',
    attestationNow: options.attestationNow,
  }, { rootDir }, ['package.json']);
  return buildTrustReport(result.record.trust.bundle, {
    id: options.runId ?? 'attestation-surface-report',
    now: new Date(result.record.timestamp),
  }).claims;
}

function claimFor(claims, fieldOrBehavior, artifact) {
  return claims.find((claim) =>
    claim.fieldOrBehavior === fieldOrBehavior &&
    (artifact ? claim.value?.artifact === artifact : true)
  );
}

function governanceClaim(claims) {
  return claims.find((claim) => claim.claimType === 'veritas-governance-artifact');
}

const HUMAN_APPROVAL_REF = 'test://human-approved-attestation';

function sha256Dictionary(value, path = '$', dictionary = {}) {
  if (typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)) {
    dictionary[path] = value;
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => sha256Dictionary(item, `${path}[${index}]`, dictionary));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      sha256Dictionary(child, `${path}.${key}`, dictionary);
    }
  }
  return dictionary;
}

function assertGeneratedReportSchemas(rootDir, report) {
  const schema = JSON.parse(readFileSync(join(repoRootDir, 'schemas/veritas-evidence.schema.json'), 'utf8'));
  const validateEvidence = new Ajv({ strict: false, allErrors: true }).compile(schema);
  const artifact = JSON.parse(readFileSync(join(rootDir, report.artifactPath), 'utf8'));
  assert.equal(validateEvidence(artifact), true, JSON.stringify(validateEvidence.errors));
  const trustValidation = validateTrustBundleSchema(report.record.trust.bundle);
  assert.equal(trustValidation.valid, true, trustValidation.errors.join('; '));
}

function rewriteCurrentAttestationAsLegacy(rootDir) {
  const head = readJsonFromAbsolute(join(rootDir, '.veritas/attestations/HEAD'));
  const path = join(rootDir, '.veritas/attestations', `${head.currentAttestationId}.attestation.json`);
  const attestation = readJsonFromAbsolute(path);
  const rawRepoMapHash = `sha256:${createHash('sha256')
    .update(readFileSync(join(rootDir, '.veritas/repo-map.json')))
    .digest('hex')}`;
  attestation.repoMapHash = rawRepoMapHash;
  delete attestation.repoMapHashAlgorithm;
  attestation.surface.contentHash = createHash('sha256').update(rawRepoMapHash).digest('hex');
  // Historical Veritas IDs were derived from this raw file digest as well as
  // the other protected-standard hashes. Model that persisted filename and
  // HEAD pointer exactly: a public replacement must not be an oracle for it.
  const timestamp = attestation.attestedAt.replace(/[^0-9A-Za-z]+/g, '-').replace(/-$/, '');
  const digest = createHash('sha256')
    .update(`${attestation.kind}:${attestation.attestedAt}:${attestation.repoStandardsHash}:${rawRepoMapHash}:${attestation.authoritySettingsHash}`)
    .digest('hex')
    .slice(0, 12);
  const legacyAttestationId = `${attestation.kind}-${timestamp}-${digest}`;
  attestation.id = legacyAttestationId;
  attestation.surface.claim.id = `veritas.attestation.${legacyAttestationId}`;
  attestation.surface.event.id = `veritas.attestation.${legacyAttestationId}.verified`;
  attestation.surface.event.claimId = `veritas.attestation.${legacyAttestationId}`;
  const legacyPath = join(rootDir, '.veritas/attestations', `${legacyAttestationId}.attestation.json`);
  unlinkSync(path);
  writeFileSync(legacyPath, `${JSON.stringify(attestation, null, 2)}\n`);
  writeFileSync(join(rootDir, '.veritas/attestations/HEAD'), `${JSON.stringify({ currentAttestationId: legacyAttestationId }, null, 2)}\n`);
  return {
    rawRepoMapHash,
    legacyAttestationId,
    legacySurfaceContentHash: attestation.surface.contentHash,
  };
}

async function durableRepoMapHashOutputs(rootDir, runId) {
  const report = await generateVeritasReport({
    rootDir,
    includeAttestationGate: true,
    skipEvidenceCheck: true,
    runId,
    timestamp: '2026-05-11T00:00:00.000Z',
  }, { rootDir }, ['package.json']);
  const attestation = JSON.parse(readFileSync(
    join(rootDir, '.veritas/attestations', `${readJsonFromAbsolute(join(rootDir, '.veritas/attestations/HEAD')).currentAttestationId}.attestation.json`),
    'utf8',
  ));
  return {
    integrity: report.record.integrity,
    governance_state: report.record.governance_state,
    attestation,
    trust: report.record.trust,
  };
}

function configureResolvedApprovalPolicy(rootDir, options = {}) {
  const authorityPath = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const authoritySettings = JSON.parse(readFileSync(authorityPath, 'utf8'));
  authoritySettings.review_preferences.attestation_approval_ref_policy = {
    mode: 'resolved',
    allowed_prefixes: options.allowedPrefixes ?? ['veritas-approval:'],
  };
  writeFileSync(authorityPath, `${JSON.stringify(authoritySettings, null, 2)}\n`);
}

function writeOfflineApprovalRecord(rootDir, id, record) {
  const dir = join(rootDir, '.veritas/authority/approval-records');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.approval.json`);
  writeFileSync(path, `${JSON.stringify({
    schemaVersion: 1,
    id,
    status: 'approved',
    approvalRef: `veritas-approval:${id}`,
    provider: 'veritas-offline',
    authorityRef: id,
    approvedBy: 'change-manager',
    approvedAt: '2026-05-10T00:00:00.000Z',
    ...record,
  }, null, 2)}\n`);
  return path;
}

test('bootstrap attestation records protected standards hashes and status detects drift', () => {
  const rootDir = bootstrapVeritasRepo();
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });

  assert.match(result.path, /\.veritas\/attestations\/.+\.attestation\.json$/);
  assert.equal(result.attestation.repoMapHashAlgorithm, 'public-policy-v1');
  const current = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(current.state, 'current');
  assert.equal(current.expired, false);

  const policyPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.description = `${policy.description} Changed after attestation.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

  const drifted = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(drifted.state, 'drifted');
  assert.deepEqual(drifted.drift.map((item) => item.field), ['repoStandardsHash']);
});

test('legacy unchanged attestation stays current without exposing raw Repo Map hash material', async () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-legacy-unchanged-');
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = readJsonFromAbsolute(repoMapPath);
  repoMap.evidence.evidenceChecks = [{
    id: 'legacy-mcp',
    runner: 'mcp',
    server: { command: 'npx', args: ['-y', 'legacy-low-entropy-secret'], env: { TOKEN: 'legacy-low-entropy-secret' } },
    tool: 'scan',
    input: { token: 'legacy-low-entropy-secret' },
    method: 'validation',
  }];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Legacy-compatible approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const { rawRepoMapHash, legacyAttestationId, legacySurfaceContentHash } = rewriteCurrentAttestationAsLegacy(rootDir);

  const status = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(status.state, 'current');
  assert.equal(status.attestation.repoMapHash, undefined);
  assert.equal(status.attestation.surface, undefined);
  assert.equal(status.attestation.repoMapHashAlgorithm, 'legacy-file-v0');
  assert.equal(status.migrationRecommendation.status, 'recommended');
  assert.notEqual(status.currentAttestationId, legacyAttestationId);
  assert.match(status.currentAttestationId, /^legacy-attestation-v0:/);
  assert.equal(readAttestationHeadFromEngine(rootDir), status.currentAttestationId);
  assert.equal(readCurrentAttestationFromEngine(rootDir).id, status.currentAttestationId);
  assert.equal(readCurrentAttestationFromEngine(rootDir).surface, undefined);

  const report = await generateVeritasReport({
    rootDir,
    includeAttestationGate: true,
    skipEvidenceCheck: true,
    runId: 'legacy-sanitized-output',
    timestamp: '2026-05-11T00:00:00.000Z',
  }, { rootDir }, ['package.json']);
  const cliOutput = execFileSync('node', [
    join(repoRootDir, 'bin/veritas.mjs'), 'attest', 'status', '--root', rootDir,
  ], { cwd: rootDir, encoding: 'utf8' });
  const claims = await attestationSurfaceClaims(rootDir, { runId: 'legacy-sanitized-claims' });
  const durableOutputs = JSON.stringify({
    status,
    engine: readCurrentAttestationFromEngine(rootDir),
    governance: report.record.governance_state,
    trust: report.record.trust,
    claims,
    cli: parseCliJson(cliOutput),
  });
  for (const forbidden of [rawRepoMapHash, legacyAttestationId, legacySurfaceContentHash, 'legacy-low-entropy-secret']) {
    assert.equal(durableOutputs.includes(forbidden), false, `durable output must not expose ${forbidden}`);
  }
  assert.equal(report.record.governance_state.state, 'current');
  assertGeneratedReportSchemas(rootDir, report);
});

test('policy-change successors replace historical raw ID links with the opaque legacy reference', async () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-legacy-successor-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Historical approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const { rawRepoMapHash, legacyAttestationId, legacySurfaceContentHash } = rewriteCurrentAttestationAsLegacy(rootDir);
  const historicalReference = inspectAttestationStatus(rootDir).currentAttestationId;
  const policyPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const policy = readJsonFromAbsolute(policyPath);
  policy.description = `${policy.description} Reviewed successor.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

  const successor = createAttestation({
    rootDir,
    kind: 'policy-change',
    actor: 'brian',
    notes: 'Migrate the legacy attestation after review.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-12T00:00:00.000Z',
  });
  const status = inspectAttestationStatus(rootDir);
  const report = await generateVeritasReport({
    rootDir,
    includeAttestationGate: true,
    skipEvidenceCheck: true,
    runId: 'legacy-successor-output',
    timestamp: '2026-05-12T00:00:00.000Z',
  }, { rootDir }, ['package.json']);

  assert.equal(successor.attestation.priorAttestationId, historicalReference);
  assert.equal(successor.attestation.metadata.supersedes, historicalReference);
  assert.equal(status.state, 'current');
  assert.equal(status.attestation.priorAttestationId, historicalReference);
  assert.equal(status.attestation.metadata.supersedes, historicalReference);
  const durableOutputs = JSON.stringify({ successor, status, engine: readCurrentAttestationFromEngine(rootDir), report });
  for (const forbidden of [rawRepoMapHash, legacyAttestationId, legacySurfaceContentHash]) {
    assert.equal(durableOutputs.includes(forbidden), false, `successor output must not expose ${forbidden}`);
  }
});

test('legacy public references are indistinguishable across raw Repo Map hash candidates', () => {
  const roots = ['alpha', 'beta'].map((secret) => {
    const rootDir = bootstrapVeritasRepo(`veritas-attest-legacy-candidate-${secret}-`);
    const repoMapPath = join(rootDir, '.veritas/repo-map.json');
    const repoMap = readJsonFromAbsolute(repoMapPath);
    repoMap.evidence.evidenceChecks = [{
      id: 'candidate', runner: 'mcp',
      server: { command: 'npx', args: ['-y', `candidate-${secret}`] },
      tool: 'scan', input: { token: `candidate-${secret}` }, method: 'validation',
    }];
    writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
    createAttestation({
      rootDir, kind: 'bootstrap', actor: 'brian', notes: 'Historical approval.',
      approvalRef: HUMAN_APPROVAL_REF, attestedAt: '2026-05-10T00:00:00.000Z',
    });
    return { rootDir, ...rewriteCurrentAttestationAsLegacy(rootDir) };
  });
  const [first, second] = roots;
  assert.notEqual(first.legacyAttestationId, second.legacyAttestationId);
  const firstReference = readAttestationHeadFromEngine(first.rootDir);
  const secondReference = readAttestationHeadFromEngine(second.rootDir);
  assert.equal(firstReference, secondReference);
  for (const candidate of roots) {
    const publicOutput = JSON.stringify({
      head: readAttestationHeadFromEngine(candidate.rootDir),
      current: readCurrentAttestationFromEngine(candidate.rootDir),
      status: inspectAttestationStatus(candidate.rootDir),
    });
    for (const forbidden of [candidate.rawRepoMapHash, candidate.legacyAttestationId, `candidate-${candidate === first ? 'alpha' : 'beta'}`]) {
      assert.equal(publicOutput.includes(forbidden), false, 'public legacy output must not distinguish raw candidates');
    }
  }
});

test('legacy Repo Map file drift fails closed with redacted schema-compatible evidence', async () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-legacy-drift-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Legacy-compatible approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const { rawRepoMapHash } = rewriteCurrentAttestationAsLegacy(rootDir);
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = readJsonFromAbsolute(repoMapPath);
  repoMap.graph.defaultResolution.workstream = 'Changed after legacy attestation';
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);

  const status = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(status.state, 'drifted');
  assert.deepEqual(status.drift, [{ field: 'repoMapHash', attested: null, current: null }]);
  assert.equal(JSON.stringify(status).includes(rawRepoMapHash), false);
  const report = await generateVeritasReport({
    rootDir,
    includeAttestationGate: true,
    skipEvidenceCheck: true,
    runId: 'legacy-redacted-drift',
    timestamp: '2026-05-11T00:00:00.000Z',
  }, { rootDir }, ['package.json']);
  assert.deepEqual(report.record.governance_state.drift, status.drift);
  assert.equal(JSON.stringify(report).includes(rawRepoMapHash), false);
  assertGeneratedReportSchemas(rootDir, report);
});

test('all durable Repo Map hash outputs redact MCP runtime inputs and retain public-policy drift', async () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-redacted-hash-');
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks = [{
    id: 'mcp-runtime-check',
    runner: 'mcp',
    server: {
      command: 'npx',
      args: ['-y', 'low-entropy-secret-alpha'],
      env: { TOKEN: 'low-entropy-secret-alpha' },
    },
    tool: 'scan',
    input: { token: 'low-entropy-secret-alpha' },
    method: 'validation',
  }];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);

  const firstHashes = hashProtectedStandards(rootDir);
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Reviewed redacted Repo Map policy.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  assert.equal(inspectAttestationStatus(rootDir).attestation.repoMapHashAlgorithm, 'public-policy-v1');
  const firstOutputs = await durableRepoMapHashOutputs(rootDir, 'redacted-repo-map-hash');

  const replacement = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  replacement.evidence.evidenceChecks[0].server.args = ['-y', 'low-entropy-secret-beta'];
  replacement.evidence.evidenceChecks[0].server.env.TOKEN = 'low-entropy-secret-beta';
  replacement.evidence.evidenceChecks[0].input.token = 'low-entropy-secret-beta';
  writeFileSync(repoMapPath, `${JSON.stringify(replacement, null, 2)}\n`);

  const secondHashes = hashProtectedStandards(rootDir);
  const secondOutputs = await durableRepoMapHashOutputs(rootDir, 'redacted-repo-map-hash');
  const allOutput = JSON.stringify({ firstOutputs, secondOutputs });
  assert.equal(allOutput.includes('low-entropy-secret-alpha'), false);
  assert.equal(allOutput.includes('low-entropy-secret-beta'), false);
  assert.equal(secondHashes.repoMapHash, firstHashes.repoMapHash);
  assert.deepEqual(sha256Dictionary(secondOutputs), sha256Dictionary(firstOutputs));
  assert.equal(firstOutputs.integrity.configRefs.repoMap.hash, firstHashes.repoMapHash);
  assert.ok(firstOutputs.governance_state.protectedStandards.hashes.repoMapHash);
  assert.equal(firstOutputs.attestation.repoMapHash, firstHashes.repoMapHash);
  assert.ok(firstOutputs.trust.bundle);

  replacement.graph.defaultResolution.workstream = 'Changed public policy';
  writeFileSync(repoMapPath, `${JSON.stringify(replacement, null, 2)}\n`);
  assert.notEqual(hashProtectedStandards(rootDir).repoMapHash, firstHashes.repoMapHash);
  assert.equal(inspectAttestationStatus(rootDir).state, 'drifted');
});

test('policy-change attestation chains to prior attestation and refreshes drift', () => {
  const rootDir = bootstrapVeritasRepo();
  const bootstrap = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const policyPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.description = `${policy.description} Human-reviewed update.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const change = createAttestation({
    rootDir,
    kind: 'policy-change',
    actor: 'brian',
    notes: 'Reviewed policy description change.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-12T00:00:00.000Z',
  });

  assert.equal(change.attestation.priorAttestationId, bootstrap.attestation.id);
  assert.equal(inspectAttestationStatus(rootDir).state, 'current');
});

test('expired attestation is warned but not drifted', () => {
  const rootDir = bootstrapVeritasRepo();
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Short validity.',
    approvalRef: HUMAN_APPROVAL_REF,
    validUntilDays: 1,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const status = inspectAttestationStatus(rootDir, { now: '2026-05-12T00:00:00.000Z' });
  assert.equal(status.state, 'current');
  assert.equal(status.expired, true);
});

test('surface input projects current governance artifact claims distinctly from policy results', async () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-surface-current-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });

  const claims = await attestationSurfaceClaims(rootDir, { runId: 'current-governance-claims' });
  const policyResult = claims.find((claim) =>
    claim.claimType === 'veritas-policy-result' &&
    claim.value?.ruleId === 'policy-changes-require-attestation'
  );
  const authoredGovernance = governanceClaim(claims);

  assert.equal(policyResult?.status, undefined);
  assert.equal(authoredGovernance.claimType, 'veritas-governance-artifact');
  assert.equal(authoredGovernance.status, 'verified');
  assert.equal(authoredGovernance.facet, 'veritas.governance');
});

test('surface input projects missing, drifted, and expired governance attestation states', async () => {
  const missingRoot = bootstrapVeritasRepo('veritas-attest-surface-missing-');
  const missingClaims = await attestationSurfaceClaims(missingRoot, { runId: 'missing-governance-claims' });
  assert.equal(governanceClaim(missingClaims).status, 'disputed');

  const driftRoot = bootstrapVeritasRepo('veritas-attest-surface-drift-');
  createAttestation({
    rootDir: driftRoot,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const policyPath = join(driftRoot, '.veritas/repo-standards/default.repo-standards.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.description = `${policy.description} Drift for surface claims.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const driftClaims = await attestationSurfaceClaims(driftRoot, { runId: 'drift-governance-claims' });
  assert.equal(governanceClaim(driftClaims).status, 'disputed');

  const expiredRoot = bootstrapVeritasRepo('veritas-attest-surface-expired-');
  createAttestation({
    rootDir: expiredRoot,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Short validity.',
    approvalRef: HUMAN_APPROVAL_REF,
    validUntilDays: 1,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const expiredClaims = await attestationSurfaceClaims(expiredRoot, {
    runId: 'expired-governance-claims',
    attestationNow: '2026-05-12T00:00:00.000Z',
  });
  assert.equal(governanceClaim(expiredClaims).status, 'stale');
});

test('readiness check prints a warning for expired attestation', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-expired-readiness-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Short validity.',
    approvalRef: HUMAN_APPROVAL_REF,
    validUntilDays: 1,
    attestedAt: '2020-01-01T00:00:00.000Z',
  });
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'readiness',
    '--root',
    rootDir,
    '--skip-evidence-check',
    '--working-tree',
  ], { cwd: rootDir, encoding: 'utf8' });
  assert.match(output, /WARN\s+policy-changes-require-attestation/);
  assert.match(output, /expired/i);
});

test('attestation rule is visible to explain context', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-explain-');
  const text = buildExplainText({
    rootDir,
    repoMap: readJsonFromAbsolute(join(rootDir, '.veritas/repo-map.json')),
    repoStandards: readJsonFromAbsolute(join(rootDir, '.veritas/repo-standards/default.repo-standards.json')),
    ruleId: 'policy-changes-require-attestation',
  });
  assert.match(text, /Rule: policy-changes-require-attestation/);
  assert.match(text, /Readiness checks fail on drift until a valid authority records a fresh attestation/);
});

test('attestation refuses CI or bot actors', () => {
  const rootDir = bootstrapVeritasRepo();
  assert.throws(
    () => createAttestation({
      rootDir,
      kind: 'bootstrap',
      actor: 'github-actions[bot]',
      approvalRef: HUMAN_APPROVAL_REF,
    }),
    /non-human actor/,
  );
});

test('attestation requires an explicit human approval reference', () => {
  const rootDir = bootstrapVeritasRepo();
  assert.throws(
    () => createAttestation({
      rootDir,
      kind: 'bootstrap',
      actor: 'brian',
      notes: 'Initial human approval.',
    }),
    /requires --approval-ref/,
  );
});

test('attestation approval reference can be constrained by authority settings', () => {
  const rootDir = bootstrapVeritasRepo();
  const authorityPath = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const authoritySettings = JSON.parse(readFileSync(authorityPath, 'utf8'));
  authoritySettings.review_preferences.attestation_approval_ref_policy = {
    mode: 'prefix',
    allowed_prefixes: ['servicenow:change/'],
  };
  writeFileSync(authorityPath, `${JSON.stringify(authoritySettings, null, 2)}\n`);

  assert.throws(
    () => createAttestation({
      rootDir,
      kind: 'bootstrap',
      actor: 'brian',
      notes: 'Initial human approval.',
      approvalRef: 'github:pull-request/123',
    }),
    /approval reference must start with one of: servicenow:change\//,
  );

  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: 'servicenow:change/CHG12345',
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  assert.equal(result.attestation.metadata.approvalRefPolicy.matchedPrefix, 'servicenow:change/');
});

test('attestation records normalized resolver-backed approval metadata', () => {
  const rootDir = bootstrapVeritasRepo();
  const authorityPath = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const authoritySettings = JSON.parse(readFileSync(authorityPath, 'utf8'));
  authoritySettings.review_preferences.attestation_approval_ref_policy = {
    mode: 'resolved',
    allowed_prefixes: ['servicenow:change/'],
  };
  writeFileSync(authorityPath, `${JSON.stringify(authoritySettings, null, 2)}\n`);

  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: 'servicenow:change/CHG12345',
    approvalResolverResult: {
      status: 'approved',
      approvalRef: 'servicenow:change/CHG12345',
      provider: 'servicenow',
      authorityRef: 'CHG12345',
      approvedBy: 'change-manager',
      approvedAt: '2026-05-10T00:00:00.000Z',
      evidenceHash: 'sha256:approval',
      resolvedAt: '2026-05-10T00:05:00.000Z',
    },
    attestedAt: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(result.attestation.metadata.approvalRefPolicy.requiresResolution, true);
  assert.equal(result.attestation.metadata.approvalResolution.status, 'approved');
  assert.equal(result.attestation.metadata.approvalResolution.provider, 'servicenow');
  assert.equal(result.attestation.metadata.approvalResolution.failureReason, null);
});

test('resolved approval reference policy rejects unresolved resolver results', () => {
  const rootDir = bootstrapVeritasRepo();
  const authorityPath = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const authoritySettings = JSON.parse(readFileSync(authorityPath, 'utf8'));
  authoritySettings.review_preferences.attestation_approval_ref_policy = {
    mode: 'resolved',
  };
  writeFileSync(authorityPath, `${JSON.stringify(authoritySettings, null, 2)}\n`);

  assert.throws(
    () => createAttestation({
      rootDir,
      kind: 'bootstrap',
      actor: 'brian',
      notes: 'Initial human approval.',
      approvalRef: 'servicenow:change/CHG12345',
    }),
    /approval reference was not accepted by resolver: unresolved/,
  );

  assert.throws(
    () => createAttestation({
      rootDir,
      kind: 'bootstrap',
      actor: 'brian',
      notes: 'Initial human approval.',
      approvalRef: 'servicenow:change/CHG12345',
      approvalResolverResult: {
        status: 'rejected',
        approvalRef: 'servicenow:change/CHG12345',
        provider: 'servicenow',
        failureReason: 'change is not approved',
      },
    }),
    /approval reference was not accepted by resolver: rejected/,
  );
});

test('resolved approval reference policy uses offline approval records', () => {
  const rootDir = bootstrapVeritasRepo();
  configureResolvedApprovalPolicy(rootDir);
  writeOfflineApprovalRecord(rootDir, 'chg-123', {
    scope: {
      attestationKinds: ['bootstrap'],
    },
  });

  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: 'veritas-approval:chg-123',
    attestedAt: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(result.attestation.metadata.approvalResolution.status, 'approved');
  assert.equal(result.attestation.metadata.approvalResolution.provider, 'veritas-offline');
  assert.equal(result.attestation.metadata.approvalResolution.authorityRef, 'chg-123');
  assert.match(result.attestation.metadata.approvalResolution.evidenceHash, /^sha256:/);
});

test('resolved approval reference policy blocks missing, rejected, expired, and out-of-scope offline records before write', () => {
  const rootDir = bootstrapVeritasRepo();
  configureResolvedApprovalPolicy(rootDir);
  writeOfflineApprovalRecord(rootDir, 'rejected', {
    status: 'rejected',
    failureReason: 'change was rejected',
  });
  writeOfflineApprovalRecord(rootDir, 'expired', {
    expiresAt: '2026-05-09T00:00:00.000Z',
  });
  writeOfflineApprovalRecord(rootDir, 'wrong-kind', {
    scope: {
      attestationKinds: ['policy-change'],
    },
  });

  for (const [approvalRef, pattern] of [
    ['veritas-approval:missing', /not accepted by resolver: unresolved/],
    ['veritas-approval:rejected', /not accepted by resolver: rejected/],
    ['veritas-approval:expired', /not accepted by resolver: expired/],
    ['veritas-approval:wrong-kind', /not accepted by resolver: out-of-scope/],
  ]) {
    assert.throws(
      () => createAttestation({
        rootDir,
        kind: 'bootstrap',
        actor: 'brian',
        notes: 'Initial human approval.',
        approvalRef,
        attestedAt: '2026-05-10T00:00:00.000Z',
      }),
      pattern,
    );
  }

  assert.equal(existsSync(join(rootDir, '.veritas/attestations/HEAD')), false);
});

test('CLI bootstrap can satisfy resolved policy with an offline approval record', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-offline-cli-');
  configureResolvedApprovalPolicy(rootDir);
  writeOfflineApprovalRecord(rootDir, 'cli-approved', {
    scope: {
      attestationKinds: ['bootstrap'],
    },
  });
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'attest',
    'bootstrap',
    '--root',
    rootDir,
    '--actor',
    'brian',
    '--approval-ref',
    'veritas-approval:cli-approved',
    '--non-interactive',
  ], { cwd: rootDir, encoding: 'utf8' });
  const result = parseCliJson(output);
  assert.equal(result.attestation.metadata.approvalResolution.status, 'approved');
  assert.equal(result.attestation.metadata.approvalResolution.authorityRef, 'cli-approved');
});

test('CLI bootstrap writes tracked attestation and readiness check fails on protected standards drift until policy-change attestation', () => {
  const rootDir = bootstrapVeritasRepo();
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const bootstrapOutput = execFileSync('node', [
    cli,
    'attest',
    'bootstrap',
    '--root',
    rootDir,
    '--actor',
    'brian',
    '--approval-ref',
    HUMAN_APPROVAL_REF,
    '--non-interactive',
  ], { cwd: rootDir, encoding: 'utf8' });
  const bootstrap = parseCliJson(bootstrapOutput);
  assert.equal(readJsonFromAbsolute(join(rootDir, '.veritas/attestations/HEAD')).currentAttestationId, bootstrap.attestation.id);
  assert.equal(bootstrap.attestation.metadata.approvalRef, HUMAN_APPROVAL_REF);

  const policyPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.description = `${policy.description} Drift for readiness check.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

  assert.throws(
    () => execFileSync('node', [
      cli,
      'readiness',
      '--root',
      rootDir,
      '--skip-evidence-check',
      '--working-tree',
    ], { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' }),
    (error) => {
      assert.match(error.stdout.toString(), /FAIL\s+policy-changes-require-attestation/);
      return true;
    },
  );

  execFileSync('node', [
    cli,
    'attest',
    'policy-change',
    '--root',
    rootDir,
    '--actor',
    'brian',
    '--message',
    'Reviewed policy drift.',
    '--approval-ref',
    HUMAN_APPROVAL_REF,
  ], { cwd: rootDir, encoding: 'utf8' });
  const readinessOutput = execFileSync('node', [
    cli,
    'readiness',
    '--root',
    rootDir,
    '--skip-evidence-check',
    '--working-tree',
  ], { cwd: rootDir, encoding: 'utf8' });
  assert.match(readinessOutput, /PASS\s+policy-changes-require-attestation/);
});

// ─── Testimony Admissibility Tests ────────────────────────────────────────

import { buildAuthorizing, computeAdmissibilityWarning } from '../src/attestations/collection.mjs';

// --- buildAuthorizing unit tests ---

test('buildAuthorizing returns null when no authorizing options provided', () => {
  assert.equal(buildAuthorizing({}), null);
  assert.equal(buildAuthorizing(), null);
});

test('buildAuthorizing builds explicit-statement block', () => {
  const block = buildAuthorizing({ statement: 'Reviewed policy update' });
  assert.deepEqual(block, { kind: 'explicit-statement', statement: 'Reviewed policy update' });
});

test('buildAuthorizing trims statement whitespace', () => {
  const block = buildAuthorizing({ statement: '  approved  ' });
  assert.equal(block.statement, 'approved');
});

test('buildAuthorizing builds exchange block with source', () => {
  const block = buildAuthorizing({
    prompt: 'Did you review the change?',
    response: 'Yes, I approved it.',
    excerptSource: 'slack://channel/123',
  });
  assert.equal(block.kind, 'exchange');
  assert.equal(block.prompt, 'Did you review the change?');
  assert.equal(block.response, 'Yes, I approved it.');
  assert.equal(block.source, 'slack://channel/123');
});

test('buildAuthorizing builds exchange block without source', () => {
  const block = buildAuthorizing({
    prompt: 'Approve?',
    response: 'Approved.',
  });
  assert.equal(block.kind, 'exchange');
  assert.equal(block.source, undefined);
});

test('buildAuthorizing exchange throws when prompt missing', () => {
  assert.throws(
    () => buildAuthorizing({ response: 'Approved.' }),
    /kind=exchange requires --authorizing-prompt/,
  );
});

test('buildAuthorizing exchange throws when response missing', () => {
  assert.throws(
    () => buildAuthorizing({ prompt: 'Approve?' }),
    /kind=exchange requires --authorizing-response/,
  );
});

test('buildAuthorizing builds authorized-action block', () => {
  const block = buildAuthorizing({
    promptRef: 'prompt://abc',
    renderedPrompt: 'Confirm policy change',
    action: 'affirmed-control',
    authorityRef: 'ui://session/42',
  });
  assert.equal(block.kind, 'authorized-action');
  assert.equal(block.promptRef, 'prompt://abc');
  assert.equal(block.renderedPrompt, 'Confirm policy change');
  assert.equal(block.action, 'affirmed-control');
  assert.equal(block.authorityRef, 'ui://session/42');
});

test('buildAuthorizing authorized-action throws when fields missing', () => {
  assert.throws(
    () => buildAuthorizing({ promptRef: 'x', renderedPrompt: 'y', action: 'typed' }),
    /kind=authorized-action requires all four fields.*--authority-ref/,
  );
  assert.throws(
    () => buildAuthorizing({ promptRef: 'x', renderedPrompt: 'y', authorityRef: 'z' }),
    /kind=authorized-action requires all four fields.*--action/,
  );
});

test('buildAuthorizing authorized-action throws for invalid action value', () => {
  assert.throws(
    () => buildAuthorizing({
      promptRef: 'x',
      renderedPrompt: 'y',
      action: 'invalid-action',
      authorityRef: 'z',
    }),
    /action must be one of: affirmed-control, typed/,
  );
});

test('buildAuthorizing throws on ambiguous mixed fields', () => {
  assert.throws(
    () => buildAuthorizing({
      statement: 'approved',
      prompt: 'Did you approve?',
    }),
    /conflicting or ambiguous/,
  );
});

// --- computeAdmissibilityWarning unit tests ---

test('computeAdmissibilityWarning returns no warning for null authorizing', () => {
  const result = computeAdmissibilityWarning({ authorizing: null, changedFields: [], notes: '' });
  assert.equal(result.admissibilityWarning, false);
  assert.equal(result.admissibilityWarningReason, null);
});

test('computeAdmissibilityWarning returns no warning for non-explicit-statement kind', () => {
  const result = computeAdmissibilityWarning({
    authorizing: { kind: 'exchange', prompt: 'x', response: 'y' },
    changedFields: ['repoStandardsHash'],
    notes: 'policy update',
  });
  assert.equal(result.admissibilityWarning, false);
});

test('computeAdmissibilityWarning warns when explicit-statement has no token overlap', () => {
  const result = computeAdmissibilityWarning({
    authorizing: { kind: 'explicit-statement', statement: 'banana orange grape' },
    changedFields: ['repoStandardsHash'],
    notes: 'Updated governance rules',
  });
  assert.equal(result.admissibilityWarning, true);
  assert.match(result.admissibilityWarningReason, /no token overlap/);
});

test('computeAdmissibilityWarning no warning when statement overlaps with notes', () => {
  const result = computeAdmissibilityWarning({
    authorizing: { kind: 'explicit-statement', statement: 'Reviewed policy update' },
    changedFields: ['repoStandardsHash'],
    notes: 'Reviewed the policy change with team',
  });
  assert.equal(result.admissibilityWarning, false);
});

test('computeAdmissibilityWarning no warning when statement overlaps with field names', () => {
  const result = computeAdmissibilityWarning({
    authorizing: { kind: 'explicit-statement', statement: 'Approved standards change' },
    changedFields: ['repoStandardsHash'],
    notes: '',
  });
  assert.equal(result.admissibilityWarning, false);
});

// --- Integration tests: createAttestation with authorizing ---

test('createAttestation persists explicit-statement authorizing block', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-authorizing-explicit-');
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Reviewed policy.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
    authorizing: { kind: 'explicit-statement', statement: 'Reviewed policy.' },
  });
  assert.equal(result.attestation.authorizing.kind, 'explicit-statement');
  assert.equal(result.attestation.authorizing.statement, 'Reviewed policy.');
});

test('createAttestation persists exchange authorizing block', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-authorizing-exchange-');
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Delegated approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
    authorizing: {
      kind: 'exchange',
      prompt: 'Do you approve this policy?',
      response: 'Yes, approved.',
      source: 'slack://team-channel',
    },
  });
  assert.equal(result.attestation.authorizing.kind, 'exchange');
  assert.equal(result.attestation.authorizing.prompt, 'Do you approve this policy?');
  assert.equal(result.attestation.authorizing.response, 'Yes, approved.');
  assert.equal(result.attestation.authorizing.source, 'slack://team-channel');
});

test('createAttestation persists authorized-action authorizing block', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-authorizing-action-');
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'UI approval.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
    authorizing: {
      kind: 'authorized-action',
      promptRef: 'prompt://ui/confirm',
      renderedPrompt: 'Confirm the policy change',
      action: 'affirmed-control',
      authorityRef: 'ui://session/99',
    },
  });
  assert.equal(result.attestation.authorizing.kind, 'authorized-action');
  assert.equal(result.attestation.authorizing.action, 'affirmed-control');
});

test('createAttestation without authorizing is still valid (old-record compat)', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-no-authorizing-');
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'No authorizing block.',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  assert.equal(result.attestation.authorizing, undefined);
  // Status should still read fine
  const status = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(status.state, 'current');
  assert.equal(status.admissibilityWarning, false);
});

test('admissibility warning is set when explicit-statement has no overlap', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-admis-warn-');
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial setup',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
    authorizing: { kind: 'explicit-statement', statement: 'banana orange grape fruit' },
  });
  assert.equal(result.attestation.admissibilityWarning, true);
  assert.match(result.attestation.admissibilityWarningReason, /no token overlap/);
  const status = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(status.admissibilityWarning, true);
  assert.equal(status.state, 'current');
});

test('admissibility warning is NOT set when explicit-statement overlaps with notes', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-admis-pass-');
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Reviewed standards change with team',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
    authorizing: { kind: 'explicit-statement', statement: 'Reviewed standards change' },
  });
  assert.equal(result.attestation.admissibilityWarning, undefined);
  const status = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(status.admissibilityWarning, false);
});

test('admissibility warning does not fail readiness (PASS with annotation)', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-admis-readiness-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Setup',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2020-01-01T00:00:00.000Z',
    authorizing: { kind: 'explicit-statement', statement: 'banana orange grape' },
    validUntilDays: 36500,
  });
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'readiness',
    '--root',
    rootDir,
    '--skip-evidence-check',
    '--working-tree',
  ], { cwd: rootDir, encoding: 'utf8' });
  // Should PASS (not fail) and contain admissibility warning annotation
  assert.match(output, /PASS\s+policy-changes-require-attestation/);
  assert.match(output, /admissibility warning/);
});

test('a generated record with governance admissibility fields conforms to the evidence schema', async () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-governance-schema-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Setup',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2020-01-01T00:00:00.000Z',
    authorizing: { kind: 'explicit-statement', statement: 'banana orange grape' },
    validUntilDays: 36500,
  });
  const result = await generateVeritasReport({
    rootDir,
    includeAttestationGate: true,
    skipEvidenceCheck: true,
    workingTree: true,
    runId: 'governance-schema-conformance',
  }, { rootDir }, ['package.json']);
  const schema = JSON.parse(readFileSync(join(repoRootDir, 'schemas/veritas-evidence.schema.json'), 'utf8'));
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(result.record), true, JSON.stringify(validate.errors));
  assert.equal(typeof result.record.governance_state.admissibilityWarning, 'boolean');
  assert.ok(
    result.record.governance_state.admissibilityWarningReason === null ||
      typeof result.record.governance_state.admissibilityWarningReason === 'string',
  );
});

test('CLI --executed-by requires --authorizing-statement or exchange pair', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-execby-err-');
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  assert.throws(
    () => execFileSync('node', [
      cli,
      'attest',
      'bootstrap',
      '--root', rootDir,
      '--actor', 'brian',
      '--approval-ref', HUMAN_APPROVAL_REF,
      '--executed-by', 'brian',
      '--non-interactive',
    ], { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' }),
    (error) => {
      const combined = (error.stdout ?? '') + (error.stderr ?? '');
      assert.match(combined, /--executed-by requires either --authorizing-statement/);
      return true;
    },
  );
});

test('CLI --executed-by with --authorizing-statement creates explicit-statement block', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-execby-stmt-');
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'attest',
    'bootstrap',
    '--root', rootDir,
    '--actor', 'brian',
    '--approval-ref', HUMAN_APPROVAL_REF,
    '--executed-by', 'brian',
    '--authorizing-statement', 'Reviewed and approved the initial standards',
    '--non-interactive',
  ], { cwd: rootDir, encoding: 'utf8' });
  const result = parseCliJson(output);
  assert.equal(result.attestation.authorizing.kind, 'explicit-statement');
  assert.equal(result.attestation.authorizing.statement, 'Reviewed and approved the initial standards');
});

test('CLI exchange flags require both prompt and response', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-exchange-err-');
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  assert.throws(
    () => execFileSync('node', [
      cli,
      'attest',
      'bootstrap',
      '--root', rootDir,
      '--actor', 'brian',
      '--approval-ref', HUMAN_APPROVAL_REF,
      '--authorizing-prompt', 'Did you approve?',
      '--non-interactive',
    ], { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' }),
    (error) => {
      const combined = (error.stdout ?? '') + (error.stderr ?? '');
      assert.match(combined, /kind=exchange requires --authorizing-response/);
      return true;
    },
  );
});

test('CLI attest status shows admissibility warning', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-status-admis-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Setup',
    approvalRef: HUMAN_APPROVAL_REF,
    attestedAt: '2026-05-10T00:00:00.000Z',
    authorizing: { kind: 'explicit-statement', statement: 'banana orange grape' },
  });
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'attest',
    'status',
    '--root', rootDir,
  ], { cwd: rootDir, encoding: 'utf8' });
  const statusResult = parseCliJson(output);
  assert.equal(statusResult.admissibilityWarning, true);
  assert.match(statusResult.admissibilityWarningReason, /no token overlap/);
});
