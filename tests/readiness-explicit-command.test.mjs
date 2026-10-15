// An operator-supplied --evidence-check-command is additive to the Repo Map's
// required checks and is itself required for the run that supplied it (#225).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMergeReadiness } from '../src/readiness/run.mjs';
import { readinessVerdict, requiredEvidenceChecksFor } from '../src/surface/readiness.mjs';
import { commitAll, initCommittedRepo, parseCliJson, repoRootDir } from './helpers.mjs';

const veritasBin = join(repoRootDir, 'bin/veritas.mjs');
const FAILING_EXPLICIT = 'node -e "process.exit(2)"';
const PASSING_EXPLICIT = 'node -e "process.exit(0)"';
// Literal ids, derived independently of the id synthesizer under test.
const FAILING_EXPLICIT_ID = 'explicit-command-node-e-process-exit-2';
const PASSING_EXPLICIT_ID = 'explicit-command-node-e-process-exit-0';
const CONFIGURED_ID = 'required-evidence-check';

function initFixture(t, prefix, configuredCommand, editRepoMap = null) {
  const rootDir = initCommittedRepo(t, prefix);
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  execFileSync(
    process.execPath,
    [veritasBin, 'init', '--root', rootDir, '--project-name', 'Explicit Command Fixture', '--evidence-check', configuredCommand],
    { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' },
  );
  const repoMap = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-map.json'), 'utf8'));
  assert.deepEqual(repoMap.evidence.requiredEvidenceCheckIds, [CONFIGURED_ID], 'fixture must declare one configured required check');
  if (editRepoMap) {
    editRepoMap(repoMap);
    writeFileSync(join(rootDir, '.veritas/repo-map.json'), `${JSON.stringify(repoMap, null, 2)}\n`);
  }
  commitAll(rootDir, 'Bootstrap Veritas');
  writeFileSync(join(rootDir, 'change.txt'), 'changed\n');
  return rootDir;
}

function runReadinessCli(rootDir, extraArgs) {
  return spawnSync(
    process.execPath,
    [veritasBin, 'readiness', '--check', 'evidence', '--root', rootDir, '--working-tree', ...extraArgs],
    { cwd: rootDir, encoding: 'utf8' },
  );
}

function persistedRecord(rootDir, output) {
  // Read from disk: no process-local runtime state, so this is what a later reader sees.
  return JSON.parse(readFileSync(join(rootDir, output.reportArtifactPath), 'utf8'));
}

test('CLI: a failing explicit --evidence-check-command fails readiness alongside a passing configured check', (t) => {
  const rootDir = initFixture(t, 'veritas-explicit-fail-', PASSING_EXPLICIT);

  const feedback = runReadinessCli(rootDir, ['--evidence-check-command', FAILING_EXPLICIT, '--run-id', 'explicit-fail-feedback']);
  assert.equal(feedback.status, 1, feedback.stdout + feedback.stderr);
  assert.match(feedback.stdout, new RegExp(`FAIL  required-evidence-check:${FAILING_EXPLICIT_ID}: failed`));
  assert.doesNotMatch(feedback.stdout, /WARN  evidence-check:/);
  assert.doesNotMatch(feedback.stdout, /Optional diagnostic failed/);
  assert.match(feedback.stdout, /^1 failure/m);

  const json = runReadinessCli(rootDir, ['--evidence-check-command', FAILING_EXPLICIT, '--run-id', 'explicit-fail-json', '--format', 'json']);
  assert.equal(json.status, 1, json.stdout + json.stderr);
  const output = parseCliJson(json.stdout);
  assert.equal(output.evidenceCheckFailure?.id, FAILING_EXPLICIT_ID);
  assert.equal(output.evidenceCheckFailure.exitCode, 2);
  assert.equal(output.readiness.status, 'fail');
  assert.equal(output.readiness.verdict, 'not-ready');
  assert.equal(output.readiness.baselineCiFastPassed, false);
  assert.deepEqual(
    output.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'passed'], [FAILING_EXPLICIT_ID, 'failed']],
  );

  const record = persistedRecord(rootDir, output);
  assert.deepEqual(record.repo_map.required_evidence_check_ids, [CONFIGURED_ID, FAILING_EXPLICIT_ID]);
  assert.equal(record.baseline_ci_fast_passed, false);
  assert.equal(readinessVerdict(record), 'not-ready');
  assert.deepEqual(
    requiredEvidenceChecksFor(record).map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'passed'], [FAILING_EXPLICIT_ID, 'failed']],
  );
  const readinessClaim = record.trust.bundle.claims.find((claim) => claim.claimType === 'software-readiness-verdict');
  assert.equal(readinessClaim.value.verdict, 'not-ready');
  assert.equal(readinessClaim.status, 'rejected');
});

test('CLI: a passing explicit --evidence-check-command passes readiness', (t) => {
  const rootDir = initFixture(t, 'veritas-explicit-pass-', PASSING_EXPLICIT);

  const json = runReadinessCli(rootDir, ['--evidence-check-command', PASSING_EXPLICIT, '--run-id', 'explicit-pass-json', '--format', 'json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const output = parseCliJson(json.stdout);
  assert.equal(output.evidenceCheckFailure, null);
  assert.equal(output.readiness.status, 'pass');
  assert.equal(output.readiness.verdict, 'ready');
  // The explicit command reuses the configured check's definition when the commands match.
  assert.deepEqual(
    output.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'passed']],
  );

  const rootDirDistinct = initFixture(t, 'veritas-explicit-pass-distinct-', 'node -e "process.exit(0)" distinct');
  const distinct = runReadinessCli(rootDirDistinct, ['--evidence-check-command', PASSING_EXPLICIT, '--run-id', 'explicit-pass-distinct', '--format', 'json']);
  assert.equal(distinct.status, 0, distinct.stdout + distinct.stderr);
  const distinctOutput = parseCliJson(distinct.stdout);
  assert.equal(distinctOutput.readiness.verdict, 'ready');
  assert.deepEqual(
    distinctOutput.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'passed'], [PASSING_EXPLICIT_ID, 'passed']],
  );
  assert.equal(persistedRecord(rootDirDistinct, distinctOutput).baseline_ci_fast_passed, true);
});

test('CLI: configured required checks still run and still fail independently of the explicit command', (t) => {
  const rootDir = initFixture(t, 'veritas-explicit-configured-fail-', 'node -e "process.exit(3)"');

  const passingExplicit = runReadinessCli(rootDir, ['--evidence-check-command', PASSING_EXPLICIT, '--run-id', 'configured-fail', '--format', 'json']);
  assert.equal(passingExplicit.status, 1, passingExplicit.stdout + passingExplicit.stderr);
  const output = parseCliJson(passingExplicit.stdout);
  assert.equal(output.evidenceCheckFailure?.id, CONFIGURED_ID);
  assert.equal(output.evidenceCheckFailure.exitCode, 3);
  assert.equal(output.readiness.verdict, 'not-ready');
  assert.deepEqual(
    output.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'failed'], [PASSING_EXPLICIT_ID, 'passed']],
  );

  const bothFailing = runReadinessCli(rootDir, ['--evidence-check-command', FAILING_EXPLICIT, '--run-id', 'both-fail', '--format', 'json']);
  assert.equal(bothFailing.status, 1, bothFailing.stdout + bothFailing.stderr);
  const bothOutput = parseCliJson(bothFailing.stdout);
  // Every required check runs; the first failure does not short-circuit the rest.
  assert.deepEqual(
    bothOutput.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'failed'], [FAILING_EXPLICIT_ID, 'failed']],
  );
  assert.equal(bothOutput.readiness.verdict, 'not-ready');
});

test('engine API: runMergeReadiness treats a failing explicit evidenceCheckCommand as a required failure', async (t) => {
  const rootDir = initFixture(t, 'veritas-explicit-engine-', PASSING_EXPLICIT);
  const run = (evidenceCheckCommand, runId) => runMergeReadiness(
    { rootDir, runId, workingTree: true, force: true, evidenceCheckCommand },
    { rootDir },
    [],
    { appendHistory: false },
  );

  const failing = await run(FAILING_EXPLICIT, 'engine-explicit-fail');
  assert.deepEqual(failing.evidenceCheckPlan.requiredEvidenceCheckIds, [CONFIGURED_ID, FAILING_EXPLICIT_ID]);
  assert.deepEqual(
    failing.evidenceCheckResults.map((result) => [result.id, result.passed]),
    [[FAILING_EXPLICIT_ID, false], [CONFIGURED_ID, true]],
  );
  assert.equal(failing.evidenceCheckFailure?.id, FAILING_EXPLICIT_ID);
  assert.equal(failing.evidenceCheckFailure.exitCode, 2);
  assert.equal(failing.currentStatus, 'fail');
  const record = failing.reportResult.record;
  assert.equal(record.baseline_ci_fast_passed, false);
  assert.equal(readinessVerdict(record), 'not-ready');
  assert.deepEqual(
    requiredEvidenceChecksFor(record).map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'passed'], [FAILING_EXPLICIT_ID, 'failed']],
  );

  const passing = await run('node -e "process.exit(0)" distinct', 'engine-explicit-pass');
  assert.equal(passing.evidenceCheckFailure, null);
  assert.equal(passing.currentStatus, 'pass');
  assert.equal(readinessVerdict(passing.reportResult.record), 'ready');
  assert.equal(passing.evidenceCheckPlan.requiredEvidenceCheckIds.length, 2);
});

// Each command writes a marker file, so "nothing ran" is observable.
const markerCommand = (name, exitCode) => `node -e "require('node:fs').writeFileSync('${name}', 'ran'); process.exit(${exitCode})"`;

// `veritas init` creates the evidence directory empty; a run writes a report into it.
const evidenceReports = (rootDir) => {
  const dir = join(rootDir, '.kontourai/veritas/evidence');
  return existsSync(dir) ? readdirSync(dir) : [];
};

function assertRefusedBeforeRunning(rootDir, result, messagePattern, markers) {
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, messagePattern);
  assert.doesNotMatch(result.stderr, /RUN   /);
  for (const marker of markers) {
    assert.equal(existsSync(join(rootDir, marker)), false, `${marker} must not run`);
  }
  assert.deepEqual(evidenceReports(rootDir), [], 'no evidence report may be written');
}

test('CLI: a repeated --evidence-check-command is a usage error and runs nothing', (t) => {
  const rootDir = initFixture(t, 'veritas-explicit-repeated-', markerCommand('configured-ran', 0));

  const result = runReadinessCli(rootDir, [
    '--evidence-check-command', markerCommand('first-ran', 2),
    '--evidence-check-command', markerCommand('second-ran', 0),
    '--format', 'json',
  ]);
  assertRefusedBeforeRunning(
    rootDir,
    result,
    /--evidence-check-command may be given only once; it takes exactly one command/,
    ['configured-ran', 'first-ran', 'second-ran'],
  );

  // Control: the same fixture with one flag does run the checks, so the markers are reachable.
  const single = runReadinessCli(rootDir, ['--evidence-check-command', markerCommand('first-ran', 2), '--format', 'json']);
  assert.equal(single.status, 1, single.stdout + single.stderr);
  assert.equal(existsSync(join(rootDir, 'first-ran')), true);
  assert.equal(existsSync(join(rootDir, 'configured-ran')), true);
  assert.equal(evidenceReports(rootDir).length, 1);
});

test('CLI and engine: --skip-evidence-check with --evidence-check-command is refused before anything runs', async (t) => {
  const rootDir = initFixture(t, 'veritas-explicit-skip-', markerCommand('configured-ran', 0));
  const message = /--evidence-check-command cannot be combined with --skip-evidence-check/;

  const result = runReadinessCli(rootDir, [
    '--skip-evidence-check',
    '--evidence-check-command', markerCommand('explicit-ran', 0),
    '--format', 'json',
  ]);
  assertRefusedBeforeRunning(rootDir, result, message, ['configured-ran', 'explicit-ran']);

  await assert.rejects(
    runMergeReadiness(
      { rootDir, workingTree: true, force: true, skipEvidenceCheck: true, evidenceCheckCommand: markerCommand('explicit-ran', 0) },
      { rootDir },
      [],
      { appendHistory: false },
    ),
    message,
  );
  assert.equal(existsSync(join(rootDir, 'explicit-ran')), false);
  assert.deepEqual(evidenceReports(rootDir), []);

  // --skip-evidence-check alone keeps its diagnostic-only behaviour.
  const skipOnly = runReadinessCli(rootDir, ['--skip-evidence-check', '--format', 'json']);
  assert.equal(skipOnly.status, 1, skipOnly.stdout + skipOnly.stderr);
  assert.equal(parseCliJson(skipOnly.stdout).readiness.verdict, 'not-ready');
});

test('CLI: an explicit command equal to an optional configured check makes that check required for the run', (t) => {
  const OPTIONAL_ID = 'optional-diagnostic';
  const OPTIONAL_COMMAND = 'node -e "process.exit(4)"';
  const rootDir = initFixture(t, 'veritas-explicit-optional-', PASSING_EXPLICIT, (repoMap) => {
    repoMap.evidence.evidenceChecks.push({
      id: OPTIONAL_ID,
      command: OPTIONAL_COMMAND,
      method: 'validation',
      externalTool: {
        tool: 'probe',
        format: 'fallow-audit-json',
        blocking: true,
        artifactPath: '.kontourai/veritas/external/probe-missing.json',
      },
    });
    repoMap.evidence.defaultEvidenceCheckIds = [OPTIONAL_ID];
  });

  // Control: selected as a default, the optional check fails without blocking,
  // and its blocking external tool is not blocking because the check is not required.
  const optional = runReadinessCli(rootDir, ['--run-id', 'optional-default', '--format', 'json']);
  assert.equal(optional.status, 0, optional.stdout + optional.stderr);
  const optionalOutput = parseCliJson(optional.stdout);
  assert.equal(optionalOutput.evidenceCheckFailure, null);
  assert.deepEqual(optionalOutput.readiness.requiredEvidenceChecks.map((check) => check.id), [CONFIGURED_ID]);
  const optionalRecord = persistedRecord(rootDir, optionalOutput);
  assert.deepEqual(
    optionalRecord.external_tool_results.map((item) => [item.evidence_check_id, item.verdict, item.blocking]),
    [[OPTIONAL_ID, 'missing', false]],
  );

  const explicit = runReadinessCli(rootDir, ['--evidence-check-command', OPTIONAL_COMMAND, '--run-id', 'optional-explicit', '--format', 'json']);
  assert.equal(explicit.status, 1, explicit.stdout + explicit.stderr);
  const output = parseCliJson(explicit.stdout);
  assert.equal(output.evidenceCheckFailure?.id, OPTIONAL_ID);
  assert.equal(output.evidenceCheckFailure.exitCode, 4);
  assert.equal(output.readiness.verdict, 'not-ready');
  assert.deepEqual(
    output.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]),
    [[CONFIGURED_ID, 'passed'], [OPTIONAL_ID, 'failed']],
  );
  const record = persistedRecord(rootDir, output);
  assert.deepEqual(record.repo_map.required_evidence_check_ids, [CONFIGURED_ID, OPTIONAL_ID]);
  assert.deepEqual(
    record.external_tool_results.map((item) => [item.evidence_check_id, item.verdict, item.blocking]),
    [[OPTIONAL_ID, 'missing', true]],
  );
  assert.equal(readinessVerdict(record), 'not-ready');
});
