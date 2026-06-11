import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compareMarkerBenchmarkRuns,
  generateMarkerBenchmarkSuiteReport,
} from '../src/index.mjs';
import { repoRootDir, readJson } from './helpers.mjs';

test('Repo Map example declares nodes and evidenceChecks', () => {
  const repoMap = readJson('../repo-maps/work-agent.repo-map.json');
  assert.equal(repoMap.kind, 'repo-map');
  assert.ok(repoMap.graph.nodes.length > 0);
  assert.deepEqual(repoMap.evidence.evidenceChecks.map((lane) => lane.command), ['npm run ci:fast']);
  assert.deepEqual(repoMap.evidence.requiredEvidenceCheckIds, ['required-evidence-check']);
});

test('Repo Standards example includes multiple requirement classes', () => {
  const repoStandards = readJson('../repo-standards/work-agent-convergence.repo-standards.json');
  const classes = new Set(repoStandards.rules.map((rule) => rule.classification));
  assert.ok(classes.has('hard-invariant'));
  assert.ok(classes.has('promotable-policy'));
  assert.ok(classes.has('brittle-implementation-check'));
});

test('classification artifact groups the current convergence rule surface', () => {
  const classification = readJson(
    '../examples/classification/work-agent-convergence-rule-groups.json',
  );
  assert.equal(classification.source_repo, 'work-agent');
  assert.ok(classification.groups.length >= 10);
  assert.ok(
    classification.groups.some(
      (group) => group.id === 'runtime-and-orchestration-decomposition',
    ),
  );
});

test('evidence schema requires current producer metadata sections', () => {
  const evidenceSchema = readJson('../schemas/veritas-evidence.schema.json');
  const evidenceInventorySchema = readJson('../schemas/veritas-evidence-inventory-manifest.schema.json');
  assert.ok(evidenceSchema.required.includes('producer'));
  assert.ok(evidenceSchema.required.includes('repo_map'));
  assert.ok(evidenceSchema.required.includes('selected_evidence_check_ids'));
  assert.ok(evidenceSchema.required.includes('selected_evidence_check_labels'));
  assert.ok(evidenceSchema.required.includes('selected_evidence_checks'));
  assert.ok(evidenceSchema.required.includes('evidence_check_resolution_source'));
  assert.ok(evidenceSchema.required.includes('policy_results'));
  assert.ok(evidenceSchema.required.includes('trust'));
  assert.ok(evidenceSchema.properties.trust);
  assert.ok(evidenceSchema.properties.evidence_inventory_results);
  assert.ok(evidenceSchema.properties.readiness_coverage);
  assert.ok(
    evidenceSchema.properties.readiness_coverage.$ref.endsWith('readinessCoverage'),
  );
  assert.ok(evidenceInventorySchema.properties.items);
  assert.ok(
    evidenceInventorySchema.$defs.evidenceInventory.properties.defaultDisposition.enum.includes('move-to-test'),
  );
});

test('evidence schema classifies top-level fields by Surface mapping', () => {
  const evidenceSchema = readJson('../schemas/veritas-evidence.schema.json');
  const docs = readFileSync(new URL('../docs/reference/artifacts-and-schemas.md', import.meta.url), 'utf8');
  const allowedMappings = new Set(['mapped', 'veritas-local', 'transitional', 'deprecated']);
  const allowedTargets = new Set(['claim', 'evidence', 'policy', 'event', 'metadata', 'report-input']);

  for (const [field, schema] of Object.entries(evidenceSchema.properties)) {
    assert.ok(
      allowedMappings.has(schema.x_surface_mapping),
      `${field} must declare x_surface_mapping`,
    );
    if (schema.x_surface_mapping === 'mapped') {
      assert.ok(Array.isArray(schema.x_surface_targets), `${field} must declare x_surface_targets`);
      for (const target of schema.x_surface_targets) {
        assert.ok(allowedTargets.has(target), `${field} has unsupported Surface target ${target}`);
      }
      assert.ok(
        docs.includes(`\`${field}\``),
        `${field} must have a docs mapping row when marked Surface-mapped`,
      );
    }
  }
});

test('first-contact docs preserve the Surface foundation boundary', () => {
  const readDoc = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const readme = readDoc('../README.md');
  const concepts = readDoc('../docs/concepts.md');
  const siteIndex = readDoc('../docs/site-index.md');
  const cliReference = readDoc('../docs/reference/cli.md');
  const boundary = readDoc('../docs/architecture/surface-veritas-boundary.md');

  assert.match(readme, /earn merge autonomy/);
  assert.match(readme, /built with \[Surface\]/);
  assert.match(concepts, /## Built With Surface/);
  assert.match(concepts, /The detailed mapping between Veritas concepts and Surface primitives is in \[Surface-Veritas Boundary\]/);
  assert.match(concepts, /The user-facing Veritas product should still use Veritas vocabulary/);
  assert.match(siteIndex, /Surface-Veritas Boundary/);
  assert.match(siteIndex, /Built With Surface/);
  assert.match(cliReference, /trust\.bundle/);
  assert.match(cliReference, /Repo Standards/);
  assert.match(boundary, /## Boundary Rule/);
  assert.match(boundary, /Surface does not depend on Veritas readiness runtime code/);
  assert.match(boundary, /Veritas owns repo-native governance/);
  assert.match(boundary, /Surface owns portable transparency/);
});

test('Repo Map and Repo Standards schemas declare activation and lint requirement contracts', () => {
  const repoMapSchema = readJson('../schemas/veritas-repo-map.schema.json');
  const policySchema = readJson('../schemas/veritas-repo-standards.schema.json');
  const activation = repoMapSchema.properties.activation.properties.aiInstructionFiles.items;
  const ruleProperties = policySchema.properties.rules.items.properties;
  const matchDefs = policySchema.$defs;

  assert.ok(activation.required.includes('path'));
  assert.equal(activation.properties.tool.type, 'string');
  assert.equal(activation.properties.required.type, 'boolean');
  assert.ok(repoMapSchema.properties.evidence.properties.evidenceInventoryManifests);
  assert.ok(
    repoMapSchema.properties.evidence.properties.evidenceChecks.items.properties.externalTool,
  );
  const externalTool =
    repoMapSchema.properties.evidence.properties.evidenceChecks.items.properties.externalTool;
  assert.equal(externalTool.properties.tool.minLength, 1);
  assert.equal(externalTool.properties.format.minLength, 1);
  assert.equal(externalTool.properties.artifactPath.minLength, 1);
  assert.equal(externalTool.properties.artifactPath.pattern, '^\\.veritas/');
  assert.deepEqual(ruleProperties.kind.enum, [
    'required-artifacts',
    'governance-block',
    'diff-required',
    'work-area-boundary',
    'forbidden-pattern',
    'required-pattern',
    'header-required',
    'vocabulary-consistency',
    'primitive-first-governance',
  ]);
  assert.ok(matchDefs.requiredArtifactsMatch.properties.artifacts);
  assert.ok(matchDefs.governanceBlockMatch.properties['governance-block']);
  assert.ok(matchDefs.diffRequiredMatch.properties['if-changed']);
  assert.ok(matchDefs.diffRequiredMatch.properties['then-require']);
  assert.ok(matchDefs.filesPatternMatch.properties.files);
  assert.ok(matchDefs.filesPatternMatch.properties.pattern);
  assert.ok(matchDefs.vocabularyConsistencyMatch.properties.files);
  assert.ok(matchDefs.vocabularyConsistencyMatch.properties.terms);
  assert.ok(matchDefs.primitiveFirstGovernanceMatch.properties.candidates);
  assert.ok(matchDefs.primitiveFirstGovernanceMatch.properties.packageScripts);
  assert.ok(matchDefs.primitiveFirstGovernanceMatch.properties.packageScripts.properties.namePatterns);
  assert.ok(matchDefs.primitiveFirstGovernanceMatch.properties.packageScripts.properties.commandPatterns);
  assert.ok(matchDefs.primitiveFirstGovernanceMatch.properties.packageScripts.properties.helperExemptions);
});

test('example Repo Maps and evidence examples stay readable', () => {
  const repoMap = readJson('../.veritas/repo-map.json');
  const docsRepoMap = readJson('../repo-maps/demo-docs-site.repo-map.json');
  const fallowLane = repoMap.evidence.evidenceChecks.find((lane) => lane.id === 'fallow-advisory');
  assert.ok(fallowLane);
  assert.equal(fallowLane.externalTool.blocking, false);
  assert.equal(fallowLane.externalTool.artifactPath, '.veritas/external/fallow-audit.json');
  assert.ok(repoMap.evidence.defaultEvidenceCheckIds.includes('fallow-advisory'));
  assert.equal(docsRepoMap.name, 'demo-docs-site');
  assert.deepEqual(docsRepoMap.evidence.evidenceChecks.map((lane) => lane.command), [
    'npm run docs:build',
    'npm test',
  ]);

  const passExample = readJson('../examples/evidence/work-agent-pass.json');
  const failExample = readJson('../examples/evidence/work-agent-fail.json');
  const policyGapExample = readJson('../examples/evidence/work-agent-policy-gap.json');
  const fallowAdvisoryExample = readJson('../examples/evidence/fallow-advisory.json');

  assert.equal(passExample.baseline_ci_fast_passed, true);
  assert.deepEqual(passExample.selected_evidence_checks.map((lane) => lane.command), ['npm run ci:fast']);
  assert.equal(failExample.baseline_ci_fast_passed, false);
  assert.equal(policyGapExample.recommendations[0].kind, 'policy-gap');
  assert.ok(Array.isArray(passExample.policy_results));
  assert.equal(passExample.policy_results[0].rule_id, 'required-repo-artifacts');
  assert.equal(failExample.policy_results[0].passed, false);
  assert.equal(fallowAdvisoryExample.external_tool_results[0].tool, 'fallow');
  assert.equal(fallowAdvisoryExample.external_tool_results[0].blocking, false);
  assert.ok(
    fallowAdvisoryExample.trust.bundle.claims.some(
      (claim) => claim.surface === 'veritas.external-tool-results',
    ),
  );
});

test('standards feedback examples explain outcome measurement and team tuning', () => {
  const feedbackRecord = readJson('../examples/standards-feedback/work-agent-observe-standards-feedback.json');
  const feedbackDraft = readJson('../examples/standards-feedback/work-agent-observe-standards-feedback-draft.json');
  const authoritySettings = readJson('../examples/standards-feedback/work-agent-authority-settings.json');
  const feedbackSchema = readJson('../schemas/veritas-standards-feedback.schema.json');
  const feedbackDraftSchema = readJson('../schemas/veritas-standards-feedback-draft.schema.json');
  const authoritySettingsSchema = readJson('../schemas/veritas-authority-settings.schema.json');

  assert.ok(feedbackSchema.required.includes('measurements'));
  assert.ok(feedbackDraftSchema.required.includes('prefilled_measurements'));
  assert.ok(feedbackSchema.required.includes('evidence'));
  assert.ok(feedbackSchema.required.includes('governance'));
  assert.ok(feedbackDraftSchema.required.includes('governance'));
  assert.ok(authoritySettingsSchema.required.includes('promotion_preferences'));

  assert.equal(feedbackRecord.mode, 'observe');
  assert.equal(feedbackRecord.evidence.source_kind, 'branch-diff');
  assert.equal(feedbackRecord.governance.protected_standards_touched, true);
  assert.equal(feedbackRecord.governance.classification, 'unknown');
  assert.equal(feedbackDraft.prefilled_outcome.reviewer_confidence, 'unknown');
  assert.equal(feedbackDraft.governance.protected_standards_touched, true);
  assert.equal(feedbackRecord.outcome.accepted_without_major_rewrite, true);
  assert.equal(authoritySettings.defaults.new_rule_stage, 'recommend');
  assert.equal(authoritySettings.promotion_preferences.warnings_block_in_ci, false);
  assert.equal(
    authoritySettings.promotion_preferences.require_consistent_feedback_before_promotion,
    true,
  );

  const conformanceReport = readJson('../examples/repo-conformance/veritas-repo-report.json');
  assert.equal(conformanceReport.repo_map.name, 'veritas');
  assert.ok(Array.isArray(conformanceReport.policy_results));
  assert.ok(conformanceReport.policy_results.some((result) => result.passed === true));
  assert.equal(
    conformanceReport.policy_results.filter((result) => result.passed === null).length,
    0,
  );
  assert.ok(
    conformanceReport.policy_results.some(
      (result) => result.rule_id === 'prefer-veritas-routed-delivery' && result.passed === true,
    ),
  );

  const redConformance = readJson('../examples/repo-conformance/veritas-repo-conformance-red.json');
  assert.equal(redConformance.health_status, 'red');
  assert.ok(Array.isArray(redConformance.alerts));
  assert.ok(redConformance.alerts.some((alert) => alert.severity === 'error'));
  assert.equal(redConformance.policy_results_summary.metadata_only, 0);
  assert.equal(redConformance.governance_surface.classification, 'clean');
  assert.equal(redConformance.governance_trend.summary, 'no prior governance history');
});

test('marker benchmark examples explain timely surfacing scoring', () => {
  const scenario = readJson('../examples/benchmarks/migration/scenario.json');
  const withoutVeritas = readJson('../examples/benchmarks/migration/without-veritas.json');
  const withVeritas = readJson('../examples/benchmarks/migration/with-veritas.json');
  const comparison = readJson('../examples/benchmarks/migration/comparison.json');
  const suite = readJson('../examples/benchmarks/suites/context-surfacing-suite.json');
  const suiteReport = readJson('../examples/benchmarks/suites/context-surfacing-suite-report.json');
  const scenarioSchema = readJson('../schemas/veritas-marker-benchmark.schema.json');
  const sessionLogSchema = readJson('../schemas/veritas-marker-session-log.schema.json');
  const comparisonSchema = readJson('../schemas/veritas-marker-score.schema.json');
  const suiteSchema = readJson('../schemas/veritas-marker-suite.schema.json');
  const suiteReportSchema = readJson('../schemas/veritas-marker-suite-report.schema.json');

  assert.ok(scenarioSchema.required.includes('marker'));
  assert.ok(sessionLogSchema.required.includes('turns'));
  assert.ok(sessionLogSchema.required.includes('benchmark_id'));
  assert.ok(comparisonSchema.required.includes('conditions'));
  assert.ok(suiteSchema.required.includes('benchmarks'));
  assert.ok(suiteReportSchema.required.includes('metrics'));
  assert.equal(withoutVeritas.benchmark_id, scenario.id);
  assert.equal(withVeritas.benchmark_id, scenario.id);
  assert.equal(scenario.scoring.allow_early, false);
  assert.equal(comparison.conditions.without_veritas.pass, false);
  assert.equal(comparison.conditions.with_veritas.pass, true);
  assert.equal(comparison.comparison.treatment_beats_baseline, true);
  assert.equal(suite.benchmarks.length, 6);
  assert.ok(
    suite.benchmarks.some((benchmark) => benchmark.benchmark_id === 'governance-protected-standards-marker'),
  );
  assert.ok(
    suite.benchmarks.some((benchmark) => benchmark.benchmark_id === 'governance-standards-growth-marker'),
  );
  assert.equal(suiteReport.metrics.pass_pow_k, 5 / 6);
  assert.equal(suiteReport.metrics.treatment_pass_rate, 7 / 8);
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
      suitePath: 'examples/benchmarks/suites/context-surfacing-suite.json',
      rootDir: repoRootDir,
    }),
    suiteReport,
  );
});

test('repo-local operational config covers the Veritas repo work areas', () => {
  const repoMap = readJson('../.veritas/repo-map.json');
  const nodeIds = new Set(repoMap.graph.nodes.map((node) => node.id));
  assert.ok(nodeIds.has('tooling.bin'));
  assert.ok(nodeIds.has('governance.schemas'));
  assert.ok(nodeIds.has('governance.repo-standards'));
  assert.ok(nodeIds.has('examples.example-data'));

  const repoStandards = readJson('../.veritas/repo-standards/default.repo-standards.json');
  assert.ok(repoStandards.rules.length >= 3);
  assert.ok(
    repoStandards.rules.some(
      (rule) =>
        Array.isArray(rule.match?.artifacts) && rule.match.artifacts.includes('bin/veritas.mjs'),
    ),
  );
});

test('repo includes an automated repo conformance workflow', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/veritas-conformance.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /npm run veritas:evidence-check/);
  assert.match(workflow, /node scripts\/repo-conformance-status\.mjs/);
  assert.match(workflow, /Update PR Comment/);
  assert.match(workflow, /Update Health Issue/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /actions\/github-script@v9/);
});
