import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compareMarkerBenchmarkRuns,
  generateMarkerBenchmarkSuiteReport,
} from '../src/index.mjs';
import { frameworkRootDir, readJson } from './helpers.mjs';

test('adapter example declares nodes and proof lanes', () => {
  const adapter = readJson('../adapters/work-agent.adapter.json');
  assert.equal(adapter.kind, 'repo-adapter');
  assert.ok(adapter.graph.nodes.length > 0);
  assert.deepEqual(adapter.evidence.requiredProofLanes, ['npm run ci:fast']);
});

test('policy pack includes multiple rule classes', () => {
  const policyPack = readJson('../policy-packs/work-agent-convergence.policy-pack.json');
  const classes = new Set(policyPack.rules.map((rule) => rule.classification));
  assert.ok(classes.has('hard-invariant'));
  assert.ok(classes.has('promotable-policy'));
  assert.ok(classes.has('brittle-implementation-check'));
});

test('classification artifact groups the current convergence rule surface', () => {
  const classification = readJson(
    '../examples/classification/work-agent-convergence-rule-families.json',
  );
  assert.equal(classification.source_repo, 'work-agent');
  assert.ok(classification.families.length >= 10);
  assert.ok(
    classification.families.some(
      (family) => family.id === 'runtime-and-orchestration-decomposition',
    ),
  );
});

test('evidence schema requires framework and adapter sections', () => {
  const evidenceSchema = readJson('../schemas/veritas-evidence.schema.json');
  assert.ok(evidenceSchema.required.includes('framework'));
  assert.ok(evidenceSchema.required.includes('adapter'));
  assert.ok(evidenceSchema.required.includes('selected_proof_commands'));
  assert.ok(evidenceSchema.required.includes('proof_resolution_source'));
  assert.ok(evidenceSchema.required.includes('policy_results'));
});

test('fixture adapters and evidence examples stay readable', () => {
  const docsAdapter = readJson('../adapters/demo-docs-site.adapter.json');
  assert.equal(docsAdapter.name, 'demo-docs-site');
  assert.deepEqual(docsAdapter.evidence.requiredProofLanes, [
    'npm run docs:build',
    'npm test',
  ]);

  const passExample = readJson('../examples/evidence/work-agent-pass.json');
  const failExample = readJson('../examples/evidence/work-agent-fail.json');
  const policyGapExample = readJson('../examples/evidence/work-agent-policy-gap.json');

  assert.equal(passExample.baseline_ci_fast_passed, true);
  assert.equal(failExample.baseline_ci_fast_passed, false);
  assert.equal(policyGapExample.recommendations[0].kind, 'policy-gap');
  assert.ok(Array.isArray(passExample.policy_results));
  assert.equal(passExample.policy_results[0].rule_id, 'required-repo-artifacts');
  assert.equal(failExample.policy_results[0].passed, false);
});

test('live-eval fixtures explain outcome measurement and team tuning', () => {
  const evalRecord = readJson('../examples/evals/work-agent-shadow-eval.json');
  const evalDraft = readJson('../examples/evals/work-agent-shadow-eval-draft.json');
  const teamProfile = readJson('../examples/evals/work-agent-team-profile.json');
  const evalSchema = readJson('../schemas/veritas-eval-record.schema.json');
  const evalDraftSchema = readJson('../schemas/veritas-eval-draft.schema.json');
  const teamProfileSchema = readJson('../schemas/veritas-team-profile.schema.json');

  assert.ok(evalSchema.required.includes('measurements'));
  assert.ok(evalDraftSchema.required.includes('prefilled_measurements'));
  assert.ok(evalSchema.required.includes('evidence'));
  assert.ok(teamProfileSchema.required.includes('promotion_preferences'));

  assert.equal(evalRecord.mode, 'shadow');
  assert.equal(evalRecord.evidence.source_kind, 'branch-diff');
  assert.equal(evalDraft.prefilled_outcome.reviewer_confidence, 'unknown');
  assert.equal(evalRecord.outcome.accepted_without_major_rewrite, true);
  assert.equal(teamProfile.defaults.new_rule_stage, 'recommend');
  assert.equal(teamProfile.promotion_preferences.warnings_block_in_ci, false);
  assert.equal(
    teamProfile.promotion_preferences.require_consistent_eval_before_promotion,
    true,
  );

  const checkinReport = readJson('../examples/checkins/veritas-repo-report.json');
  assert.equal(checkinReport.adapter.name, 'veritas');
  assert.ok(Array.isArray(checkinReport.policy_results));
  assert.ok(checkinReport.policy_results.some((result) => result.passed === true));
  assert.equal(
    checkinReport.policy_results.filter((result) => result.passed === null).length,
    0,
  );
  assert.ok(
    checkinReport.policy_results.some(
      (result) => result.rule_id === 'prefer-veritas-routed-delivery' && result.passed === true,
    ),
  );

  const redCheckin = readJson('../examples/checkins/veritas-repo-checkin-red.json');
  assert.equal(redCheckin.health_status, 'red');
  assert.ok(Array.isArray(redCheckin.alerts));
  assert.ok(redCheckin.alerts.some((alert) => alert.severity === 'error'));
  assert.equal(redCheckin.policy_results_summary.metadata_only, 0);
});

test('marker benchmark fixtures explain timely surfacing scoring', () => {
  const scenario = readJson('../examples/benchmarks/migration-marker-scenario.json');
  const withoutVeritas = readJson('../examples/benchmarks/migration-marker-without-veritas.json');
  const withVeritas = readJson('../examples/benchmarks/migration-marker-with-veritas.json');
  const comparison = readJson('../examples/benchmarks/migration-marker-comparison.json');
  const suite = readJson('../examples/benchmarks/marker-suite.json');
  const suiteReport = readJson('../examples/benchmarks/marker-suite-report.json');
  const scenarioSchema = readJson('../schemas/veritas-marker-benchmark.schema.json');
  const transcriptSchema = readJson('../schemas/veritas-marker-transcript.schema.json');
  const comparisonSchema = readJson('../schemas/veritas-marker-score.schema.json');
  const suiteSchema = readJson('../schemas/veritas-marker-suite.schema.json');
  const suiteReportSchema = readJson('../schemas/veritas-marker-suite-report.schema.json');

  assert.ok(scenarioSchema.required.includes('marker'));
  assert.ok(transcriptSchema.required.includes('turns'));
  assert.ok(transcriptSchema.required.includes('benchmark_id'));
  assert.ok(comparisonSchema.required.includes('conditions'));
  assert.ok(suiteSchema.required.includes('benchmarks'));
  assert.ok(suiteReportSchema.required.includes('metrics'));
  assert.equal(withoutVeritas.benchmark_id, scenario.id);
  assert.equal(withVeritas.benchmark_id, scenario.id);
  assert.equal(scenario.scoring.allow_early, false);
  assert.equal(comparison.conditions.without_veritas.pass, false);
  assert.equal(comparison.conditions.with_veritas.pass, true);
  assert.equal(comparison.comparison.treatment_beats_baseline, true);
  assert.equal(suite.benchmarks.length, 4);
  assert.equal(suiteReport.metrics.pass_pow_k, 0.75);
  assert.equal(suiteReport.metrics.treatment_pass_rate, 5 / 6);
  assert.deepEqual(
    compareMarkerBenchmarkRuns({
      scenario,
      withoutVeritas,
      withVeritas,
    }),
    comparison,
  );
  assert.deepEqual(
    generateMarkerBenchmarkSuiteReport({
      suitePath: 'examples/benchmarks/marker-suite.json',
      rootDir: frameworkRootDir,
    }),
    suiteReport,
  );
});

test('repo-local operational config covers the framework repo surface', () => {
  const adapter = readJson('../.veritas/repo.adapter.json');
  const nodeIds = new Set(adapter.graph.nodes.map((node) => node.id));
  assert.ok(nodeIds.has('tooling.bin'));
  assert.ok(nodeIds.has('governance.schemas'));
  assert.ok(nodeIds.has('governance.policy-packs'));
  assert.ok(nodeIds.has('examples.fixtures'));

  const policyPack = readJson('../.veritas/policy-packs/default.policy-pack.json');
  assert.ok(policyPack.rules.length >= 3);
  assert.ok(
    policyPack.rules.some(
      (rule) =>
        Array.isArray(rule.match?.artifacts) && rule.match.artifacts.includes('bin/veritas.mjs'),
    ),
  );
});

test('repo includes an automated check-in workflow', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/veritas-checkins.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /npm run veritas:proof/);
  assert.match(workflow, /node scripts\/checkin-status\.mjs/);
  assert.match(workflow, /Update PR Comment/);
  assert.match(workflow, /Update Health Issue/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /actions\/github-script@v9/);
});
