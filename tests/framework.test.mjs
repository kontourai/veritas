import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildEvidenceRecord,
  buildSuggestedCiSnippet,
  buildSuggestedPackageScripts,
  classifyNodes,
  evaluatePolicyPack,
  inferBootstrapRepoInsights,
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
  assert.equal(initResult.repoInsights.repoKind, 'application');

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

test('print package-scripts returns conservative suggestions from inferred proof lane', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-print-scripts-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          verify: 'turbo run verify',
        },
      },
      null,
      2,
    ),
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'ai-guidance', 'print', 'package-scripts', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.proofLane, 'npm run verify');
  assert.equal(parsed.repoInsights.baseRef, 'main');
  assert.equal(parsed.scripts['guidance:init'], 'npm exec -- ai-guidance init');
  assert.equal(parsed.scripts['guidance:proof'], 'npm run verify');
  assert.equal(
    parsed.scripts['guidance:report:diff'],
    'npm exec -- ai-guidance report --changed-from main --changed-to HEAD',
  );
});

test('print ci-snippet returns a copy-paste starter snippet', () => {
  const snippet = buildSuggestedCiSnippet({
    proofLane: 'npm run verify',
    baseRef: 'main',
  });
  assert.match(snippet, /Run project proof lane/);
  assert.match(snippet, /npm exec -- ai-guidance report --changed-from main --changed-to HEAD/);

  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-print-ci-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { verify: 'turbo run verify' } }, null, 2));

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'ai-guidance', 'print', 'ci-snippet', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.proofLane, 'npm run verify');
  assert.equal(parsed.repoInsights.baseRef, '<base-ref>');
  assert.match(parsed.ciSnippet, /run: npm run verify/);
  assert.match(parsed.ciSnippet, /--changed-from <base-ref> --changed-to HEAD/);
});

test('adaptive bootstrap detects a workspace-shaped repo', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-workspace-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        workspaces: ['packages/*'],
        scripts: {
          verify: 'turbo run verify',
          test: 'turbo run test',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(rootDir, 'README.md'), '# Workspace\n');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# agents\n');
  mkdirp(join(rootDir, 'packages/app'));
  mkdirp(join(rootDir, 'tests'));
  mkdirp(join(rootDir, '.github/workflows'));

  const result = writeBootstrapStarterKit({ rootDir, projectName: 'Workspace Demo' });
  const adapter = readJsonFromAbsolute(join(rootDir, '.ai-guidance/repo.adapter.json'));
  const bootstrapReadme = readFileSync(join(rootDir, '.ai-guidance/README.md'), 'utf8');

  assert.equal(result.repoInsights.repoKind, 'workspace');
  assert.equal(result.proofLane, 'npm run verify');
  assert.ok(adapter.graph.nodes.some((node) => node.patterns.includes('packages/')));
  assert.match(bootstrapReadme, /Repo kind: `workspace`/);
});

test('adaptive bootstrap infers the proof lane through the shipped CLI path', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-workspace-cli-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        workspaces: ['packages/*'],
        scripts: {
          verify: 'turbo run verify',
          test: 'turbo run test',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(rootDir, 'README.md'), '# Workspace\n');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# agents\n');
  mkdirp(join(rootDir, 'packages/app'));

  const initStdout = execFileSync(
    'npm',
    ['exec', '--', 'ai-guidance', 'init', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const initResult = JSON.parse(initStdout);

  assert.equal(initResult.proofLane, 'npm run verify');
  assert.equal(initResult.repoInsights.repoKind, 'workspace');
});

test('adaptive bootstrap detects a docs-shaped repo', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-docs-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'docs:build': 'docusaurus build',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(rootDir, 'README.md'), '# Docs\n');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# agents\n');
  mkdirp(join(rootDir, 'docs'));
  mkdirp(join(rootDir, 'content'));

  const insights = inferBootstrapRepoInsights(rootDir);
  const result = writeBootstrapStarterKit({ rootDir, projectName: 'Docs Demo' });
  const adapter = readJsonFromAbsolute(join(rootDir, '.ai-guidance/repo.adapter.json'));

  assert.equal(insights.repoKind, 'docs');
  assert.equal(result.proofLane, 'npm run docs:build');
  assert.ok(
    adapter.graph.nodes.some(
      (node) => node.kind === 'product-surface' && node.patterns.includes('docs/'),
    ),
  );
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

test('script suggestion helper returns the expected keys', () => {
  const scripts = buildSuggestedPackageScripts({
    proofLane: 'npm run verify',
    baseRef: 'main',
  });
  assert.deepEqual(Object.keys(scripts), [
    'guidance:init',
    'guidance:print:scripts',
    'guidance:print:ci',
    'guidance:report',
    'guidance:report:diff',
    'guidance:proof',
  ]);
});

function readJsonFromAbsolute(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}
