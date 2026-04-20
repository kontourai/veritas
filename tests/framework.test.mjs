import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyCiSnippet,
  applyPackageScripts,
  buildEvidenceRecord,
  buildEvalRecord,
  buildSuggestedCiSnippet,
  buildSuggestedPackageScripts,
  classifyNodes,
  evaluatePolicyPack,
  inferBootstrapRepoInsights,
  listWorkingTreeFiles,
  loadPolicyPack,
  resolveReportInputs,
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
  assert.equal(record.source_kind, 'explicit-files');
  assert.deepEqual(record.source_scope, ['explicit']);
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
  assert.equal(reportResult.source_kind, 'explicit-files');
  assert.deepEqual(reportResult.source_scope, ['explicit']);
});

test('buildEvalRecord links a real evidence artifact to a team profile', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-build-eval-'));
  mkdirp(join(rootDir, '.ai-guidance/evidence'));
  writeFileSync(
    join(rootDir, '.ai-guidance/evidence/eval-build-smoke.json'),
    JSON.stringify(
      {
        framework_version: 1,
        run_id: 'eval-build-smoke',
        timestamp: '2026-04-20T16:00:00.000Z',
        source_ref: 'working-tree',
        source_kind: 'working-tree',
        source_scope: ['staged', 'unstaged'],
        affected_nodes: ['governance.root-manifests'],
        affected_lanes: ['root manifests'],
      },
      null,
      2,
    ),
  );
  const evidenceRecord = {
    run_id: 'eval-build-smoke',
    framework_version: 1,
    timestamp: '2026-04-20T16:00:00.000Z',
    source_ref: 'working-tree',
    source_kind: 'working-tree',
    source_scope: ['staged', 'unstaged'],
    affected_nodes: ['governance.root-manifests'],
    affected_lanes: ['root manifests'],
  };
  const teamProfile = readJson('../examples/evals/work-agent-team-profile.json');

  const record = buildEvalRecord({
    evidenceRecord,
    evidencePath: join(rootDir, '.ai-guidance/evidence/eval-build-smoke.json'),
    teamProfile,
    options: {
      acceptedWithoutMajorRewrite: true,
      requiredFollowup: false,
      reviewerConfidence: 'high',
      timeToGreenMinutes: 18,
      overrideCount: 0,
      falsePositiveRules: [],
      missedIssues: [],
      notes: ['Grounded in a real evidence artifact.'],
    },
    rootDir,
  });

  assert.equal(record.run_id, 'eval-build-smoke');
  assert.equal(record.team_profile_id, 'work-agent-default');
  assert.equal(record.mode, 'shadow');
  assert.equal(record.evidence.source_ref, 'working-tree');
  assert.equal(record.evidence.source_kind, 'working-tree');
  assert.deepEqual(record.evidence.source_scope, ['staged', 'unstaged']);
  assert.equal(
    record.evidence.artifact_path,
    '.ai-guidance/evidence/eval-build-smoke.json',
  );
  assert.match(record.evidence.artifact_digest, /^[a-f0-9]{64}$/);
});

test('buildEvalRecord accepts reviewer confidence values from the team profile scale', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-build-eval-scale-'));
  mkdirp(join(rootDir, '.ai-guidance/evidence'));
  const evidencePath = join(rootDir, '.ai-guidance/evidence/eval-scale-smoke.json');
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        framework_version: 1,
        run_id: 'eval-scale-smoke',
        timestamp: '2026-04-20T16:05:00.000Z',
        source_ref: 'refs/heads/main',
        source_kind: 'explicit-files',
        source_scope: ['explicit'],
        affected_nodes: [],
        affected_lanes: [],
      },
      null,
      2,
    ),
  );
  const teamProfile = {
    id: 'custom-team',
    defaults: { mode: 'shadow' },
    review_preferences: { reviewer_confidence_scale: ['red', 'yellow', 'green'] },
  };

  const record = buildEvalRecord({
    evidenceRecord: readJsonFromAbsolute(evidencePath),
    evidencePath,
    teamProfile,
    options: {
      acceptedWithoutMajorRewrite: true,
      requiredFollowup: false,
      reviewerConfidence: 'green',
      timeToGreenMinutes: 10,
      overrideCount: 0,
      falsePositiveRules: [],
      missedIssues: [],
      notes: [],
    },
    rootDir,
  });

  assert.equal(record.outcome.reviewer_confidence, 'green');
});

test('working-tree helpers collect staged, unstaged, and untracked files distinctly', () => {
  const rootDir = initCommittedRepo('ai-guidance-working-tree-');
  writeFileSync(join(rootDir, 'tracked.txt'), 'before\n');
  commitAll(rootDir, 'Add tracked file');

  writeFileSync(join(rootDir, 'staged.txt'), 'staged\n');
  execFileSync('git', ['add', 'staged.txt'], { cwd: rootDir, encoding: 'utf8' });
  writeFileSync(join(rootDir, 'tracked.txt'), 'after\n');
  writeFileSync(join(rootDir, 'untracked.txt'), 'untracked\n');

  assert.deepEqual(listWorkingTreeFiles({ staged: true }, rootDir), ['staged.txt']);
  assert.deepEqual(listWorkingTreeFiles({ unstaged: true }, rootDir), ['tracked.txt']);
  assert.deepEqual(listWorkingTreeFiles({ untracked: true }, rootDir), ['untracked.txt']);
  assert.deepEqual(listWorkingTreeFiles({ staged: true, unstaged: true, untracked: true }, rootDir), [
    'staged.txt',
    'tracked.txt',
    'untracked.txt',
  ]);
});

test('report input resolution keeps branch-diff and working-tree modes explicit', () => {
  const rootDir = initCommittedRepo('ai-guidance-report-inputs-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  commitAll(rootDir, 'Add package manifest');

  assert.throws(
    () => resolveReportInputs([], { changedFrom: 'HEAD~1' }, rootDir),
    /requires both --changed-from and --changed-to/,
  );

  const branchInputs = resolveReportInputs(
    [],
    { changedFrom: 'HEAD~1', changedTo: 'HEAD' },
    rootDir,
  );
  assert.equal(branchInputs.sourceKind, 'branch-diff');
  assert.deepEqual(branchInputs.sourceScope, ['changed-from:HEAD~1', 'changed-to:HEAD']);
  assert.equal(branchInputs.sourceRef, 'HEAD~1..HEAD');

  writeFileSync(join(rootDir, 'staged.txt'), 'staged\n');
  execFileSync('git', ['add', 'staged.txt'], { cwd: rootDir, encoding: 'utf8' });
  const workingTreeInputs = resolveReportInputs([], { staged: true }, rootDir);
  assert.equal(workingTreeInputs.sourceKind, 'working-tree');
  assert.deepEqual(workingTreeInputs.sourceScope, ['staged']);
  assert.equal(workingTreeInputs.sourceRef, 'working-tree');
  assert.deepEqual(workingTreeInputs.files, ['staged.txt']);
});

test('report CLI can measure the full working tree', () => {
  const rootDir = initCommittedRepo('ai-guidance-working-tree-cli-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Working Tree Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  writeFileSync(join(rootDir, 'package.json'), '{\"name\":\"demo\"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: rootDir, encoding: 'utf8' });
  writeFileSync(join(rootDir, 'README.md'), '# changed\n');
  writeFileSync(join(rootDir, 'notes.txt'), 'untracked\n');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'report',
      '--root',
      rootDir,
      '--working-tree',
      '--run-id',
      'working-tree-smoke',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.source_kind, 'working-tree');
  assert.deepEqual(parsed.source_scope, ['staged', 'unstaged', 'untracked']);
  assert.deepEqual(parsed.files, ['README.md', 'notes.txt', 'package.json']);
});

test('report CLI can emit an empty current-state artifact for a clean working tree', () => {
  const rootDir = initCommittedRepo('ai-guidance-working-tree-clean-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Clean Working Tree Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'report',
      '--root',
      rootDir,
      '--working-tree',
      '--run-id',
      'working-tree-clean-smoke',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.source_kind, 'working-tree');
  assert.deepEqual(parsed.source_scope, ['staged', 'unstaged', 'untracked']);
  assert.deepEqual(parsed.files, []);
  assert.deepEqual(parsed.affected_nodes, []);
  assert.deepEqual(parsed.affected_lanes, []);
});

test('report CLI preserves branch-diff behavior', () => {
  const rootDir = initCommittedRepo('ai-guidance-branch-diff-cli-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Branch Diff Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  writeFileSync(join(rootDir, 'package.json'), '{\"name\":\"demo\"}\n');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'report',
      '--root',
      rootDir,
      '--changed-from',
      'HEAD~1',
      '--changed-to',
      'HEAD',
      '--run-id',
      'branch-diff-smoke',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.source_kind, 'branch-diff');
  assert.deepEqual(parsed.source_scope, ['changed-from:HEAD~1', 'changed-to:HEAD']);
  assert.deepEqual(parsed.files, [
    '.ai-guidance/README.md',
    '.ai-guidance/policy-packs/default.policy-pack.json',
    '.ai-guidance/repo.adapter.json',
    '.ai-guidance/team/default.team-profile.json',
  ]);
});

test('eval record CLI writes a repo-local shadow eval artifact from report output', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-eval-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Eval Demo',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

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
      'eval-cli-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);

  const evalStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'eval',
      'record',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
      '--accepted-without-major-rewrite',
      'true',
      '--required-followup',
      'false',
      '--reviewer-confidence',
      'high',
      '--time-to-green-minutes',
      '14',
      '--override-count',
      '0',
      '--note',
      'The evidence artifact was enough for a quick review.',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const evalResult = JSON.parse(evalStdout);
  const evalArtifact = readJsonFromAbsolute(join(rootDir, evalResult.artifactPath));

  assert.equal(evalResult.artifactPath, '.ai-guidance/evals/eval-cli-smoke.json');
  assert.equal(evalResult.run_id, 'eval-cli-smoke');
  assert.equal(evalResult.team_profile_id, 'eval-demo-default');
  assert.equal(evalResult.mode, 'shadow');
  assert.equal(evalResult.evidence.artifact_path, reportResult.artifactPath);
  assert.match(evalResult.evidence.artifact_digest, /^[a-f0-9]{64}$/);
  assert.equal(evalArtifact.outcome.reviewer_confidence, 'high');
  assert.deepEqual(evalArtifact.notes, [
    'The evidence artifact was enough for a quick review.',
  ]);
});

test('eval record CLI supports explicit team-profile and output paths', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-eval-cli-explicit-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  const initResult = writeBootstrapStarterKit({ rootDir, projectName: 'Eval Explicit Demo' });

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
      'eval-cli-explicit-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);

  const evalStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'ai-guidance',
      'eval',
      'record',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
      '--team-profile',
      initResult.generatedFiles.find((path) => path.endsWith('default.team-profile.json')),
      '--output',
      '.ai-guidance/evals/custom-shadow.json',
      '--accepted-without-major-rewrite',
      'false',
      '--required-followup',
      'true',
      '--reviewer-confidence',
      'unknown',
      '--time-to-green-minutes',
      '25',
      '--override-count',
      '2',
      '--false-positive-rule',
      'required-guidance-artifacts',
      '--missed-issue',
      'Return-package assembly still needed manual review.',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const evalResult = JSON.parse(evalStdout);

  assert.equal(evalResult.artifactPath, '.ai-guidance/evals/custom-shadow.json');
  assert.equal(evalResult.outcome.accepted_without_major_rewrite, false);
  assert.equal(evalResult.outcome.required_followup, true);
  assert.equal(evalResult.outcome.reviewer_confidence, 'unknown');
  assert.deepEqual(evalResult.measurements.false_positive_rules, [
    'required-guidance-artifacts',
  ]);
  assert.deepEqual(evalResult.measurements.missed_issues, [
    'Return-package assembly still needed manual review.',
  ]);
});

test('eval record CLI rejects evidence outside the repo-local evidence area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-eval-cli-invalid-evidence-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Eval Invalid Evidence Demo' });
  mkdirp(join(rootDir, 'tmp'));
  writeFileSync(
    join(rootDir, 'tmp/not-evidence.json'),
    JSON.stringify(
      {
        run_id: 'bad-evidence',
      },
      null,
      2,
    ),
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'ai-guidance',
          'eval',
          'record',
          '--root',
          rootDir,
          '--evidence',
          'tmp/not-evidence.json',
          '--accepted-without-major-rewrite',
          'true',
          '--required-followup',
          'false',
          '--reviewer-confidence',
          'unknown',
          '--time-to-green-minutes',
          '5',
          '--override-count',
          '0',
        ],
        { cwd: frameworkRootDir, encoding: 'utf8' },
      ),
    /repo-local evidence artifact inside \.ai-guidance\/evidence/,
  );
});

test('eval record CLI refuses to overwrite an existing eval artifact without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-eval-cli-overwrite-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Eval Overwrite Demo' });

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
      'eval-overwrite-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);
  const baseArgs = [
    'exec',
    '--',
    'ai-guidance',
    'eval',
    'record',
    '--root',
    rootDir,
    '--evidence',
    reportResult.artifactPath,
    '--accepted-without-major-rewrite',
    'true',
    '--required-followup',
    'false',
    '--reviewer-confidence',
    'unknown',
    '--time-to-green-minutes',
    '5',
    '--override-count',
    '0',
  ];

  execFileSync('npm', baseArgs, { cwd: frameworkRootDir, encoding: 'utf8' });
  assert.throws(
    () => execFileSync('npm', baseArgs, { cwd: frameworkRootDir, encoding: 'utf8' }),
    /Refusing to overwrite existing file/,
  );
  execFileSync('npm', [...baseArgs, '--force'], {
    cwd: frameworkRootDir,
    encoding: 'utf8',
  });
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

test('apply package-scripts writes the suggested guidance scripts into package.json', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-apply-scripts-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'ai-guidance', 'apply', 'package-scripts', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);
  const pkg = readJsonFromAbsolute(join(rootDir, 'package.json'));

  assert.equal(parsed.packageJsonPath, 'package.json');
  assert.equal(parsed.baseRef, 'main');
  assert.equal(pkg.scripts['guidance:init'], 'npm exec -- ai-guidance init');
  assert.equal(
    pkg.scripts['guidance:report:diff'],
    'npm exec -- ai-guidance report --changed-from main --changed-to HEAD',
  );
});

test('apply package-scripts surfaces script conflicts without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-apply-conflict-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'guidance:proof': 'echo custom',
        },
      },
      null,
      2,
    ),
  );

  assert.throws(
    () =>
      applyPackageScripts({
        rootDir,
        proofLane: 'npm test',
        baseRef: '<base-ref>',
      }),
    /Refusing to overwrite existing script guidance:proof/,
  );
});

test('apply ci-snippet writes a stable snippet file', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-apply-ci-'));
  const result = applyCiSnippet({
    rootDir,
    proofLane: 'npm run verify',
    baseRef: 'main',
  });
  const contents = readFileSync(
    join(rootDir, '.ai-guidance/snippets/ci-snippet.yml'),
    'utf8',
  );

  assert.equal(result.outputPath, '.ai-guidance/snippets/ci-snippet.yml');
  assert.match(contents, /run: npm run verify/);
  assert.match(contents, /--changed-from main --changed-to HEAD/);
});

test('apply ci-snippet rejects paths outside the reviewable snippet area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'ai-guidance-apply-ci-outside-'));

  assert.throws(
    () =>
      applyCiSnippet({
        rootDir,
        outputPath: '../outside.yml',
      }),
    /only supports writing inside \.ai-guidance\/snippets\//,
  );
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
  assert.ok(evalSchema.required.includes('evidence'));
  assert.ok(teamProfileSchema.required.includes('promotion_preferences'));

  assert.equal(evalRecord.mode, 'shadow');
  assert.equal(evalRecord.evidence.source_kind, 'branch-diff');
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

function initCommittedRepo(prefix) {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'AI Guidance Tests'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  execFileSync('git', ['config', 'user.email', 'tests@example.com'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  commitAll(rootDir, 'Initial commit');
  return rootDir;
}

function commitAll(rootDir, message) {
  execFileSync('git', ['add', '.'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', message], { cwd: rootDir, encoding: 'utf8' });
}
