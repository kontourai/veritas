import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedbackStatusForPolicyResult, runMergeReadiness, writeBootstrapStarterKit } from '../src/index.mjs';
import { commitAll, initCommittedRepo } from './helpers.mjs';

function fixture(enforcementLevel = 'Require') {
  const rootDir = initCommittedRepo('veritas-rule-evidence-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }));
  writeBootstrapStarterKit({ rootDir, projectName: 'rule-evidence', evidenceCheck: 'npm test', force: true });
  mkdirSync(join(rootDir, 'src'), { recursive: true });
  writeFileSync(join(rootDir, 'src/target.mjs'), 'export const target = true;\n');
  writeFileSync(join(rootDir, 'src/other.mjs'), 'export const other = true;\n');
  const mapPath = join(rootDir, '.veritas/repo-map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  map.evidence.evidenceChecks.push({
    id: 'behavior', command: 'node -e "process.exit(0)"', method: 'validation',
  });
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  const standardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const standards = JSON.parse(readFileSync(standardsPath, 'utf8'));
  standards.rules.push({
    id: 'target-behavior',
    kind: 'required-artifacts',
    classification: 'promotable-policy',
    enforcementLevel,
    message: 'Target behavior needs its check.',
    match: { artifacts: ['src/target.mjs'] },
    evidenceCheckIds: ['behavior'],
  });
  writeFileSync(standardsPath, `${JSON.stringify(standards, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap rule evidence fixture');
  return { rootDir, mapPath, standardsPath };
}

async function run(rootDir, file, runId, options = {}) {
  return runMergeReadiness(
    { rootDir, runId, force: true, ...options },
    { rootDir },
    [file],
    { appendHistory: false, includeAttestationGate: false },
  );
}

test('changed-path rule evidence passes, catches a broken command, and restores; unrelated paths do not select it', async () => {
  const { rootDir, mapPath } = fixture();
  const baseline = await run(rootDir, 'src/target.mjs', 'rule-baseline');
  assert.equal(baseline.currentStatus, 'pass');
  assert.ok(baseline.evidenceCheckPlan.evidenceChecks.some((check) => check.id === 'behavior'));
  assert.equal(baseline.reportResult.record.policy_results.find((result) => result.rule_id === 'target-behavior').passed, true);

  const originalMap = readFileSync(mapPath, 'utf8');
  const changedMap = JSON.parse(originalMap);
  changedMap.evidence.evidenceChecks.find((check) => check.id === 'behavior').command = 'node -e "process.exit(9)"';
  writeFileSync(mapPath, `${JSON.stringify(changedMap, null, 2)}\n`);
  const injected = await run(rootDir, 'src/target.mjs', 'rule-injected');
  assert.equal(injected.currentStatus, 'fail');
  const failedRule = injected.reportResult.record.policy_results.find((result) => result.rule_id === 'target-behavior');
  assert.equal(failedRule.passed, false);
  assert.equal(failedRule.findings.at(-1).diagnostic, 'failed');
  assert.equal(injected.reportResult.record.repo_map.required_evidence_check_ids.includes('behavior'), true);

  writeFileSync(mapPath, originalMap);
  const restored = await run(rootDir, 'src/target.mjs', 'rule-restored');
  assert.equal(restored.currentStatus, 'pass');
  assert.equal(readFileSync(mapPath, 'utf8'), originalMap);

  const unrelated = await run(rootDir, 'src/other.mjs', 'rule-unrelated');
  assert.equal(unrelated.evidenceCheckPlan.evidenceChecks.some((check) => check.id === 'behavior'), false);
  assert.equal(unrelated.reportResult.record.policy_results.find((result) => result.rule_id === 'target-behavior').passed, true);
});

test('Guide rule reports missing execution without claiming behavioral success', async () => {
  const { rootDir } = fixture('Guide');
  const result = await run(rootDir, 'src/target.mjs', 'rule-skipped', { skipEvidenceCheck: true });
  const rule = result.reportResult.record.policy_results.find((item) => item.rule_id === 'target-behavior');
  assert.equal(rule.passed, false);
  assert.equal(rule.findings.at(-1).diagnostic, 'missing');
  assert.equal(rule.enforcementLevel, 'Guide');
});

test('Guide rule reports a failed linked check without blocking otherwise passing readiness', async () => {
  const { rootDir, mapPath } = fixture('Guide');
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  map.evidence.evidenceChecks.find((check) => check.id === 'behavior').command = 'node -e "process.exit(9)"';
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  const result = await run(rootDir, 'src/target.mjs', 'guide-rule-failed');
  assert.equal(result.currentStatus, 'pass');
  const rule = result.reportResult.record.policy_results.find((item) => item.rule_id === 'target-behavior');
  assert.equal(rule.passed, false);
  assert.equal(feedbackStatusForPolicyResult(rule), 'WARN');
  assert.equal(result.evidenceCheckFailure, null);
});

test('Require rule rejects a skipped linked check', async () => {
  const { rootDir } = fixture();
  const result = await run(rootDir, 'src/target.mjs', 'required-rule-skipped', { skipEvidenceCheck: true });
  assert.equal(result.currentStatus, 'fail');
  assert.equal(result.reportResult.record.policy_results.find((item) => item.rule_id === 'target-behavior').passed, false);
  assert.equal(result.reportResult.record.repo_map.required_evidence_check_ids.includes('behavior'), true);
});

test('unknown rule evidence check id fails configuration before a command runs', async () => {
  const { rootDir, standardsPath } = fixture();
  const standards = JSON.parse(readFileSync(standardsPath, 'utf8'));
  standards.rules.find((rule) => rule.id === 'target-behavior').evidenceCheckIds = ['missing-check'];
  writeFileSync(standardsPath, `${JSON.stringify(standards, null, 2)}\n`);
  await assert.rejects(run(rootDir, 'src/target.mjs', 'rule-unknown'), /unknown evidenceCheckId missing-check/);
});

test('a caller cannot omit a bound policy result to erase the rule verdict', async () => {
  const { rootDir } = fixture();
  await assert.rejects(
    run(rootDir, 'src/target.mjs', 'rule-omitted', { policyResults: [] }),
    /Rule evidence binding has no policy result: target-behavior/,
  );
});
