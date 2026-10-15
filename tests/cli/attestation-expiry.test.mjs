// An expired attestation fails readiness closed, the same way drift does, while
// a pending or missing attestation stays advisory (#202).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAttestation } from '../../src/attestations.mjs';
import { inspectAttestationStatus, runMergeReadiness } from '../../src/engine.mjs';
import { commitAll, initCommittedRepo, parseCliJson, repoRootDir } from '../helpers.mjs';

const veritasBin = join(repoRootDir, 'bin/veritas.mjs');
const RULE_ID = 'policy-changes-require-attestation';
const APPROVAL_REF = 'test://human-approved-attestation';
// Re-attesting is the remedy the FAIL line names; pinned as a literal here.
const REMEDY = 'npx --no @kontourai/veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference>';
// Attested 2020-01-01 for one day: expired at this literal for any wall clock
// after it, so the CLI cases need no sleep and no clock flag.
const EXPIRED_ATTESTED_AT = '2020-01-01T00:00:00.000Z';
const EXPIRED_VALID_UNTIL = '2020-01-02T00:00:00.000Z';

function veritas(rootDir, args) {
  return spawnSync(process.execPath, [veritasBin, ...args, '--root', rootDir], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

function readiness(rootDir, args = []) {
  return veritas(rootDir, ['readiness', '--working-tree', '--force', ...args]);
}

// A fresh repo initialised by the real CLI. Its Repo Map requires one passing
// Evidence Check, so the attestation rule is the only thing that can block.
function initFixture(t, prefix, { nonInteractive = false } = {}) {
  const rootDir = initCommittedRepo(t, prefix);
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  execFileSync(
    process.execPath,
    [
      veritasBin, 'init', '--root', rootDir, '--project-name', 'Attestation Expiry Fixture',
      '--evidence-check', 'node -e "process.exit(0)"',
      ...(nonInteractive ? ['--non-interactive'] : []),
    ],
    { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' },
  );
  commitAll(rootDir, 'Bootstrap Veritas');
  return rootDir;
}

function attestBootstrapCli(rootDir) {
  const result = veritas(rootDir, [
    'attest', 'bootstrap', '--actor', 'owner', '--approval-ref', APPROVAL_REF, '--non-interactive',
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function recordExpiredAttestation(rootDir) {
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'owner',
    notes: 'One-day validity window.',
    approvalRef: APPROVAL_REF,
    validUntilDays: 1,
    attestedAt: EXPIRED_ATTESTED_AT,
  });
}

function editTrackedFile(rootDir) {
  commitAll(rootDir, 'Record attestation');
  writeFileSync(join(rootDir, 'package.json'), '{"name":"changed"}\n');
}

function ruleLine(stdout) {
  return stdout.split('\n').find((line) => line.includes(`${RULE_ID}:`)) ?? '';
}

function readinessClaim(bundle) {
  const claims = bundle.claims.filter((claim) => claim.claimType === 'software-readiness-verdict');
  assert.equal(claims.length, 1);
  return claims[0];
}

function assertJsonVerdict(rootDir, runId, expected) {
  const json = readiness(rootDir, ['--format', 'json', '--run-id', runId]);
  assert.equal(json.status, expected.exit, json.stdout + json.stderr);
  const output = parseCliJson(json.stdout);
  assert.equal(output.readiness.status, expected.status);
  assert.equal(output.readiness.verdict, expected.verdict);

  const bundleRun = readiness(rootDir, ['--format', 'trust-bundle', '--run-id', `${runId}-bundle`]);
  assert.equal(bundleRun.status, expected.exit, bundleRun.stdout + bundleRun.stderr);
  assert.equal(readinessClaim(JSON.parse(bundleRun.stdout)).status, expected.claimStatus);
}

test('CLI: a valid attestation passes readiness', (t) => {
  const rootDir = initFixture(t, 'veritas-expiry-valid-');
  attestBootstrapCli(rootDir);
  editTrackedFile(rootDir);

  const feedback = readiness(rootDir);
  assert.equal(feedback.status, 0, feedback.stdout + feedback.stderr);
  assert.match(ruleLine(feedback.stdout), /^PASS\s+policy-changes-require-attestation: Active attestation \S+ matches current protected standards hashes\./);
  assertJsonVerdict(rootDir, 'expiry-valid', { exit: 0, status: 'pass', verdict: 'ready', claimStatus: 'verified' });
});

test('CLI: an expired attestation fails readiness and names the re-attest command', (t) => {
  const rootDir = initFixture(t, 'veritas-expiry-expired-');
  recordExpiredAttestation(rootDir);
  editTrackedFile(rootDir);

  const status = veritas(rootDir, ['attest', 'status']);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  const attestStatus = parseCliJson(status.stdout);
  assert.equal(attestStatus.state, 'current', 'expiry is not drift');
  assert.equal(attestStatus.expired, true);
  assert.equal(attestStatus.validUntil, EXPIRED_VALID_UNTIL);

  const feedback = readiness(rootDir);
  assert.equal(feedback.status, 1, feedback.stdout + feedback.stderr);
  assert.match(
    ruleLine(feedback.stdout),
    new RegExp(`^FAIL\\s+${RULE_ID}: Active attestation \\S+ expired at ${EXPIRED_VALID_UNTIL.replaceAll('.', '\\.')}; readiness fails until an authority records a fresh attestation\\.$`),
  );
  assert.ok(feedback.stdout.includes(REMEDY), feedback.stdout);
  assert.match(feedback.stdout, /^1 failure /m);
  assertJsonVerdict(rootDir, 'expiry-expired', { exit: 1, status: 'fail', verdict: 'not-ready', claimStatus: 'rejected' });

  // The named remedy clears it: a fresh policy-change attestation over the
  // same, unchanged standards.
  const reattest = veritas(rootDir, [
    'attest', 'policy-change', '--message', 'Renew the lapsed attestation after review.',
    '--actor', 'owner', '--approval-ref', APPROVAL_REF,
  ]);
  assert.equal(reattest.status, 0, reattest.stdout + reattest.stderr);
  const renewed = readiness(rootDir);
  assert.equal(renewed.status, 0, renewed.stdout + renewed.stderr);
  assert.match(ruleLine(renewed.stdout), /^PASS\s+policy-changes-require-attestation: /);
});

test('CLI: a stale attestation (protected standards drift) still fails readiness', (t) => {
  const rootDir = initFixture(t, 'veritas-expiry-stale-');
  attestBootstrapCli(rootDir);
  commitAll(rootDir, 'Record attestation');
  const standardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const standards = JSON.parse(readFileSync(standardsPath, 'utf8'));
  standards.description = `${standards.description} Unreviewed edit.`;
  writeFileSync(standardsPath, `${JSON.stringify(standards, null, 2)}\n`);

  const feedback = readiness(rootDir);
  assert.equal(feedback.status, 1, feedback.stdout + feedback.stderr);
  assert.match(ruleLine(feedback.stdout), /^FAIL\s+policy-changes-require-attestation: Current protected standards hashes do not match the active attestation\.$/);
  assertJsonVerdict(rootDir, 'expiry-stale', { exit: 1, status: 'fail', verdict: 'not-ready', claimStatus: 'rejected' });
});

for (const [label, nonInteractive] of [['missing', false], ['pending', true]]) {
  test(`CLI: a ${label} attestation stays advisory`, (t) => {
    const rootDir = initFixture(t, `veritas-expiry-${label}-`, { nonInteractive });
    assert.equal(inspectAttestationStatus(rootDir).state, label);
    writeFileSync(join(rootDir, 'package.json'), '{"name":"changed"}\n');

    const feedback = readiness(rootDir);
    assert.equal(feedback.status, 0, feedback.stdout + feedback.stderr);
    assert.match(ruleLine(feedback.stdout), /^WARN\s+policy-changes-require-attestation: No active attestation found; readiness is advisory until bootstrap attestation is recorded\.$/);
    assertJsonVerdict(rootDir, `expiry-${label}`, { exit: 0, status: 'pass', verdict: 'ready', claimStatus: 'verified' });
  });
}

test('engine: expiry is judged at the run timestamp, so the same record passes then fails', async (t) => {
  const rootDir = initFixture(t, 'veritas-expiry-engine-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'owner',
    notes: 'One-day validity window.',
    approvalRef: APPROVAL_REF,
    validUntilDays: 1,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  editTrackedFile(rootDir);

  const run = (timestamp, runId) => runMergeReadiness(
    { rootDir, runId, workingTree: true, force: true, timestamp },
    { rootDir },
    [],
    { appendHistory: false },
  );
  const attestationResult = (result) =>
    result.reportResult.record.policy_results.find((policy) => policy.rule_id === RULE_ID);

  // validUntil is inclusive: at exactly attestedAt + 1 day the record is valid.
  const atValidUntil = await run('2026-05-11T00:00:00.000Z', 'engine-at-valid-until');
  assert.equal(atValidUntil.currentStatus, 'pass');
  assert.equal(attestationResult(atValidUntil).status, 'pass');
  assert.equal(readinessClaim(atValidUntil.reportResult.record.trust.bundle).status, 'verified');

  const afterValidUntil = await run('2026-05-11T00:00:00.001Z', 'engine-after-valid-until');
  assert.equal(afterValidUntil.currentStatus, 'fail');
  const failed = attestationResult(afterValidUntil);
  assert.equal(failed.enforcementLevel, 'Require');
  assert.equal(failed.passed, false);
  assert.equal(failed.status, 'fail');
  assert.equal(failed.findings[0].kind, 'expired-attestation');
  assert.ok(failed.findings[0].remediation.includes(REMEDY), failed.findings[0].remediation);
  assert.equal(readinessClaim(afterValidUntil.reportResult.record.trust.bundle).status, 'rejected');
  assert.equal(afterValidUntil.reportResult.record.governance_state.expired, true);
});
