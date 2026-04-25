import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyCiSnippet,
  applyCodexHook,
  applyGovernanceBlocks,
  applyGitHook,
  inspectRuntimeAdapterStatus,
  applyRuntimeHook,
  applyStopHook,
  applyPackageScripts,
  buildFeedbackSummary,
  buildEvidenceRecord,
  buildEvalDraft,
  buildEvalRecord,
  buildGovernanceBlock,
  buildSuggestedCodexHookConfig,
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
  buildSuggestedCiSnippet,
  buildSuggestedPackageScripts,
  compareMarkerBenchmarkRuns,
  classifyNodes,
  evaluatePolicyPack,
  generateEvalRecord,
  generateEvalSummary,
  generateMarkerBenchmarkComparison,
  generateMarkerBenchmarkSuiteReport,
  inferBootstrapRepoInsights,
  listWorkingTreeFiles,
  loadJson,
  loadPolicyPack,
  parseTokens,
  resolveProofCommands,
  resolveReportInputs,
  resolveWorkstream,
  writeBootstrapStarterKit,
} from '../src/index.mjs';
import {
  frameworkRootDir,
  initCommittedRepo,
  installLocalVeritasBin,
  commitAll,
  mkdirp,
  parseCliJson,
  readJson,
  readJsonFromAbsolute,
  writeTempAdapter,
  writeTempJson,
} from './helpers.mjs';

test('loadJson adds artifact context to malformed JSON errors', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-load-json-'));
  const malformedPath = join(rootDir, 'broken-team-profile.json');
  writeFileSync(malformedPath, '{invalid json}\n');

  assert.throws(
    () => loadJson(malformedPath, 'team profile'),
    /Failed to load team profile at .*broken-team-profile\.json:/,
  );
});

test('parseTokens supports the shared CLI token types', () => {
  const { options, rest } = parseTokens(
    [
      '--root',
      '/tmp/demo',
      '--force',
      '--time-to-green-minutes',
      '7',
      '--accepted-without-major-rewrite',
      'false',
      '--missed-issue',
      'first',
      '--missed-issue',
      'second',
      'leftover.txt',
    ],
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--force': { type: 'flag', key: 'force' },
      '--time-to-green-minutes': { type: 'number', key: 'timeToGreenMinutes' },
      '--accepted-without-major-rewrite': {
        type: 'boolean-string',
        key: 'acceptedWithoutMajorRewrite',
      },
      '--missed-issue': { type: 'array', key: 'missedIssues' },
    },
    {
      defaults: {
        missedIssues: [],
      },
    },
  );

  assert.deepEqual(options, {
    rootDir: '/tmp/demo',
    force: true,
    timeToGreenMinutes: 7,
    acceptedWithoutMajorRewrite: false,
    missedIssues: ['first', 'second'],
  });
  assert.deepEqual(rest, ['leftover.txt']);
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

test('policy pack evaluates governance blocks and diff-required rules', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-policy-rules-'));
  writeFileSync(join(rootDir, 'AGENTS.md'), `# Agents\n\n${buildGovernanceBlock()}\n`);
  writeFileSync(join(rootDir, 'CLAUDE.md'), '# Claude\n');

  const policyPack = {
    version: 1,
    name: 'policy-rule-demo',
    rules: [
      {
        id: 'ai-instruction-files-synced',
        classification: 'hard-invariant',
        stage: 'warn',
        message: 'Instruction files must include the Veritas block.',
        match: {
          'governance-block': ['AGENTS.md', 'CLAUDE.md'],
        },
      },
      {
        id: 'api-changes-require-test-changes',
        classification: 'promotable-policy',
        stage: 'block',
        message: 'API changes require API tests.',
        match: {
          'if-changed': 'src/api/',
          'then-require': 'tests/api/',
        },
      },
    ],
  };

  const failedResults = evaluatePolicyPack(policyPack, {
    rootDir,
    changedFiles: ['src/api/routes.ts'],
  });
  assert.equal(failedResults[0].implemented, true);
  assert.equal(failedResults[0].passed, false);
  assert.equal(failedResults[0].findings[0].artifact, 'CLAUDE.md');
  assert.equal(failedResults[1].passed, false);
  assert.equal(failedResults[1].findings[0].required, 'tests/api/');

  writeFileSync(join(rootDir, 'CLAUDE.md'), `${buildGovernanceBlock()}\n`);
  const passedResults = evaluatePolicyPack(policyPack, {
    rootDir,
    changedFiles: ['src/api/routes.ts', 'tests/api/routes.test.ts'],
  });
  assert.equal(passedResults[0].passed, true);
  assert.equal(passedResults[1].passed, true);
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

  const parsed = parseCliJson(stdout);
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
  assert.match(mainHelp, /veritas eval marker/);
  assert.match(mainHelp, /veritas eval marker-suite/);

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

  const evalHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'eval', 'marker', '--help'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  assert.match(evalHelp, /veritas eval marker/);
  assert.match(evalHelp, /--without-veritas-transcript <path>/);

  const evalSuiteHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'eval', 'marker-suite', '--help'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  assert.match(evalSuiteHelp, /veritas eval marker-suite/);
  assert.match(evalSuiteHelp, /--suite <path>/);

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
  const initResult = parseCliJson(initStdout);
  assert.equal(initResult.projectName, 'Demo Starter');
  assert.equal(initResult.proofLane, 'npm run test:smoke');
  assert.match(initResult.codeownersBlock, /\.veritas\/repo\.adapter\.json  @your-team\/governance/);
  assert.ok(
    initResult.generatedFiles.includes('.veritas/repo.adapter.json'),
  );
  assert.ok(
    initResult.generatedFiles.includes('.veritas/GOVERNANCE.md'),
  );

  const starterAdapter = readJsonFromAbsolute(
    join(rootDir, '.veritas/repo.adapter.json'),
  );
  const governanceInstructions = readFileSync(
    join(rootDir, '.veritas/GOVERNANCE.md'),
    'utf8',
  );
  const starterPolicyPack = readJsonFromAbsolute(
    join(rootDir, '.veritas/policy-packs/default.policy-pack.json'),
  );
  const starterTeamProfile = readJsonFromAbsolute(
    join(rootDir, '.veritas/team/default.team-profile.json'),
  );

  assert.equal(starterAdapter.name, 'demo-starter');
  assert.equal(starterAdapter.graph.nodes[0]['governance-locked'], true);
  assert.deepEqual(starterAdapter.activation.aiInstructionFiles.slice(0, 2), [
    { path: 'AGENTS.md', tool: 'codex', required: true },
    { path: 'CLAUDE.md', tool: 'claude-code', required: true },
  ]);
  assert.equal(starterPolicyPack.name, 'demo-starter-default');
  assert.ok(
    starterPolicyPack.rules.some((rule) => rule.match?.['governance-block']),
  );
  assert.equal(starterTeamProfile.defaults.mode, 'shadow');
  assert.equal(initResult.repoInsights.repoKind, 'application');
  assert.equal(starterAdapter.evidence.defaultProofLanes, undefined);
  assert.equal(starterAdapter.evidence.uncoveredPathPolicy, undefined);
  assert.match(governanceInstructions, /Do not modify:/);
  assert.match(governanceInstructions, /\.veritas\/policy-packs\//);
  assert.match(governanceInstructions, /Zone 2 is additive policy growth/);
  assert.match(governanceInstructions, /Zone 3 is generated output/);
  assert.match(readFileSync(join(rootDir, 'AGENTS.md'), 'utf8'), /veritas:governance-block:start/);
  assert.match(readFileSync(join(rootDir, 'CLAUDE.md'), 'utf8'), /veritas:governance-block:start/);

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
  assert.equal(record.governance.surface_touched, true);
  assert.equal(record.governance.classification, 'unknown');
  assert.equal(record.governance.human_review_required, false);
  assert.deepEqual(record.governance.changed_paths, []);
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
  assert.equal(draft.governance.surface_touched, true);
  assert.equal(draft.governance.classification, 'unknown');
  assert.equal(draft.governance.human_review_required, false);
  assert.deepEqual(draft.governance.changed_paths, []);
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
  const parsed = parseCliJson(stdout);

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
  const parsed = parseCliJson(stdout);

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
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.source_kind, 'branch-diff');
  assert.deepEqual(parsed.source_scope, ['changed-from:HEAD~1', 'changed-to:HEAD']);
  assert.deepEqual(parsed.files, [
    '.veritas/GOVERNANCE.md',
    '.veritas/README.md',
    '.veritas/policy-packs/default.policy-pack.json',
    '.veritas/repo.adapter.json',
    '.veritas/team/default.team-profile.json',
    'AGENTS.md',
    'CLAUDE.md',
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

test('eval draft CLI rejects symlinked external evidence under a repo-local path', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-eval-draft-symlink-evidence-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Eval Draft Symlink Evidence Demo' });

  const externalEvidencePath = join(tmpdir(), 'external-symlink-evidence.json');
  writeFileSync(
    externalEvidencePath,
    JSON.stringify(readJson('../examples/evidence/work-agent-pass.json'), null, 2),
  );
  mkdirp(join(rootDir, '.veritas/evidence'));
  symlinkSync(
    externalEvidencePath,
    join(rootDir, '.veritas/evidence/symlinked-evidence.json'),
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
          'draft',
          '--root',
          rootDir,
          '--evidence',
          '.veritas/evidence/symlinked-evidence.json',
        ],
        { cwd: frameworkRootDir, encoding: 'utf8' },
      ),
    /repo-local evidence artifact inside \.veritas\/evidence/,
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
  assert.equal(evalResult.historyPath, '.veritas/evals/history.jsonl');
  const historyLine = JSON.parse(
    readFileSync(join(rootDir, '.veritas/evals/history.jsonl'), 'utf8').trim(),
  );
  assert.equal(historyLine.run_id, 'eval-cli-explicit-smoke');
  assert.equal(historyLine.accepted, false);
  assert.equal(historyLine.override_count, 2);

  const summary = generateEvalSummary({ rootDir });
  assert.equal(summary.total, 1);
  assert.equal(summary.requiredRewrite, 1);
  assert.equal(summary.mostFlaggedRule.rule_id, 'required-veritas-artifacts');
  assert.match(summary.markdownSummary, /Last 1 evals: 0 accepted, 1 required rewrite/);
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
    ['exec', '--', 'veritas', 'shadow', 'run', '--format', 'json', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.mode, 'report-and-draft');
  assert.equal(parsed.proofRan, true);
  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
  assert.match(parsed.suggestedEvalCommand, /veritas eval record --draft/);
});

test('shadow run CLI defaults to agent-readable feedback output', () => {
  const rootDir = initCommittedRepo('veritas-shadow-run-feedback-');
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
      'Shadow Run Feedback Demo',
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

  assert.match(stdout, /^veritas: /);
  assert.match(stdout, /PASS\s+proof-command/);
  assert.match(stdout, /report: \.veritas\/evidence\//);
  assert.match(stdout, /eval draft: \.veritas\/eval-drafts\//);
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
      '--format',
      'json',
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
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.mode, 'report-draft-and-eval');
  assert.equal(parsed.evalMode, 'shadow');
  assert.equal(parsed.proofRan, true);
  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
});

test('shadow run JSON mode reports proof failures as run failures', () => {
  const rootDir = initCommittedRepo('veritas-shadow-run-json-proof-failure-');
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
      'Shadow Run JSON Proof Failure Demo',
      '--proof-lane',
      'node -e "process.exit(3)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        ['exec', '--', 'veritas', 'shadow', 'run', '--format', 'json', '--root', rootDir],
        { cwd: frameworkRootDir, encoding: 'utf8' },
      ),
    (error) => {
      assert.equal(error.status, 1);
      const parsed = parseCliJson(error.stdout.toString());
      assert.equal(parsed.proofFailure.command, 'node -e "process.exit(3)"');
      assert.equal(parsed.proofRan, true);
      return true;
    },
  );
});

test('marker benchmark comparison scores timely surfacing and false positives', () => {
  const scenario = {
    version: 1,
    id: 'migration-marker',
    title: 'Migration marker surfaces on the first relevant response',
    marker: {
      id: 'must-mention-data-migration',
      required_phrases: ['data migration', 'run a migration'],
    },
    scoring: {
      trigger_tag: 'marker-trigger',
      response_tag: 'marker-response-window',
      max_assistant_turns_after_trigger: 1,
      allow_early: false,
    },
  };

  const comparison = compareMarkerBenchmarkRuns({
    scenario,
    withoutVeritas: {
      version: 1,
      benchmark_id: 'migration-marker',
      run_id: 'without-veritas-run',
      condition_id: 'without-veritas',
      turns: [
        { role: 'user', content: 'Open the repo and inspect the task.' },
        { role: 'assistant', content: 'A data migration is probably required here.' },
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        {
          role: 'assistant',
          content: 'I will update the code path first.',
          tags: ['marker-response-window'],
        },
        { role: 'assistant', content: 'Also, run a migration before shipping this.' },
      ],
    },
    withVeritas: {
      version: 1,
      benchmark_id: 'migration-marker',
      run_id: 'with-veritas-run',
      condition_id: 'with-veritas',
      turns: [
        { role: 'user', content: 'Open the repo and inspect the task.' },
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        {
          role: 'assistant',
          content: 'This change needs a data migration before the code lands.',
          tags: ['marker-response-window'],
        },
      ],
    },
  });

  assert.equal(comparison.conditions.without_veritas.pass, false);
  assert.equal(comparison.conditions.without_veritas.false_positive, true);
  assert.equal(comparison.conditions.without_veritas.timely, false);
  assert.equal(comparison.conditions.with_veritas.pass, true);
  assert.equal(comparison.conditions.with_veritas.timely, true);
  assert.equal(comparison.conditions.with_veritas.assistant_turn_latency, 1);
  assert.equal(comparison.comparison.timely_recall_delta, 1);
  assert.equal(comparison.comparison.false_positive_improvement, 1);
  assert.equal(comparison.comparison.treatment_beats_baseline, true);
});

test('marker benchmark response tags do not widen the assistant-turn deadline', () => {
  const result = compareMarkerBenchmarkRuns({
    scenario: {
      version: 1,
      id: 'strict-response-window',
      title: 'Response tag stays stricter than the assistant-turn deadline',
      marker: {
        id: 'must-mention-data-migration',
        required_phrases: ['data migration'],
      },
      scoring: {
        trigger_tag: 'marker-trigger',
        response_tag: 'marker-response-window',
        max_assistant_turns_after_trigger: 1,
        allow_early: false,
      },
    },
    withoutVeritas: {
      version: 1,
      benchmark_id: 'strict-response-window',
      run_id: 'baseline',
      condition_id: 'without-veritas',
      turns: [
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        { role: 'assistant', content: 'Investigating.' },
        { role: 'assistant', content: 'Still checking.' },
        { role: 'assistant', content: 'This needs a data migration.' },
        {
          role: 'assistant',
          content: 'Final tagged response window.',
          tags: ['marker-response-window'],
        },
      ],
    },
    withVeritas: {
      version: 1,
      benchmark_id: 'strict-response-window',
      run_id: 'treatment',
      condition_id: 'with-veritas',
      turns: [
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        {
          role: 'assistant',
          content: 'This needs a data migration.',
          tags: ['marker-response-window'],
        },
      ],
    },
  });

  assert.equal(result.conditions.without_veritas.assistant_turn_latency, 3);
  assert.equal(result.conditions.without_veritas.first_response_window_turn, 5);
  assert.equal(result.conditions.without_veritas.timely, false);
  assert.equal(result.conditions.without_veritas.pass, false);
  assert.equal(result.conditions.with_veritas.timely, true);
});

test('marker benchmark comparison treats latency-only wins as improvement', () => {
  const result = compareMarkerBenchmarkRuns({
    scenario: {
      version: 1,
      id: 'latency-marker',
      title: 'Latency-only improvement still counts as improvement',
      marker: {
        id: 'must-mention-regression-test',
        required_phrases: ['regression test'],
      },
      scoring: {
        trigger_tag: 'marker-trigger',
        max_assistant_turns_after_trigger: 2,
        allow_early: false,
      },
    },
    withoutVeritas: {
      version: 1,
      benchmark_id: 'latency-marker',
      run_id: 'baseline-latency',
      condition_id: 'without-veritas',
      turns: [
        { role: 'tool', content: 'tests/api.spec.ts changed', tags: ['marker-trigger'] },
        { role: 'assistant', content: 'Investigating.' },
        { role: 'assistant', content: 'Add a regression test.' },
      ],
    },
    withVeritas: {
      version: 1,
      benchmark_id: 'latency-marker',
      run_id: 'treatment-latency',
      condition_id: 'with-veritas',
      turns: [
        { role: 'tool', content: 'tests/api.spec.ts changed', tags: ['marker-trigger'] },
        { role: 'assistant', content: 'Add a regression test.' },
      ],
    },
  });

  assert.equal(result.conditions.without_veritas.pass, true);
  assert.equal(result.conditions.with_veritas.pass, true);
  assert.equal(result.comparison.latency_improvement_turns, 1);
  assert.equal(result.comparison.treatment_beats_baseline, true);
});

test('eval marker CLI compares without-veritas and with-veritas transcripts', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-marker-benchmark-'));
  const scenarioPath = writeTempJson(rootDir, 'scenario.json', {
    version: 1,
    id: 'migration-marker',
    title: 'Migration marker surfaces on the first relevant response',
    marker: {
      id: 'must-mention-data-migration',
      required_phrases: ['data migration', 'run a migration'],
    },
    scoring: {
      trigger_tag: 'marker-trigger',
      response_tag: 'marker-response-window',
      max_assistant_turns_after_trigger: 1,
      allow_early: false,
    },
  });
  const withoutPath = writeTempJson(rootDir, 'without.json', {
    version: 1,
    benchmark_id: 'migration-marker',
    run_id: 'without-run',
    condition_id: 'without-veritas',
    turns: [
      { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
      {
        role: 'assistant',
        content: 'I will patch the code first.',
        tags: ['marker-response-window'],
      },
    ],
  });
  const withPath = writeTempJson(rootDir, 'with.json', {
    version: 1,
    benchmark_id: 'migration-marker',
    run_id: 'with-run',
    condition_id: 'with-veritas',
    turns: [
      { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
      {
        role: 'assistant',
        content: 'This change needs a data migration before release.',
        tags: ['marker-response-window'],
      },
    ],
  });

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'eval',
      'marker',
      '--scenario',
      scenarioPath,
      '--without-veritas-transcript',
      withoutPath,
      '--with-veritas-transcript',
      withPath,
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.benchmark_id, 'migration-marker');
  assert.equal(parsed.conditions.without_veritas.pass, false);
  assert.equal(parsed.conditions.with_veritas.pass, true);
  assert.equal(parsed.comparison.timely_recall_delta, 1);

  const helperResult = generateMarkerBenchmarkComparison({
    scenarioPath,
    withoutVeritasTranscriptPath: withoutPath,
    withVeritasTranscriptPath: withPath,
  });
  assert.equal(helperResult.comparison.treatment_beats_baseline, true);
});

test('eval marker-suite CLI returns aggregate benchmark metrics', () => {
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'eval', 'marker-suite', '--suite', 'examples/benchmarks/marker-suite.json'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.suite_id, 'context-surfacing-suite');
  assert.equal(parsed.scenario_count, 6);
  assert.equal(parsed.pair_count, 8);
  assert.equal(parsed.metrics.treatment_pass_rate, 7 / 8);
  assert.equal(parsed.metrics.pass_at_1, 1);
  assert.equal(parsed.metrics.pass_pow_k, 5 / 6);

  const helperResult = generateMarkerBenchmarkSuiteReport({
    suitePath: 'examples/benchmarks/marker-suite.json',
  });
  assert.equal(helperResult.metrics.improvement_rate, 7 / 8);
});

test('marker benchmark comparison rejects mismatched benchmark ids and condition ids', () => {
  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          version: 1,
          id: 'migration-marker',
          title: 'Migration marker surfaces on the first relevant response',
          marker: {
            id: 'must-mention-data-migration',
            required_phrases: ['data migration'],
          },
          scoring: {
            trigger_tag: 'marker-trigger',
            response_tag: 'marker-response-window',
            max_assistant_turns_after_trigger: 1,
            allow_early: false,
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'wrong-benchmark',
          run_id: 'without-run',
          condition_id: 'baseline',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
          ],
        },
        withVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'with-run',
          condition_id: 'with-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
          ],
        },
      }),
    /benchmark_id must match scenario id|condition_id must be without-veritas/,
  );
});

test('marker benchmark comparison rejects malformed scenarios and transcripts', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-marker-invalid-'));
  const baseScenario = {
    version: 1,
    id: 'migration-marker',
    title: 'Migration marker surfaces on the first relevant response',
    marker: {
      id: 'must-mention-data-migration',
      required_phrases: ['data migration'],
    },
    scoring: {
      trigger_tag: 'marker-trigger',
      response_tag: 'marker-response-window',
      max_assistant_turns_after_trigger: 1,
      allow_early: false,
    },
  };
  const validWithVeritas = {
    version: 1,
    benchmark_id: 'migration-marker',
    run_id: 'with-run',
    condition_id: 'with-veritas',
    turns: [
      { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
      {
        role: 'assistant',
        content: 'This needs a data migration.',
        tags: ['marker-response-window'],
      },
    ],
  };

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: { ...baseScenario, scoring: {} },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            { role: 'assistant', content: 'This needs a data migration.' },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /scoring is missing required key: trigger_tag/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            { role: 'assistant', content: 'This needs a data migration.' },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one response tag marker-response-window/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            { role: 'tool', content: 'another trigger', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one trigger tag marker-trigger/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'First tagged response.',
              tags: ['marker-response-window'],
            },
            {
              role: 'assistant',
              content: 'Second tagged response.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one response tag marker-response-window/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          scoring: {
            ...baseScenario.scoring,
            extra_rule: 'not-allowed',
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            {
              role: 'tool',
              content: 'db/schema.prisma changed',
              tags: ['marker-trigger'],
              extra_field: true,
            },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /contains unsupported key: extra_rule|contains unsupported key: extra_field/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          scoring: {
            ...baseScenario.scoring,
            response_tag: 'marker-trigger',
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-trigger'],
            },
          ],
        },
        withVeritas: {
          ...validWithVeritas,
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-trigger'],
            },
          ],
        },
      }),
    /response_tag must differ from scoring.trigger_tag/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            {
              role: 'tool',
              content: 'db/schema.prisma changed',
              tags: ['marker-trigger', 'marker-response-window'],
            },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one response tag marker-response-window/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'shared-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: {
          ...validWithVeritas,
          run_id: 'shared-run',
        },
      }),
    /requires distinct run_id values/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          version: '1',
          marker: {
            ...baseScenario.marker,
            id: 7,
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /scenario version must be an integer|marker\.id must be a non-empty string/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            {
              role: 'tool',
              content: 'db/schema.prisma changed',
              tags: ['marker-trigger', 5],
            },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /transcript turn tag must be a non-empty string/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          marker: null,
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /marker benchmark scenario marker must be an object/,
  );

  assert.throws(
    () =>
      generateMarkerBenchmarkSuiteReport({
        rootDir: rootDir,
        suitePath: writeTempJson(rootDir, 'bad-suite.json', {
          version: 1,
          id: 'bad-suite',
          title: 'Bad Suite',
          benchmarks: [null],
        }),
      }),
    /marker benchmark suite benchmark must be an object/,
  );

  assert.throws(
    () =>
      generateMarkerBenchmarkSuiteReport({
        rootDir,
        suitePath: writeTempJson(rootDir, 'duplicate-benchmark-suite.json', {
          version: 1,
          id: 'duplicate-benchmark-suite',
          title: 'Duplicate Benchmark Suite',
          benchmarks: [
            {
              benchmark_id: 'dup-benchmark',
              title: 'Dup Benchmark A',
              marker_class: 'class-a',
              repo_surface: 'src/a.ts',
              scenario_path: 'scenario-a.json',
              trials: [
                {
                  trial_id: 'dup-trial-a',
                  without_veritas_transcript_path: 'without-a.json',
                  with_veritas_transcript_path: 'with-a.json',
                },
              ],
            },
            {
              benchmark_id: 'dup-benchmark',
              title: 'Dup Benchmark B',
              marker_class: 'class-b',
              repo_surface: 'src/b.ts',
              scenario_path: 'scenario-b.json',
              trials: [
                {
                  trial_id: 'dup-trial-b',
                  without_veritas_transcript_path: 'without-b.json',
                  with_veritas_transcript_path: 'with-b.json',
                },
              ],
            },
          ],
        }),
      }),
    /benchmark_id must be unique: dup-benchmark/,
  );

  assert.throws(
    () =>
      generateMarkerBenchmarkSuiteReport({
        rootDir,
        suitePath: writeTempJson(rootDir, 'duplicate-trial-suite.json', {
          version: 1,
          id: 'duplicate-trial-suite',
          title: 'Duplicate Trial Suite',
          benchmarks: [
            {
              benchmark_id: 'benchmark-a',
              title: 'Benchmark A',
              marker_class: 'class-a',
              repo_surface: 'src/a.ts',
              scenario_path: 'scenario-a.json',
              trials: [
                {
                  trial_id: 'dup-trial',
                  without_veritas_transcript_path: 'without-a.json',
                  with_veritas_transcript_path: 'with-a.json',
                },
              ],
            },
            {
              benchmark_id: 'benchmark-b',
              title: 'Benchmark B',
              marker_class: 'class-b',
              repo_surface: 'src/b.ts',
              scenario_path: 'scenario-b.json',
              trials: [
                {
                  trial_id: 'dup-trial',
                  without_veritas_transcript_path: 'without-b.json',
                  with_veritas_transcript_path: 'with-b.json',
                },
              ],
            },
          ],
        }),
      }),
    /trial_id must be unique: dup-trial/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [null],
        },
        withVeritas: validWithVeritas,
      }),
    /without-veritas transcript turn must be an object/,
  );
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
    ['exec', '--', 'veritas', 'shadow', 'run', '--format', 'json', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.deepEqual(parsed.proofCommands, ['node -e "process.exit(0)"']);
  assert.equal(parsed.proofResolutionSource, 'legacy');
});

test('shadow run CLI treats shell metacharacters as literal proof-command arguments', () => {
  const rootDir = initCommittedRepo('veritas-shadow-run-literal-metachars-');
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
      'Shadow Run Literal Metachars Demo',
      '--proof-lane',
      'node -e "process.exit(0)"',
    ],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );

  const adapterPath = join(rootDir, '.veritas/repo.adapter.json');
  const adapter = readJsonFromAbsolute(adapterPath);
  adapter.evidence.requiredProofLanes = [
    `node -e "const { writeFileSync } = require('node:fs'); console.log('proof stdout'); writeFileSync('proof-output.txt', 'ok');" && node -e "require('node:fs').writeFileSync('proof-injected.txt', 'bad')"`,
  ];
  writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`, 'utf8');

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'shadow', 'run', '--format', 'json', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.match(stdout, /proof stdout/);
  assert.equal(readFileSync(join(rootDir, 'proof-output.txt'), 'utf8'), 'ok');
  assert.equal(existsSync(join(rootDir, 'proof-injected.txt')), false);
  assert.deepEqual(parsed.proofCommands, [adapter.evidence.requiredProofLanes[0]]);
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
  const parsed = parseCliJson(stdout);

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
    parsed.scripts['lint:governance'],
    'npm exec -- veritas shadow run --format feedback --working-tree',
  );
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
  const parsed = parseCliJson(stdout);
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
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.hook, 'post-commit');
  assert.equal(parsed.suggestedHooksPath, '.githooks');
  assert.match(parsed.hookBody, /VERITAS_HOOK_SKIP/);
});

test('print runtime-hook returns a tracked agent-runtime adapter', () => {
  const hookBody = buildSuggestedRuntimeHook();
  assert.match(hookBody, /^#!\/bin\/sh/m);
  assert.match(hookBody, /veritas shadow run --format json --working-tree/);

  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-runtime-hook-'));
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'runtime-hook', '--root', rootDir],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.outputPath, '.veritas/hooks/agent-runtime.sh');
  assert.equal(parsed.defaultInvocation, '.veritas/hooks/agent-runtime.sh');
  assert.match(parsed.hookBody, /VERITAS_HOOK_SKIP/);
});

test('print stop-hook returns generic and tool-specific stop hook suggestions', () => {
  const genericHook = buildSuggestedStopHook({ tool: 'generic' });
  assert.equal(genericHook.outputPath, '.veritas/hooks/stop.sh');
  assert.match(genericHook.hookBody, /veritas shadow run --format feedback --working-tree/);

  const claudeHook = buildSuggestedStopHook({ tool: 'claude-code' });
  assert.equal(claudeHook.toolConfigPath, '.claude/settings.json');
  assert.equal(claudeHook.toolConfig.hooks.Stop[0].hooks[0].command, '.veritas/hooks/stop.sh');

  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-stop-hook-'));
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'stop-hook', '--root', rootDir, '--tool', 'cursor'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);
  assert.equal(parsed.tool, 'cursor');
  assert.equal(parsed.toolConfigPath, '.cursor/hooks.json');
});

test('print and apply governance-blocks use marker-bounded updates', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-governance-blocks-'));
  mkdirp(join(rootDir, '.veritas'));
  writeFileSync(
    join(rootDir, '.veritas/repo.adapter.json'),
    JSON.stringify(
      {
        activation: {
          aiInstructionFiles: [
            { path: 'AGENTS.md', tool: 'codex', required: true },
            { path: 'CLAUDE.md', tool: 'claude-code', required: true },
            { path: '.cursorrules', tool: 'cursor', required: false },
          ],
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Existing\n');

  const blockStdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'print', 'governance-block'],
    { cwd: frameworkRootDir, encoding: 'utf8' },
  );
  assert.match(blockStdout, /veritas:governance-block:start/);

  const result = applyGovernanceBlocks({ rootDir });
  assert.deepEqual(
    result.applied.map((item) => item.path).sort(),
    ['AGENTS.md', 'CLAUDE.md'],
  );
  assert.equal(result.skipped[0].path, '.cursorrules');
  assert.match(readFileSync(join(rootDir, 'AGENTS.md'), 'utf8'), /^# Existing/);
  assert.match(readFileSync(join(rootDir, 'AGENTS.md'), 'utf8'), /veritas:governance-block:start/);

  const second = applyGovernanceBlocks({ rootDir });
  assert.equal(
    readFileSync(join(rootDir, 'AGENTS.md'), 'utf8').match(/veritas:governance-block:start/g).length,
    1,
  );
  assert.equal(second.applied.length, 2);
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
  const parsed = parseCliJson(stdout);

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
  const parsed = parseCliJson(stdout);

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
  const parsed = parseCliJson(stdout);

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
  const parsed = parseCliJson(stdout);
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
  assert.match(contents, /veritas shadow run --format json --working-tree/);
});

test('apply stop-hook writes the generic script and requested tool config', () => {
  const rootDir = initCommittedRepo('veritas-apply-stop-hook-');
  mkdirp(join(rootDir, '.cursor'));
  writeFileSync(
    join(rootDir, '.cursor/hooks.json'),
    JSON.stringify(
      {
        hooks: {
          stop: [{ command: 'echo keep-me' }],
        },
      },
      null,
      2,
    ),
  );
  const result = applyStopHook({
    rootDir,
    tool: 'cursor',
  });
  const contents = readFileSync(join(rootDir, '.veritas/hooks/stop.sh'), 'utf8');
  const cursorConfig = readJsonFromAbsolute(join(rootDir, '.cursor/hooks.json'));

  assert.equal(result.outputPath, '.veritas/hooks/stop.sh');
  assert.equal(result.tool, 'cursor');
  assert.equal(result.configuredToolConfigPath, '.cursor/hooks.json');
  assert.match(contents, /veritas shadow run --format feedback --working-tree/);
  assert.equal(cursorConfig.hooks.stop[0].command, 'echo keep-me');
  assert.equal(cursorConfig.hooks.stop[1].command, '.veritas/hooks/stop.sh');
});

test('apply stop-hook preserves existing Claude stop hooks while deduping Veritas', () => {
  const rootDir = initCommittedRepo('veritas-apply-claude-stop-hook-');
  mkdirp(join(rootDir, '.claude'));
  writeFileSync(
    join(rootDir, '.claude/settings.json'),
    JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              matcher: 'existing',
              hooks: [{ type: 'command', command: 'echo keep-me' }],
            },
            {
              matcher: '.*',
              hooks: [{ type: 'command', command: '.veritas/hooks/stop.sh' }],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  applyStopHook({ rootDir, tool: 'claude-code' });
  const claudeConfig = readJsonFromAbsolute(join(rootDir, '.claude/settings.json'));

  assert.equal(claudeConfig.hooks.Stop.length, 2);
  assert.equal(claudeConfig.hooks.Stop[0].hooks[0].command, 'echo keep-me');
  assert.equal(
    claudeConfig.hooks.Stop[1].hooks[0].command,
    '.veritas/hooks/stop.sh',
  );
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

test('apply runtime-hook rejects symlinked targets that escape the hook area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-runtime-hook-symlink-'));
  const externalDir = mkdtempSync(join(tmpdir(), 'veritas-external-hook-target-'));
  mkdirp(join(rootDir, '.veritas/hooks'));
  symlinkSync(externalDir, join(rootDir, '.veritas/hooks/external-link'));

  assert.throws(
    () =>
      applyRuntimeHook({
        rootDir,
        outputPath: '.veritas/hooks/external-link/agent-runtime.sh',
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

test('runtime status treats malformed codex hook JSON as not installed', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-malformed-codex-');
  writeFileSync(join(rootDir, 'tmp-hooks.json'), '{not json}\n');

  const status = inspectRuntimeAdapterStatus(rootDir, {
    targetHooksFile: 'tmp-hooks.json',
  });

  assert.equal(status.codexTarget.checked, true);
  assert.equal(status.codexTarget.targetExists, true);
  assert.equal(status.codexTarget.adapterInstalled, false);
});

test('runtime status rethrows codex hook target read errors that are not JSON parse failures', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-codex-read-error-');
  mkdirp(join(rootDir, 'tmp-hooks-dir'));

  assert.throws(
    () =>
      inspectRuntimeAdapterStatus(rootDir, {
        targetHooksFile: 'tmp-hooks-dir',
      }),
    /EISDIR|directory/,
  );
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

  assert.match(stdout, /^veritas: /);
  assert.match(stdout, /PASS\s+proof-command: node -e "process\.exit\(0\)"/);
  assert.match(stdout, /report: \.veritas\/evidence\//);
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

  assert.match(stdout, /^veritas: /);
  assert.match(stdout, /1 file changed/);
  assert.match(stdout, /PASS\s+proof-command: node -e "process\.exit\(0\)"/);
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
  const parsed = parseCliJson(stdout);

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
  const initResult = parseCliJson(initStdout);

  assert.equal(initResult.proofLane, 'npm run verify');
  assert.equal(initResult.repoInsights.repoKind, 'workspace');
  assert.equal(initResult.repoInsights.enableSurfaceProofRouting, true);
});

test('adaptive bootstrap falls back cleanly when git HEAD is detached', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-detached-head-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          verify: 'npm test',
        },
      },
      null,
      2,
    ),
  );
  execFileSync('git', ['init', '-b', 'feature'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Veritas Tests'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  execFileSync('git', ['config', 'user.email', 'veritas-tests@example.com'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  execFileSync('git', ['add', 'package.json'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['checkout', '--detach', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  const insights = inferBootstrapRepoInsights(rootDir);

  assert.equal(insights.baseRef, '<base-ref>');
  assert.equal(insights.proofLane, 'npm run verify');
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
    'lint:governance',
    'veritas:eval',
  ]);
});
