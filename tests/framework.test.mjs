import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildEvidenceRecord,
  classifyNodes,
  evaluatePolicyPack,
  loadPolicyPack,
  resolveWorkstream,
  writeBootstrapStarterKit,
} from '../src/index.mjs';

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

const frameworkRootDir = fileURLToPath(new URL('..', import.meta.url));

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
  const evidenceSchema = readJson('../schemas/ai-guidance-evidence.schema.json');
  assert.ok(evidenceSchema.required.includes('framework'));
  assert.ok(evidenceSchema.required.includes('adapter'));
});

test('core classifies nodes and builds evidence from an adapter config', () => {
  const adapter = readJson('../adapters/work-agent.adapter.json');
  const policyPack = loadPolicyPack(
    new URL('../policy-packs/work-agent-convergence.policy-pack.json', import.meta.url),
  );
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-framework-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');

  const classification = classifyNodes(
    ['package.json', '.github/workflows/ci.yml'],
    adapter,
    rootDir,
  );
  assert.deepEqual(classification.affectedNodes, [
    'delivery.github',
    'governance.root-manifests',
  ]);

  const resolution = resolveWorkstream({}, adapter, [
    'docs/plans/plan-entity-hierarchy.md',
  ]);
  assert.deepEqual(resolution.matchedArtifacts, ['docs/plans/**']);

  const explicitResolution = resolveWorkstream(
    { workstream: 'explicit-demo' },
    adapter,
    ['package.json'],
  );
  assert.equal(explicitResolution.resolvedPhase, 'Phase 1 (Harden & Onboard)');
  assert.equal(explicitResolution.resolvedWorkstream, 'explicit-demo');

  const record = buildEvidenceRecord({
    files: ['package.json'],
    options: { baselineCiFastStatus: 'failed' },
    config: adapter,
    policyPack,
    rootDir,
  });
  assert.equal(record.framework_version, 1);
  assert.equal(record.framework.version, 1);
  assert.equal(record.baseline_ci_fast_passed, false);
  assert.equal(record.adapter.name, 'work-agent');
  assert.deepEqual(record.policy_pack, {
    name: 'work-agent-convergence',
    version: 1,
    rule_count: 4,
  });
  assert.deepEqual(adapter.policy, {
    defaultFalsePositiveReview: 'unknown',
    defaultPromotionCandidate: false,
    defaultOverrideOrBypass: false,
  });

  const evaluatedRules = evaluatePolicyPack(policyPack, { rootDir }, {
    ruleIds: ['required-repo-artifacts'],
  });
  assert.equal(evaluatedRules.length, 1);
  assert.equal(evaluatedRules[0].implemented, true);
  assert.equal(evaluatedRules[0].passed, false);
  assert.ok(
    evaluatedRules[0].findings.some(
      (finding) => finding.artifact === '.github/dependabot.yml',
    ),
  );
});

test('guidance CLI can run with explicit adapter and policy-pack inputs', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');

  const stdout = execFileSync(
    'node',
    [
      fileURLToPath(new URL('../bin/ai-guidance-report.mjs', import.meta.url)),
      '--root',
      rootDir,
      '--adapter',
      fileURLToPath(
        new URL('../adapters/work-agent.adapter.json', import.meta.url),
      ),
      '--policy-pack',
      fileURLToPath(
        new URL(
          '../policy-packs/work-agent-convergence.policy-pack.json',
          import.meta.url,
        ),
      ),
      '--run-id',
      'framework-cli-smoke',
      'package.json',
    ],
    { encoding: 'utf8' },
  );

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.run_id, 'framework-cli-smoke');
  assert.equal(parsed.adapter.name, 'work-agent');
  assert.deepEqual(parsed.affected_lanes, ['root manifests']);
  assert.deepEqual(parsed.policy_pack, {
    name: 'work-agent-convergence',
    version: 1,
    rule_count: 4,
  });
});

test('init CLI writes a conservative starter kit and report CLI can use it', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-init-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');

  const initStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Demo Starter',
      '--proof-lane',
      'npm run test:smoke',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const initResult = JSON.parse(initStdout);
  assert.equal(initResult.projectName, 'Demo Starter');
  assert.equal(initResult.proofLane, 'npm run test:smoke');
  assert.ok(
    initResult.generatedFiles.includes('.ai-guidance/repo.adapter.json'),
  );

  const starterAdapter = readJsonFromAbsolute(
    join(rootDir, '.ai-guidance/repo.adapter.json'),
  );
  const starterPolicyPack = readJsonFromAbsolute(
    join(rootDir, '.ai-guidance/policy-packs/default.policy-pack.json'),
  );
  const starterTeamProfile = readJsonFromAbsolute(
    join(rootDir, '.ai-guidance/team/default.team-profile.json'),
  );

  assert.equal(starterAdapter.name, 'demo-starter');
  assert.equal(starterPolicyPack.name, 'demo-starter-default');
  assert.equal(starterTeamProfile.defaults.mode, 'shadow');

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'report',
      '--root',
      rootDir,
      '--run-id',
      'bootstrap-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);
  assert.equal(reportResult.run_id, 'bootstrap-smoke');
  assert.equal(reportResult.adapter.name, 'demo-starter');
  assert.equal(reportResult.policy_pack.name, 'demo-starter-default');
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
});

test('live-eval fixtures explain outcome measurement and team tuning', () => {
  const evalRecord = readJson('../examples/evals/work-agent-shadow-eval.json');
  const teamProfile = readJson('../examples/evals/work-agent-team-profile.json');
  const evalSchema = readJson('../schemas/ai-guidance-eval-record.schema.json');
  const teamProfileSchema = readJson('../schemas/ai-guidance-team-profile.schema.json');

  assert.ok(evalSchema.required.includes('measurements'));
  assert.ok(teamProfileSchema.required.includes('promotion_preferences'));

  assert.equal(evalRecord.mode, 'shadow');
  assert.equal(evalRecord.outcome.accepted_without_major_rewrite, true);
  assert.equal(teamProfile.defaults.new_rule_stage, 'recommend');
  assert.equal(teamProfile.promotion_preferences.warnings_block_in_ci, false);
  assert.equal(
    teamProfile.promotion_preferences.require_consistent_eval_before_promotion,
    true,
  );
});

test('starter kit helper refuses to overwrite without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-init-overwrite-'));
  writeBootstrapStarterKit({ rootDir, projectName: 'Overwrite Demo' });

  assert.throws(
    () =>
      writeBootstrapStarterKit({
        rootDir,
        projectName: 'Overwrite Demo',
      }),
    /Refusing to overwrite existing file/,
  );
});

function readJsonFromAbsolute(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
