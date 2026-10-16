// An expired attestation fails readiness closed, the same way drift does, while
// a pending or missing attestation stays advisory (#202). A validity window
// that cannot be evaluated fails closed too, and attest refuses to write one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAttestation } from '../../src/attestations.mjs';
import { bindAttestationRecordIntegrity } from '../../src/attestations/record-integrity.mjs';
import { inspectAttestationStatus, runMergeReadiness } from '../../src/engine.mjs';
import { commitAll, initCommittedRepo, parseCliJson, repoRootDir } from '../helpers.mjs';

const veritasBin = join(repoRootDir, 'bin/veritas.mjs');
const RULE_ID = 'policy-changes-require-attestation';
const APPROVAL_REF = 'test://human-approved-attestation';
// Re-attesting is the remedy the FAIL line names; pinned as literals here.
const EXPIRED_REMEDY = 'A human authority must review the protected standards and run `npx --no @kontourai/veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference> --valid-until-days 1`. An agent must not run it: stop and ask a human authority. `--valid-until-days 1` keeps this attestation\'s 1-day validity window.';
const INVALID_WINDOW_REMEDY = 'A human authority must review the protected standards and run `npx --no @kontourai/veritas attest policy-change --message <text> --actor <authority-id> --approval-ref <human-approval-reference> --valid-until-days <days>`. An agent must not run it: stop and ask a human authority. Give <days> as a whole number of days, 1 or more; 90 is the default.';
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
  assert.ok(feedback.stdout.includes(`         ${EXPIRED_REMEDY}\n`), feedback.stdout);
  assert.match(feedback.stdout, /^1 failure /m);
  assertJsonVerdict(rootDir, 'expiry-expired', { exit: 1, status: 'fail', verdict: 'not-ready', claimStatus: 'rejected' });

  // The named remedy clears it: a fresh policy-change attestation over the
  // same, unchanged standards.
  const reattest = veritas(rootDir, [
    'attest', 'policy-change', '--message', 'Renew the lapsed attestation after review.',
    '--actor', 'owner', '--approval-ref', APPROVAL_REF, '--valid-until-days', '1',
  ]);
  assert.equal(reattest.status, 0, reattest.stdout + reattest.stderr);
  assert.equal(parseCliJson(reattest.stdout).attestation.validUntilDays, 1);
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
  assert.equal(failed.findings[0].remediation, EXPIRED_REMEDY);
  assert.equal(readinessClaim(afterValidUntil.reportResult.record.trust.bundle).status, 'rejected');
  assert.equal(afterValidUntil.reportResult.record.governance_state.expired, true);
});

// ─── Validity window values ───────────────────────────────────────────────

function attestationFiles(rootDir) {
  const dir = join(rootDir, '.veritas/attestations');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

// --root first, so a flag given without a value is the last argument.
function attestRaw(rootDir, args) {
  return spawnSync(process.execPath, [veritasBin, 'attest', ...args.slice(0, 1), '--root', rootDir, ...args.slice(1)], {
    cwd: rootDir,
    encoding: 'utf8',
  });
}

const REFUSED_WINDOWS = [
  ['0', /refuses --valid-until-days 0: validUntilDays is 0; it must be a whole number of days, 1 or more\./],
  ['-1', /refuses --valid-until-days "-1": it must be a whole number of days, 1 or more\./],
  ['1.5', /refuses --valid-until-days "1\.5": it must be a whole number of days, 1 or more\./],
  ['abc', /refuses --valid-until-days "abc": it must be a whole number of days, 1 or more\./],
  ['1e12', /refuses --valid-until-days "1e12": it must be a whole number of days, 1 or more\./],
  // Number() reads these as whole numbers; only the digits-only check refuses them.
  ['1e3', /refuses --valid-until-days "1e3": it must be a whole number of days, 1 or more\./],
  ['0x10', /refuses --valid-until-days "0x10": it must be a whole number of days, 1 or more\./],
  ['1000000000000', /refuses --valid-until-days 1000000000000: validUntilDays 1000000000000 ends the validity window past the latest date Veritas can represent\./],
  ['', /--valid-until-days requires a non-empty value/],
  [null, /--valid-until-days requires a value/],
];

for (const [kind, extra] of [
  ['bootstrap', ['--non-interactive']],
  ['policy-change', ['--message', 'Renew after review.']],
]) {
  test(`CLI: attest ${kind} refuses a --valid-until-days that is not a whole number of days, 1 or more`, (t) => {
    const rootDir = initFixture(t, `veritas-expiry-days-${kind}-`);
    if (kind === 'policy-change') attestBootstrapCli(rootDir);
    const before = attestationFiles(rootDir);
    const head = existsSync(join(rootDir, '.veritas/attestations/HEAD'))
      ? readFileSync(join(rootDir, '.veritas/attestations/HEAD'), 'utf8')
      : null;
    for (const [value, message] of REFUSED_WINDOWS) {
      const args = [kind, '--actor', 'owner', '--approval-ref', APPROVAL_REF, ...extra, '--valid-until-days', ...(value === null ? [] : [value])];
      const result = attestRaw(rootDir, args);
      assert.equal(result.status, 2, `${JSON.stringify(value)}: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, message, JSON.stringify(value));
      assert.equal(result.stdout, '', JSON.stringify(value));
      assert.deepEqual(attestationFiles(rootDir), before, `${JSON.stringify(value)} wrote an attestation file`);
    }
    if (head !== null) assert.equal(readFileSync(join(rootDir, '.veritas/attestations/HEAD'), 'utf8'), head);

    // The smallest accepted window is one day.
    const accepted = attestRaw(rootDir, [kind, '--actor', 'owner', '--approval-ref', APPROVAL_REF, ...extra, '--valid-until-days', '1']);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.equal(parseCliJson(accepted.stdout).attestation.validUntilDays, 1);
  });
}

function currentRecordPath(rootDir) {
  const head = JSON.parse(readFileSync(join(rootDir, '.veritas/attestations/HEAD'), 'utf8'));
  return join(rootDir, '.veritas/attestations', `${head.currentAttestationId}.attestation.json`);
}

// Rewrite the active record's validUntilDays the way a buggy writer or a hand
// edit would leave it. `bind` re-seals record integrity, `unbound` drops it as
// a pre-integrity record would, and `tampered` leaves the old digest.
function rewriteValidity(rootDir, { value, seal }) {
  const path = currentRecordPath(rootDir);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (value === undefined) delete record.validUntilDays;
  else record.validUntilDays = value;
  let written = record;
  if (seal === 'bind') {
    delete record.recordIntegrity;
    written = bindAttestationRecordIntegrity(record);
  } else if (seal === 'unbound') {
    delete record.recordIntegrity;
  }
  writeFileSync(path, `${JSON.stringify(written, null, 2)}\n`);
}

for (const [label, value, seal, reason] of [
  ['missing', undefined, 'bind', 'validUntilDays is missing; it must be a whole number of days, 1 or more'],
  ['null', null, 'bind', 'validUntilDays is null; it must be a whole number of days, 1 or more'],
  ['zero', 0, 'bind', 'validUntilDays is 0; it must be a whole number of days, 1 or more'],
  ['a string', '90', 'bind', 'validUntilDays is "90"; it must be a whole number of days, 1 or more'],
  ['missing on an unbound record', undefined, 'unbound', 'validUntilDays is missing; it must be a whole number of days, 1 or more'],
]) {
  test(`CLI: a record whose validUntilDays is ${label} fails readiness instead of crashing`, (t) => {
    const rootDir = initFixture(t, 'veritas-expiry-window-');
    attestBootstrapCli(rootDir);
    rewriteValidity(rootDir, { value, seal });
    editTrackedFile(rootDir);

    const status = veritas(rootDir, ['attest', 'status']);
    assert.equal(status.status, 0, status.stdout + status.stderr);
    const attestStatus = parseCliJson(status.stdout);
    assert.equal(attestStatus.state, 'current');
    assert.equal(attestStatus.expired, true, 'a window that cannot be evaluated is never open-ended');
    assert.equal(attestStatus.validUntil, null);
    assert.equal(attestStatus.validityWindowError, reason);

    const feedback = readiness(rootDir);
    assert.equal(feedback.status, 1, feedback.stdout + feedback.stderr);
    assert.equal(
      ruleLine(feedback.stdout).replace(/Active attestation \S+ /, 'Active attestation <id> '),
      `FAIL  ${RULE_ID}: Active attestation <id> has no valid validity window (${reason}); readiness fails until an authority records a fresh attestation.`,
    );
    assert.ok(feedback.stdout.includes(`         ${INVALID_WINDOW_REMEDY}\n`), feedback.stdout);
    assertJsonVerdict(rootDir, `expiry-window-${label.replaceAll(' ', '-')}`, { exit: 1, status: 'fail', verdict: 'not-ready', claimStatus: 'rejected' });
  });
}

test('CLI: an edited record with no validUntilDays reads as tampered, not a crash', (t) => {
  const rootDir = initFixture(t, 'veritas-expiry-window-tampered-');
  attestBootstrapCli(rootDir);
  rewriteValidity(rootDir, { value: undefined, seal: 'tampered' });
  editTrackedFile(rootDir);

  const status = veritas(rootDir, ['attest', 'status']);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  const attestStatus = parseCliJson(status.stdout);
  assert.equal(attestStatus.state, 'tampered');
  assert.equal(attestStatus.validityWindowError, 'validUntilDays is missing; it must be a whole number of days, 1 or more');

  const feedback = readiness(rootDir);
  assert.equal(feedback.status, 1, feedback.stdout + feedback.stderr);
  assert.match(ruleLine(feedback.stdout), /^FAIL\s+policy-changes-require-attestation: Active attestation \S+: The attestation record does not match its recordIntegrity digest/);
});
