import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrustReport } from '@kontourai/surface';
import {
  createAttestation,
  buildExplainText,
  generateVeritasReport,
  inspectAttestationStatus,
  writeBootstrapStarterKit,
} from '../src/index.mjs';
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
  return buildTrustReport(result.record.surface.input, {
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
  assert.equal(authoredGovernance.surface, 'veritas.governance');
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
