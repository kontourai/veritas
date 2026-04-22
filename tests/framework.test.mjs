import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyCiSnippet,
  applyCodexHook,
  applyGitHook,
  inspectRuntimeAdapterStatus,
  applyRuntimeHook,
  applyPackageScripts,
  buildEvidenceRecord,
  buildEvalDraft,
  buildEvalRecord,
  buildSuggestedCodexHookConfig,
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedCiSnippet,
  buildSuggestedPackageScripts,
  classifyNodes,
  evaluatePolicyPack,
  generateEvalRecord,
  inferBootstrapRepoInsights,
  listWorkingTreeFiles,
  loadPolicyPack,
  resolveProofCommands,
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
  const evidenceSchema = readJson('../schemas/veritas-evidence.schema.json');
  assert.ok(evidenceSchema.required.includes('framework'));
  assert.ok(evidenceSchema.required.includes('adapter'));
  assert.ok(evidenceSchema.required.includes('selected_proof_commands'));
  assert.ok(evidenceSchema.required.includes('proof_resolution_source'));
  assert.ok(evidenceSchema.required.includes('policy_results'));
});

test('core classifies nodes and builds evidence from an adapter config', () => {
  const adapter = readJson('../adapters/work-agent.adapter.json');
  const policyPack = loadPolicyPack(
    new URL('../policy-packs/work-agent-convergence.policy-pack.json', import.meta.url),
  );
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-'));
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
  assert.deepEqual(record.selected_proof_commands, ['npm run ci:fast']);
  assert.equal(record.proof_resolution_source, 'legacy');
  assert.equal(record.adapter.name, 'work-agent');
  assert.deepEqual(record.policy_pack, {
    name: 'work-agent-convergence',
    version: 1,
    rule_count: 4,
  });
  assert.equal(record.policy_results.length, 4);
  assert.equal(record.policy_results[0].rule_id, 'required-repo-artifacts');
  assert.equal(record.policy_results[0].implemented, true);
  assert.equal(record.policy_results[0].passed, false);
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

test('surface-aware proof routing prefers surface routes, then default, then legacy', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-proof-plan-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  mkdirp(join(rootDir, 'scripts'));
  mkdirp(join(rootDir, 'packages/core'));
  mkdirp(join(rootDir, 'docs'));

  const adapter = {
    name: 'surface-proof-demo',
    kind: 'repo-adapter',
    policy: {
      defaultFalsePositiveReview: 'unknown',
      defaultPromotionCandidate: false,
      defaultOverrideOrBypass: false,
    },
    graph: {
      version: 1,
      defaultResolution: {
        phase: 'Phase 0',
        workstream: 'Demo',
        matchedArtifacts: ['README.md'],
      },
      nonSliceableInvariants: [],
      resolverPrecedence: ['explicit'],
      nodes: [
        { id: 'tooling.scripts', kind: 'tooling-surface', label: 'scripts/**', patterns: ['scripts/'] },
        { id: 'workspace.packages', kind: 'shared-package', label: 'packages/**', patterns: ['packages/'] },
        { id: 'docs.docs', kind: 'product-surface', label: 'docs/**', patterns: ['docs/'] },
      ],
    },
    evidence: {
      artifactDir: '.veritas/evidence',
      reportTransport: 'local-json',
      requiredProofLanes: ['npm run legacy-proof'],
      defaultProofLanes: ['npm run default-proof'],
      surfaceProofLanes: [
        { nodeIds: ['tooling.scripts'], proofLanes: ['npm run viewer:build', 'npm run viewer:build'] },
      ],
      uncoveredPathPolicy: 'warn',
    },
  };

  const surfacePlan = resolveProofCommands({
    adapterPath: writeTempAdapter(rootDir, adapter),
    files: ['scripts/build-viewer.mjs'],
    rootDir,
  });
  assert.deepEqual(surfacePlan.proofCommands, ['npm run viewer:build']);
  assert.equal(surfacePlan.resolutionSource, 'surface');

  const defaultPlan = resolveProofCommands({
    adapterPath: writeTempAdapter(rootDir, adapter),
    files: ['packages/core/index.ts'],
    rootDir,
  });
  assert.deepEqual(defaultPlan.proofCommands, ['npm run default-proof']);
  assert.equal(defaultPlan.resolutionSource, 'default');

  const mixedPlan = resolveProofCommands({
    adapterPath: writeTempAdapter(rootDir, adapter),
    files: ['scripts/build-viewer.mjs', 'packages/core/index.ts'],
    rootDir,
  });
  assert.deepEqual(mixedPlan.proofCommands, ['npm run viewer:build', 'npm run default-proof']);
  assert.equal(mixedPlan.resolutionSource, 'surface');

  delete adapter.evidence.defaultProofLanes;
  const legacyPlan = resolveProofCommands({
    adapterPath: writeTempAdapter(rootDir, adapter),
    files: ['docs/guide.md'],
    rootDir,
  });
  assert.deepEqual(legacyPlan.proofCommands, ['npm run legacy-proof']);
  assert.equal(legacyPlan.resolutionSource, 'legacy');
});

test('guidance CLI can run with explicit adapter and policy-pack inputs', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');

  const stdout = execFileSync(
    'node',
    [
      fileURLToPath(new URL('../bin/veritas-report.mjs', import.meta.url)),
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

test('CLI entrypoints expose help text for publishable operator surfaces', () => {
  const mainHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', '--help'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  assert.match(mainHelp, /veritas init/);
  assert.match(mainHelp, /veritas shadow run/);

  const reportHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'report', '--help'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  assert.match(reportHelp, /veritas report/);
  assert.match(reportHelp, /--changed-from <ref> --changed-to <ref>/);

  const printHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'codex-hook', '--help'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  assert.match(printHelp, /veritas print codex-hook/);
  assert.match(printHelp, /--codex-home <path>/);

  const reportBinaryHelp = execFileSync(
    'node',
    [fileURLToPath(new URL('../bin/veritas-report.mjs', import.meta.url)), '--help'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  assert.match(reportBinaryHelp, /veritas-report/);
});

test('init CLI writes a conservative starter kit and report CLI can use it', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');

  const initStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
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
    initResult.generatedFiles.includes('.veritas/repo.adapter.json'),
  );

  const starterAdapter = readJsonFromAbsolute(
    join(rootDir, '.veritas/repo.adapter.json'),
  );
  const starterPolicyPack = readJsonFromAbsolute(
    join(rootDir, '.veritas/policy-packs/default.policy-pack.json'),
  );
  const starterTeamProfile = readJsonFromAbsolute(
    join(rootDir, '.veritas/team/default.team-profile.json'),
  );

  assert.equal(starterAdapter.name, 'demo-starter');
  assert.equal(starterPolicyPack.name, 'demo-starter-default');
  assert.equal(starterTeamProfile.defaults.mode, 'shadow');
  assert.equal(initResult.repoInsights.repoKind, 'application');
  assert.equal(starterAdapter.evidence.defaultProofLanes, undefined);
  assert.equal(starterAdapter.evidence.uncoveredPathPolicy, undefined);

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
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
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-build-eval-'));
  mkdirp(join(rootDir, '.veritas/evidence'));
  writeFileSync(
    join(rootDir, '.veritas/evidence/eval-build-smoke.json'),
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
    evidencePath: join(rootDir, '.veritas/evidence/eval-build-smoke.json'),
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
    '.veritas/evidence/eval-build-smoke.json',
  );
  assert.match(record.evidence.artifact_digest, /^[a-f0-9]{64}$/);
});

test('buildEvalRecord accepts reviewer confidence values from the team profile scale', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-build-eval-scale-'));
  mkdirp(join(rootDir, '.veritas/evidence'));
  const evidencePath = join(rootDir, '.veritas/evidence/eval-scale-smoke.json');
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

test('buildEvalDraft captures prefilled context without fabricating judgment', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-build-eval-draft-'));
  mkdirp(join(rootDir, '.veritas/evidence'));
  const evidencePath = join(rootDir, '.veritas/evidence/eval-draft-smoke.json');
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        framework_version: 1,
        run_id: 'eval-draft-smoke',
        timestamp: '2026-04-20T17:00:00.000Z',
        source_ref: 'working-tree',
        source_kind: 'working-tree',
        source_scope: ['staged'],
        affected_nodes: ['governance.root-manifests'],
        affected_lanes: ['root manifests'],
      },
      null,
      2,
    ),
  );
  const teamProfile = readJson('../examples/evals/work-agent-team-profile.json');

  const draft = buildEvalDraft({
    evidenceRecord: readJsonFromAbsolute(evidencePath),
    evidencePath,
    teamProfile,
    options: {
      overrideCount: 0,
      notes: ['Prefilled from the framework draft flow.'],
    },
    rootDir,
  });

  assert.equal(draft.run_id, 'eval-draft-smoke');
  assert.equal(draft.prefilled_outcome.reviewer_confidence, 'unknown');
  assert.equal(draft.prefilled_measurements.time_to_green_minutes, null);
  assert.deepEqual(draft.missing_confirmation_fields, [
    'accepted_without_major_rewrite',
    'required_followup',
    'time_to_green_minutes',
  ]);
});

test('generateEvalRecord accepts programmatic options without CLI array defaults', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-generate-eval-record-'));
  mkdirp(join(rootDir, '.veritas/evidence'));
  mkdirp(join(rootDir, '.veritas/team'));

  writeFileSync(
    join(rootDir, '.veritas/evidence/programmatic-eval.json'),
    JSON.stringify(readJson('../examples/evidence/work-agent-pass.json'), null, 2),
  );
  writeFileSync(
    join(rootDir, '.veritas/team/default.team-profile.json'),
    JSON.stringify(readJson('../examples/evals/work-agent-team-profile.json'), null, 2),
  );

  const result = generateEvalRecord(
    {
      rootDir,
      evidencePath: '.veritas/evidence/programmatic-eval.json',
      teamProfilePath: '.veritas/team/default.team-profile.json',
      acceptedWithoutMajorRewrite: true,
      requiredFollowup: false,
      reviewerConfidence: 'high',
      timeToGreenMinutes: 3,
      overrideCount: 0,
    },
    { rootDir },
  );

  assert.equal(result.record.run_id, 'work-agent-pass-example');
  assert.equal(result.record.measurements.override_count, 0);
});

test('working-tree helpers collect staged, unstaged, and untracked files distinctly', () => {
  const rootDir = initCommittedRepo('veritas-working-tree-');
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
  const rootDir = initCommittedRepo('veritas-report-inputs-');
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
  const rootDir = initCommittedRepo('veritas-working-tree-cli-');
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
      'veritas',
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
  const rootDir = initCommittedRepo('veritas-working-tree-clean-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Clean Working Tree Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
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
  const rootDir = initCommittedRepo('veritas-branch-diff-cli-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Branch Diff Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  writeFileSync(join(rootDir, 'package.json'), '{\"name\":\"demo\"}\n');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
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
    '.veritas/README.md',
    '.veritas/policy-packs/default.policy-pack.json',
    '.veritas/repo.adapter.json',
    '.veritas/team/default.team-profile.json',
  ]);
});

test('eval record CLI writes a repo-local shadow eval artifact from report output', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
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
      'veritas',
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
      'veritas',
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

  assert.equal(evalResult.artifactPath, '.veritas/evals/eval-cli-smoke.json');
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

test('eval draft CLI writes a repo-local draft artifact and suggested next step', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-draft-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Eval Draft Demo',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'report',
      '--root',
      rootDir,
      '--run-id',
      'eval-draft-cli-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);

  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'eval',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);
  const draftArtifact = readJsonFromAbsolute(join(rootDir, draftResult.artifactPath));

  assert.equal(draftResult.artifactPath, '.veritas/eval-drafts/eval-draft-cli-smoke.json');
  assert.match(draftResult.suggestedRecordCommand, /veritas eval record --draft/);
  assert.deepEqual(draftArtifact.missing_confirmation_fields, [
    'accepted_without_major_rewrite',
    'required_followup',
    'time_to_green_minutes',
  ]);
});

test('eval record CLI can consume a draft artifact', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-record-from-draft-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Eval Record Draft Demo',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'report',
      '--root',
      rootDir,
      '--run-id',
      'eval-record-draft-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);

  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'eval',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
      '--override-count',
      '1',
      '--note',
      'Draft-first flow.',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);

  const evalStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'eval',
      'record',
      '--root',
      rootDir,
      '--draft',
      draftResult.artifactPath,
      '--accepted-without-major-rewrite',
      'true',
      '--required-followup',
      'false',
      '--time-to-green-minutes',
      '9',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const evalResult = JSON.parse(evalStdout);

  assert.equal(evalResult.evidence.artifact_path, reportResult.artifactPath);
  assert.equal(evalResult.measurements.override_count, 1);
  assert.deepEqual(evalResult.notes, ['Draft-first flow.']);
  assert.equal(evalResult.outcome.accepted_without_major_rewrite, true);
  assert.equal(evalResult.measurements.time_to_green_minutes, 9);
});

test('eval record CLI rejects draft artifacts outside the repo-local draft area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-record-external-draft-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Eval Record External Draft Demo',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'report',
      '--root',
      rootDir,
      '--run-id',
      'eval-record-external-draft-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);
  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'eval',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);
  const externalDraftPath = join(tmpdir(), 'external-eval-draft.json');
  writeFileSync(
    externalDraftPath,
    JSON.stringify(readJsonFromAbsolute(join(rootDir, draftResult.artifactPath)), null, 2),
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'eval',
          'record',
          '--root',
          rootDir,
          '--draft',
          externalDraftPath,
          '--accepted-without-major-rewrite',
          'true',
          '--required-followup',
          'false',
          '--time-to-green-minutes',
          '9',
        ],
        { cwd: frameworkRootDir, encoding: 'utf8' },
      ),
    /repo-local draft artifact inside \.veritas\/eval-drafts/,
  );
});

test('eval record CLI rejects draft/team-profile rebinding', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-record-draft-profile-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Eval Record Draft Profile Demo',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const altTeamProfilePath = join(rootDir, '.veritas/team/alt.team-profile.json');
  writeFileSync(
    altTeamProfilePath,
    JSON.stringify(
      {
        version: 1,
        id: 'alt-team',
        name: 'Alt Team',
        description: 'Alt scale',
        defaults: { mode: 'shadow', new_rule_stage: 'recommend' },
        review_preferences: {
          human_signoff_required_for_stage_promotion: true,
          reviewer_confidence_scale: ['red', 'yellow', 'green'],
          major_rewrite_definition: 'Alt',
        },
        promotion_preferences: {
          proof_lanes_required_before_block: ['npm test'],
          warnings_block_in_ci: false,
          require_consistent_eval_before_promotion: true,
        },
      },
      null,
      2,
    ),
  );

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'report',
      '--root',
      rootDir,
      '--run-id',
      'eval-record-draft-profile-smoke',
      'package.json',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const reportResult = JSON.parse(reportStdout);
  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'eval',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'eval',
          'record',
          '--root',
          rootDir,
          '--draft',
          draftResult.artifactPath,
          '--team-profile',
          '.veritas/team/alt.team-profile.json',
          '--accepted-without-major-rewrite',
          'true',
          '--required-followup',
          'false',
          '--time-to-green-minutes',
          '9',
        ],
        { cwd: frameworkRootDir, encoding: 'utf8' },
      ),
    /must be completed with the same team profile/,
  );
});

test('eval record CLI supports explicit team-profile and output paths', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-cli-explicit-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  const initResult = writeBootstrapStarterKit({ rootDir, projectName: 'Eval Explicit Demo' });

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
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
      'veritas',
      'eval',
      'record',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
      '--team-profile',
      initResult.generatedFiles.find((path) => path.endsWith('default.team-profile.json')),
      '--output',
      '.veritas/evals/custom-shadow.json',
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
      'required-veritas-artifacts',
      '--missed-issue',
      'Return-package assembly still needed manual review.',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const evalResult = JSON.parse(evalStdout);

  assert.equal(evalResult.artifactPath, '.veritas/evals/custom-shadow.json');
  assert.equal(evalResult.outcome.accepted_without_major_rewrite, false);
  assert.equal(evalResult.outcome.required_followup, true);
  assert.equal(evalResult.outcome.reviewer_confidence, 'unknown');
  assert.deepEqual(evalResult.measurements.false_positive_rules, [
    'required-veritas-artifacts',
  ]);
  assert.deepEqual(evalResult.measurements.missed_issues, [
    'Return-package assembly still needed manual review.',
  ]);
});

test('eval record CLI rejects evidence outside the repo-local evidence area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-cli-invalid-evidence-'));
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
          'veritas',
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
    /repo-local evidence artifact inside \.veritas\/evidence/,
  );
});

test('eval record CLI refuses to overwrite an existing eval artifact without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-cli-overwrite-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Eval Overwrite Demo' });

  const reportStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
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
    'veritas',
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

test('shadow run CLI stops at report and draft when judgment fields are missing', () => {
  const rootDir = initCommittedRepo('veritas-shadow-run-draft-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Shadow Run Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'shadow', 'run', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.mode, 'report-and-draft');
  assert.equal(parsed.proofRan, true);
  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
  assert.match(parsed.suggestedEvalCommand, /veritas eval record --draft/);
});

test('shadow run CLI can complete the full draft-and-record path', () => {
  const rootDir = initCommittedRepo('veritas-shadow-run-record-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Shadow Run Record Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'shadow',
      'run',
      '--root',
      rootDir,
      '--accepted-without-major-rewrite',
      'true',
      '--required-followup',
      'false',
      '--time-to-green-minutes',
      '7',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.mode, 'report-draft-and-eval');
  assert.equal(parsed.evalMode, 'shadow');
  assert.equal(parsed.proofRan, true);
  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
});

test('shadow run CLI rejects incomplete branch-diff refs', () => {
  const rootDir = initCommittedRepo('veritas-shadow-run-diff-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Shadow Run Diff Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'shadow',
          'run',
          '--root',
          rootDir,
          '--skip-proof',
          '--changed-from',
          'HEAD~1',
        ],
        { cwd: frameworkRootDir, encoding: 'utf8' },
      ),
    /requires both --changed-from and --changed-to/,
  );
});

test('shadow run CLI executes every required proof lane from the adapter', () => {
  const rootDir = initCommittedRepo('veritas-shadow-run-multi-proof-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Shadow Run Multi Proof Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  const adapterPath = join(rootDir, '.veritas/repo.adapter.json');
  const adapter = readJsonFromAbsolute(adapterPath);
  adapter.evidence.requiredProofLanes = [
    'node -e "process.exit(0)"',
    'node -e "process.exit(0)"',
  ];
  writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`, 'utf8');

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'shadow', 'run', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
  assert.equal(parsed.proofResolutionSource, 'legacy');
});

test('print package-scripts returns conservative suggestions from inferred proof lane', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-scripts-'));
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
    ['exec', '--', 'veritas', 'print', 'package-scripts', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.proofLane, 'npm run verify');
  assert.equal(parsed.repoInsights.baseRef, 'main');
  assert.equal(parsed.scripts['veritas:init'], 'npm exec -- veritas init');
  assert.equal(parsed.scripts['veritas:proof'], 'npm run verify');
  assert.equal(
    parsed.scripts['veritas:report:working-tree'],
    'npm exec -- veritas report --working-tree',
  );
  assert.equal(parsed.scripts['veritas:eval'], 'npm exec -- veritas shadow run');
  assert.equal(
    parsed.scripts['veritas:report:diff'],
    'npm exec -- veritas report --changed-from main --changed-to HEAD',
  );
});

test('print ci-snippet returns a copy-paste starter snippet', () => {
  const snippet = buildSuggestedCiSnippet({
    proofLane: 'npm run verify',
    baseRef: 'main',
  });
  assert.match(snippet, /Run project proof lane/);
  assert.match(snippet, /npm exec -- veritas report --changed-from main --changed-to HEAD/);

  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-ci-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { verify: 'turbo run verify' } }, null, 2));

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'ci-snippet', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.proofLane, 'npm run verify');
  assert.equal(parsed.repoInsights.baseRef, '<base-ref>');
  assert.match(parsed.ciSnippet, /run: npm run verify/);
  assert.match(parsed.ciSnippet, /--changed-from <base-ref> --changed-to HEAD/);
});

test('print git-hook returns a tracked post-commit adapter', () => {
  const hookBody = buildSuggestedGitHook({ hook: 'post-commit' });
  assert.match(hookBody, /^#!\/bin\/sh/m);
  assert.match(hookBody, /veritas shadow run --changed-from HEAD~1 --changed-to HEAD/);

  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-hook-'));
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'git-hook', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.hook, 'post-commit');
  assert.equal(parsed.suggestedHooksPath, '.githooks');
  assert.match(parsed.hookBody, /VERITAS_HOOK_SKIP/);
});

test('print runtime-hook returns a tracked agent-runtime adapter', () => {
  const hookBody = buildSuggestedRuntimeHook();
  assert.match(hookBody, /^#!\/bin\/sh/m);
  assert.match(hookBody, /veritas shadow run --working-tree/);

  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-runtime-hook-'));
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'runtime-hook', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.outputPath, '.veritas/hooks/agent-runtime.sh');
  assert.equal(parsed.defaultInvocation, '.veritas/hooks/agent-runtime.sh');
  assert.match(parsed.hookBody, /VERITAS_HOOK_SKIP/);
});

test('print codex-hook returns a tracked codex hooks adapter', () => {
  const hookConfig = buildSuggestedCodexHookConfig();
  assert.equal(hookConfig.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');

  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-codex-hook-'));
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'codex-hook', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.outputPath, '.veritas/runtime/codex-hooks.json');
  assert.equal(parsed.hookConfig.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
  assert.equal(parsed.targetStatus.resolvedTargetPath, null);
  assert.equal(parsed.targetStatus.targetExists, false);
  assert.equal(parsed.targetStatus.adapterInstalled, false);
});

test('print codex-hook can preview a Codex home target and install state', () => {
  const rootDir = initCommittedRepo('veritas-print-codex-hook-home-');
  const codexHome = join(rootDir, 'tmp-codex-home');
  mkdirp(codexHome);
  writeFileSync(
    join(codexHome, 'hooks.json'),
    JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              matcher: '.*',
              hooks: [
                {
                  type: 'command',
                  command: '.veritas/hooks/agent-runtime.sh',
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'print',
      'codex-hook',
      '--root',
      rootDir,
      '--codex-home',
      'tmp-codex-home',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.targetStatus.resolvedTargetPath, 'tmp-codex-home/hooks.json');
  assert.equal(parsed.targetStatus.targetExists, true);
  assert.equal(parsed.targetStatus.adapterInstalled, true);
  assert.match(parsed.suggestedApplyCommand, /--codex-home tmp-codex-home/);
});

test('print codex-hook reports an absolute external Codex home path clearly', () => {
  const rootDir = initCommittedRepo('veritas-print-codex-hook-external-');
  const codexHome = mkdtempSync(join(tmpdir(), 'external-codex-home-'));
  writeFileSync(
    join(codexHome, 'hooks.json'),
    JSON.stringify({ hooks: {} }, null, 2),
  );

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'print',
      'codex-hook',
      '--root',
      rootDir,
      '--codex-home',
      codexHome,
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.targetStatus.resolvedTargetPath, `${codexHome.replaceAll('\\', '/')}/hooks.json`);
  assert.equal(parsed.targetStatus.targetExists, true);
});

test('apply package-scripts writes the suggested guidance scripts into package.json', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-scripts-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'apply', 'package-scripts', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = JSON.parse(stdout);
  const pkg = readJsonFromAbsolute(join(rootDir, 'package.json'));

  assert.equal(parsed.packageJsonPath, 'package.json');
  assert.equal(parsed.baseRef, 'main');
  assert.equal(pkg.scripts['veritas:init'], 'npm exec -- veritas init');
  assert.equal(
    pkg.scripts['veritas:report:diff'],
    'npm exec -- veritas report --changed-from main --changed-to HEAD',
  );
});

test('apply package-scripts surfaces script conflicts without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-conflict-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'veritas:proof': 'echo custom',
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
    /Refusing to overwrite existing script veritas:proof/,
  );
});

test('apply ci-snippet writes a stable snippet file', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-ci-'));
  const result = applyCiSnippet({
    rootDir,
    proofLane: 'npm run verify',
    baseRef: 'main',
  });
  const contents = readFileSync(
    join(rootDir, '.veritas/snippets/ci-snippet.yml'),
    'utf8',
  );

  assert.equal(result.outputPath, '.veritas/snippets/ci-snippet.yml');
  assert.match(contents, /run: npm run verify/);
  assert.match(contents, /--changed-from main --changed-to HEAD/);
});

test('apply git-hook writes a tracked executable hook file', () => {
  const rootDir = initCommittedRepo('veritas-apply-hook-');
  const result = applyGitHook({
    rootDir,
    hook: 'post-commit',
  });
  const contents = readFileSync(join(rootDir, '.githooks/post-commit'), 'utf8');

  assert.equal(result.outputPath, '.githooks/post-commit');
  assert.equal(result.hook, 'post-commit');
  assert.match(contents, /veritas shadow run --changed-from HEAD~1 --changed-to HEAD/);
});

test('apply git-hook can configure the local hooks path explicitly', () => {
  const rootDir = initCommittedRepo('veritas-apply-hook-config-');
  const result = applyGitHook({
    rootDir,
    hook: 'post-commit',
    configureGit: true,
  });
  const configuredHooksPath = execFileSync(
    'git',
    ['config', '--get', 'core.hooksPath'],
    { cwd: rootDir, encoding: 'utf8' },
  ).trim();

  assert.equal(result.configuredHooksPath, '.githooks');
  assert.equal(configuredHooksPath, '.githooks');
});

test('apply runtime-hook writes a tracked executable runtime hook file', () => {
  const rootDir = initCommittedRepo('veritas-apply-runtime-hook-');
  const result = applyRuntimeHook({
    rootDir,
  });
  const contents = readFileSync(join(rootDir, '.veritas/hooks/agent-runtime.sh'), 'utf8');

  assert.equal(result.outputPath, '.veritas/hooks/agent-runtime.sh');
  assert.match(contents, /veritas shadow run --working-tree/);
});

test('apply codex-hook writes a tracked codex hooks artifact and can merge it', () => {
  const rootDir = initCommittedRepo('veritas-apply-codex-hook-');
  const targetHooksFile = join(rootDir, 'tmp-hooks.json');
  writeFileSync(
    targetHooksFile,
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: 'startup',
              hooks: [{ type: 'command', command: 'echo existing' }],
            },
          ],
          Stop: [
            {
              matcher: '.*',
              hooks: [
                { type: 'command', command: '.veritas/hooks/agent-runtime.sh' },
                { type: 'command', command: 'echo keep-me' },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const result = applyCodexHook({
    rootDir,
    targetHooksFile,
  });
  const contents = readJsonFromAbsolute(join(rootDir, '.veritas/runtime/codex-hooks.json'));
  const merged = readJsonFromAbsolute(targetHooksFile);

  assert.equal(result.outputPath, '.veritas/runtime/codex-hooks.json');
  assert.equal(result.mergedTargetPath, 'tmp-hooks.json');
  assert.equal(contents.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
  assert.equal(merged.hooks.SessionStart[0].hooks[0].command, 'echo existing');
  assert.equal(merged.hooks.Stop[0].hooks[0].command, 'echo keep-me');
  assert.equal(merged.hooks.Stop[1].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
});

test('apply codex-hook can resolve a Codex home into hooks.json', () => {
  const rootDir = initCommittedRepo('veritas-apply-codex-home-');
  const codexHome = join(rootDir, 'tmp-codex-home');
  const targetHooksFile = join(codexHome, 'hooks.json');
  mkdirp(codexHome);
  writeFileSync(
    targetHooksFile,
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: 'startup',
              hooks: [{ type: 'command', command: 'echo existing' }],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const result = applyCodexHook({
    rootDir,
    codexHome,
  });
  const merged = readJsonFromAbsolute(targetHooksFile);

  assert.equal(result.mergedTargetPath, 'tmp-codex-home/hooks.json');
  assert.equal(merged.hooks.SessionStart[0].hooks[0].command, 'echo existing');
  assert.equal(merged.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
});

test('apply codex-hook reports an absolute external Codex home target clearly', () => {
  const rootDir = initCommittedRepo('veritas-apply-codex-home-external-');
  const codexHome = mkdtempSync(join(tmpdir(), 'external-codex-home-'));
  const targetHooksFile = join(codexHome, 'hooks.json');
  writeFileSync(targetHooksFile, JSON.stringify({ hooks: {} }, null, 2));

  const result = applyCodexHook({
    rootDir,
    codexHome,
  });

  assert.equal(result.mergedTargetPath, `${codexHome.replaceAll('\\', '/')}/hooks.json`);
});

test('apply git-hook rejects configured installs with a non-discoverable filename', () => {
  const rootDir = initCommittedRepo('veritas-apply-hook-bad-name-');

  assert.throws(
    () =>
      applyGitHook({
        rootDir,
        hook: 'post-commit',
        outputPath: '.githooks/custom-hook',
        configureGit: true,
      }),
    /requires the output filename to match post-commit/,
  );
});

test('apply ci-snippet rejects paths outside the reviewable snippet area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-ci-outside-'));

  assert.throws(
    () =>
      applyCiSnippet({
        rootDir,
        outputPath: '../outside.yml',
      }),
    /only supports writing inside \.veritas\/snippets\//,
  );
});

test('apply git-hook rejects unsupported hook kinds', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-hook-unsupported-'));

  assert.throws(
    () =>
      buildSuggestedGitHook({
        hook: 'pre-push',
      }),
    /Unsupported git hook kind: pre-push/,
  );

  assert.throws(
    () =>
      applyGitHook({
        rootDir,
        hook: 'pre-push',
      }),
    /Unsupported git hook kind: pre-push/,
  );
});

test('apply runtime-hook rejects paths outside the reviewable hook area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-runtime-hook-outside-'));

  assert.throws(
    () =>
      applyRuntimeHook({
        rootDir,
        outputPath: '../outside.sh',
      }),
    /only supports writing inside \.veritas\/hooks\//,
  );
});

test('apply codex-hook rejects paths outside the reviewable codex hook area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-codex-hook-outside-'));

  assert.throws(
    () =>
      applyCodexHook({
        rootDir,
        outputPath: '../outside.json',
      }),
    /only supports writing inside \.veritas\/runtime\//,
  );
});

test('apply codex-hook rejects conflicting target hooks path and Codex home inputs', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-codex-hook-conflict-'));

  assert.throws(
    () =>
      applyCodexHook({
        rootDir,
        targetHooksFile: 'hooks.json',
        codexHome: '.codex',
      }),
    /accepts either --target-hooks-file or --codex-home, not both/,
  );
});

test('runtime status reports missing adapter state and next commands', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-missing-');
  const status = inspectRuntimeAdapterStatus(rootDir);

  assert.equal(status.gitHook.exists, false);
  assert.equal(status.runtimeHook.exists, false);
  assert.equal(status.codexArtifact.exists, false);
  assert.equal(status.codexTarget.checked, false);
  assert.equal(status.codexTarget.resolvedTargetPath, null);
  assert.ok(status.nextCommands.includes('npm exec -- veritas apply git-hook --configure-git'));
  assert.ok(status.nextCommands.includes('npm exec -- veritas apply runtime-hook'));
  assert.ok(status.nextCommands.includes('npm exec -- veritas print codex-hook'));
  assert.ok(
    status.nextCommands.includes(
      'npm exec -- veritas print codex-hook --codex-home /path/to/.codex',
    ),
  );
});

test('runtime status reports installed adapter state including codex target', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-installed-');
  applyGitHook({ rootDir, configureGit: true });
  applyRuntimeHook({ rootDir });
  const codexHome = join(rootDir, 'tmp-codex-home');
  mkdirp(codexHome);
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2));
  applyCodexHook({ rootDir, codexHome });

  const status = inspectRuntimeAdapterStatus(rootDir, { codexHome });

  assert.equal(status.gitHook.exists, true);
  assert.equal(status.gitHook.configured, true);
  assert.equal(status.runtimeHook.exists, true);
  assert.equal(status.codexArtifact.exists, true);
  assert.equal(status.codexTarget.checked, true);
  assert.equal(status.codexTarget.targetExists, true);
  assert.equal(status.codexTarget.adapterInstalled, true);
  assert.deepEqual(status.nextCommands, []);
});

test('runtime status recommends repair commands for non-executable managed hooks', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-broken-hooks-');
  applyGitHook({ rootDir, configureGit: true });
  applyRuntimeHook({ rootDir });
  chmodSync(join(rootDir, '.githooks/post-commit'), 0o644);
  chmodSync(join(rootDir, '.veritas/hooks/agent-runtime.sh'), 0o644);

  const status = inspectRuntimeAdapterStatus(rootDir);

  assert.equal(status.gitHook.exists, true);
  assert.equal(status.gitHook.executable, false);
  assert.equal(status.runtimeHook.exists, true);
  assert.equal(status.runtimeHook.executable, false);
  assert.ok(
    status.nextCommands.includes(
      'npm exec -- veritas apply git-hook --configure-git --force',
    ),
  );
  assert.ok(
    status.nextCommands.includes('npm exec -- veritas apply runtime-hook --force'),
  );
});

test('runtime status recommends forceful codex repair when the tracked artifact exists but target is stale', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-codex-repair-');
  const codexHome = join(rootDir, 'tmp-codex-home');
  mkdirp(codexHome);
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2));
  applyCodexHook({ rootDir, codexHome });
  writeFileSync(
    join(codexHome, 'hooks.json'),
    JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              matcher: '.*',
              hooks: [{ type: 'command', command: 'echo missing-adapter' }],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const status = inspectRuntimeAdapterStatus(rootDir, { codexHome });

  assert.equal(status.codexArtifact.exists, true);
  assert.equal(status.codexTarget.checked, true);
  assert.equal(status.codexTarget.adapterInstalled, false);
  assert.ok(
    status.nextCommands.includes(
      `npm exec -- veritas apply codex-hook --codex-home ${codexHome.replaceAll('\\', '/')} --force`,
    ),
  );
});

test('generated post-commit hook runs successfully after the initial commit boundary', () => {
  const rootDir = initCommittedRepo('veritas-hook-root-commit-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: rootDir, encoding: 'utf8' });
  installLocalVeritasBin(rootDir);

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Hook Root Commit Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  applyGitHook({ rootDir, hook: 'post-commit' });
  commitAll(rootDir, 'Initial guided commit');

  const stdout = execFileSync(join(rootDir, '.githooks/post-commit'), {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.mode, 'report-and-draft');
  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
});

test('generated post-commit hook runs successfully on a normal subsequent commit path', () => {
  const rootDir = initCommittedRepo('veritas-hook-followup-commit-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  installLocalVeritasBin(rootDir);

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Hook Followup Commit Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  applyGitHook({ rootDir, hook: 'post-commit' });
  commitAll(rootDir, 'Initial guided commit');

  writeFileSync(join(rootDir, 'README.md'), '# changed\n');
  execFileSync('git', ['add', 'README.md'], { cwd: rootDir, encoding: 'utf8' });
  commitAll(rootDir, 'Followup change');

  const stdout = execFileSync(join(rootDir, '.githooks/post-commit'), {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.mode, 'report-and-draft');
  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
});

test('generated runtime hook runs successfully with the default working-tree path', () => {
  const rootDir = initCommittedRepo('veritas-runtime-hook-run-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  installLocalVeritasBin(rootDir);

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Runtime Hook Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  applyRuntimeHook({ rootDir });

  const stdout = execFileSync(join(rootDir, '.veritas/hooks/agent-runtime.sh'), {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.mode, 'report-and-draft');
  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
  assert.equal(parsed.reportSourceKind, 'working-tree');
});

test('adaptive bootstrap detects a workspace-shaped repo', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-workspace-'));
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
  const adapter = readJsonFromAbsolute(join(rootDir, '.veritas/repo.adapter.json'));
  const bootstrapReadme = readFileSync(join(rootDir, '.veritas/README.md'), 'utf8');

  assert.equal(result.repoInsights.repoKind, 'workspace');
  assert.equal(result.proofLane, 'npm run verify');
  assert.ok(adapter.graph.nodes.some((node) => node.patterns.includes('packages/')));
  assert.deepEqual(adapter.evidence.defaultProofLanes, ['npm run verify']);
  assert.equal(adapter.evidence.uncoveredPathPolicy, 'warn');
  assert.match(bootstrapReadme, /Repo kind: `workspace`/);
  assert.match(bootstrapReadme, /Surface-Aware Routing/);
});

test('adaptive bootstrap infers the proof lane through the shipped CLI path', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-workspace-cli-'));
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
    ['exec', '--', 'veritas', 'init', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const initResult = JSON.parse(initStdout);

  assert.equal(initResult.proofLane, 'npm run verify');
  assert.equal(initResult.repoInsights.repoKind, 'workspace');
  assert.equal(initResult.repoInsights.enableSurfaceProofRouting, true);
});

test('adaptive bootstrap detects a docs-shaped repo', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-docs-'));
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
  const adapter = readJsonFromAbsolute(join(rootDir, '.veritas/repo.adapter.json'));

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

  const dogfoodReport = readJson('../examples/dogfood/veritas-repo-report.json');
  assert.equal(dogfoodReport.adapter.name, 'veritas');
  assert.ok(Array.isArray(dogfoodReport.policy_results));
  assert.ok(dogfoodReport.policy_results.some((result) => result.passed === true));
});

test('repo-local dogfood config covers the framework repo surface', () => {
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

test('repo includes an automated dogfood workflow', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/veritas-dogfood.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /schedule:/);
  assert.match(workflow, /npm run veritas:ci:dogfood/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});

test('starter kit helper refuses to overwrite without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-overwrite-'));
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
    'veritas:init',
    'veritas:print:scripts',
    'veritas:print:ci',
    'veritas:report',
    'veritas:report:working-tree',
    'veritas:report:diff',
    'veritas:status:runtime',
    'veritas:proof',
    'veritas:eval',
  ]);
});

function readJsonFromAbsolute(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeTempAdapter(rootDir, adapter) {
  const adapterPath = join(rootDir, '.veritas-repo.adapter.json');
  writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  return adapterPath;
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

function initCommittedRepo(prefix) {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Veritas Tests'], {
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

function installLocalVeritasBin(rootDir) {
  const binDir = join(rootDir, 'node_modules/.bin');
  mkdirp(binDir);
  const wrapperPath = join(binDir, 'veritas');
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec node ${JSON.stringify(join(frameworkRootDir, 'bin/veritas.mjs'))} "$@"\n`,
    'utf8',
  );
  chmodSync(wrapperPath, 0o755);
}
