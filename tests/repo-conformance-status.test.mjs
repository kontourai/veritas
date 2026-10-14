import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createAttestation, evaluateRepoStandards, writeBootstrapStarterKit } from '../src/index.mjs';
import { dirname, join } from 'node:path';
import {
  classifyGovernanceSurface,
  renderGovernanceSurfaceLine,
  summarizeGovernanceTrend,
} from '../src/conformance/run.mjs';
import { cleanGitEnv, execGitFixture, commitAll, initCommittedRepo, mkdirp, repoRootDir } from './helpers.mjs';
import { listChangedFiles } from '../src/report/inputs.mjs';
import { tempDir } from './temp-dir.mjs';

function writeJsonFile(rootDir, relativePath, value) {
  const path = join(rootDir, relativePath);
  mkdirp(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createGovernanceRepo(t, prefix = 'veritas-conformance-governance-') {
  const rootDir = initCommittedRepo(t, prefix);
  mkdirp(join(rootDir, '.veritas/repo-standards'));
  mkdirp(join(rootDir, '.veritas/team'));
  writeJsonFile(rootDir, '.veritas/repo-map.json', {
    name: 'demo',
    graph: {
      version: 1,
    },
  });
  writeJsonFile(rootDir, '.veritas/repo-standards/default.repo-standards.json', {
    name: 'default',
    rules: [
      {
        id: 'keep-hooks',
      },
    ],
  });
  writeJsonFile(rootDir, '.veritas/authority/default.authority-settings.json', {
    name: 'default',
    reviewers: ['maintainer'],
  });
  commitAll(rootDir, 'Add governance fixtures');
  return rootDir;
}

test('Protected Standards is clean when no PR refs are supplied', () => {
  const result = classifyGovernanceSurface();

  assert.equal(result.classification, 'clean');
  assert.equal(result.evaluated, false);
  assert.equal(result.summary, 'clean (no PR base/head diff)');
  assert.equal(renderGovernanceSurfaceLine(result), '- **Governance surface:** `clean (no PR base/head diff)`');
});

test('Protected Standards treats added governance files as additive-only', (t) => {
  const rootDir = createGovernanceRepo(t, 'veritas-conformance-additive-');
  writeJsonFile(rootDir, '.veritas/authority/release.authority-settings.json', {
    name: 'release',
    reviewers: ['maintainer', 'ops'],
  });
  commitAll(rootDir, 'Add release authority settings');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'additive-only');
  assert.deepEqual(result.semantic_changed_paths, ['.veritas/authority/release.authority-settings.json']);
  assert.deepEqual(result.files, [
    {
      path: '.veritas/authority/release.authority-settings.json',
      status: 'added',
      additive: true,
      semantic_change: true,
    },
  ]);
  assert.equal(
    renderGovernanceSurfaceLine(result),
    '- **Governance surface:** `additive-only (.veritas/authority/release.authority-settings.json added)`',
  );
});

test('Protected Standards stays clean for semantic no-op formatting changes', (t) => {
  const rootDir = createGovernanceRepo(t, 'veritas-conformance-clean-');
  writeFileSync(
    join(rootDir, '.veritas/repo-map.json'),
    '{\n  "graph": {\n    "version": 1\n  },\n  "name": "demo"\n}\n',
    'utf8',
  );
  commitAll(rootDir, 'Reformat Repo Map');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'clean');
  assert.deepEqual(result.changed_paths, ['.veritas/repo-map.json']);
  assert.deepEqual(result.semantic_changed_paths, []);
  assert.equal(result.files[0].status, 'equivalent');
  assert.equal(result.summary, 'clean (no semantic governance changes)');
});

test('Protected Standards treats removals as protected standards modifications', (t) => {
  const rootDir = createGovernanceRepo(t, 'veritas-conformance-protected-standards-');
  unlinkSync(join(rootDir, '.veritas/authority/default.authority-settings.json'));
  commitAll(rootDir, 'Remove default authority settings');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'protected-standards-modification');
  assert.deepEqual(result.files, [
    {
      path: '.veritas/authority/default.authority-settings.json',
      status: 'removed',
      additive: false,
      semantic_change: true,
    },
  ]);
});

test('Protected Standards treats governance renames as protected standards modifications', (t) => {
  const rootDir = createGovernanceRepo(t, 'veritas-conformance-rename-');
  const originalPath = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const renamedPath = join(rootDir, '.veritas/authority/release.authority-settings.json');
  writeFileSync(
    renamedPath,
    readFileSync(originalPath, 'utf8'),
    'utf8',
  );
  unlinkSync(originalPath);
  commitAll(rootDir, 'Rename authority settings');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'protected-standards-modification');
  assert.deepEqual(result.semantic_changed_paths, [
    '.veritas/authority/default.authority-settings.json',
    '.veritas/authority/release.authority-settings.json',
  ]);
  assert.deepEqual(result.files, [
    {
      path: '.veritas/authority/default.authority-settings.json',
      status: 'removed',
      additive: false,
      semantic_change: true,
    },
    {
      path: '.veritas/authority/release.authority-settings.json',
      status: 'added',
      additive: true,
      semantic_change: true,
    },
  ]);
});

test('governance trend summary includes recent classification counts', (t) => {
  const rootDir = createGovernanceRepo(t, 'veritas-conformance-trend-');
  mkdirp(join(rootDir, '.kontourai/veritas/repo-conformance'));
  writeJsonFile(rootDir, '.kontourai/veritas/repo-conformance/older-clean.json', {
    run_id: 'older-clean',
    generated_at: '2026-04-20T00:00:00.000Z',
    governance_surface: {
      classification: 'clean',
    },
  });
  writeJsonFile(rootDir, '.kontourai/veritas/repo-conformance/older-protected-standards.json', {
    run_id: 'older-protected-standards',
    generated_at: '2026-04-21T00:00:00.000Z',
    governance_surface: {
      classification: 'protected-standards-modification',
    },
  });
  writeJsonFile(rootDir, '.veritas/authority/release.authority-settings.json', {
    name: 'release',
    reviewers: ['maintainer', 'ops'],
  });
  commitAll(rootDir, 'Add release authority settings');

  const trend = summarizeGovernanceTrend({
    rootDir,
    currentRunId: 'current-run',
    currentGovernanceSurface: {
      classification: 'additive-only',
    },
  });

  assert.equal(trend.clean, 1);
  assert.equal(trend.additive_only, 1);
  assert.equal(trend.protected_standards_modification, 1);
  assert.equal(
    trend.summary,
    'last 3 governance run(s): 1 clean, 1 additive-only, 1 protected-standards-modification',
  );
  assert.equal(trend.latest_non_clean_run_id, 'current-run');
  assert.equal(trend.latest_non_clean_classification, 'additive-only');
});

for (const scenario of [
  { name: 'protected rename with map swap', rename: true, swap: true, covered: true },
  { name: 'protected deletion with pattern removed', swap: true, covered: true },
  { name: 'unmapped base deletion remains red despite HEAD coverage', swap: true, headCoverage: true, covered: false },
  { name: 'pure protected rename with unchanged map', rename: true, covered: true },
]) {
  test(`conformance health: ${scenario.name}`, async (t) => {
    const rootDir = initCommittedRepo(t, 'veritas-removed-path-health-');
    writeBootstrapStarterKit({ rootDir, projectName: 'removed-path-fixture', force: true });
    for (const path of ['.githooks', '.veritas/hooks', '.veritas/runtime']) {
      cpSync(join(repoRootDir, path), join(rootDir, path), { recursive: true });
    }
    const mapPath = join(rootDir, '.veritas/repo-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    map.graph.nodes = [
      { id: 'governance.config', label: 'configuration', kind: 'protected-area', patterns: ['.veritas/', '.githooks/', '.gitignore'] },
      { id: 'governance.manifest', label: 'manifest', kind: 'protected-area', patterns: scenario.covered ? ['old-manifest.json', 'new-manifest.json'] : [] },
    ];
    map.evidence.requiredEvidenceCheckIds = [];
    map.evidence.uncoveredPathPolicy = 'warn';
    writeJsonFile(rootDir, '.veritas/repo-map.json', map);
    writeJsonFile(rootDir, '.veritas/repo-standards/default.repo-standards.json', { version: 1, name: 'removed-path-health', rules: [] });
    writeFileSync(join(rootDir, 'old-manifest.json'), '{"manifest":"protected"}\n');
    createAttestation({ rootDir, kind: 'bootstrap', actor: 'brian', approvalRef: 'test://approved-bootstrap', notes: 'Fixture bootstrap.' });
    commitAll(rootDir, 'Base protected manifest');
    if (scenario.rename) renameSync(join(rootDir, 'old-manifest.json'), join(rootDir, 'new-manifest.json'));
    else unlinkSync(join(rootDir, 'old-manifest.json'));
    if (scenario.swap) {
      map.graph.nodes[1].patterns = scenario.headCoverage ? ['old-manifest.json'] : scenario.rename ? ['new-manifest.json'] : [];
      writeJsonFile(rootDir, '.veritas/repo-map.json', map);
      createAttestation({ rootDir, kind: 'policy-change', actor: 'brian', approvalRef: 'test://approved-policy-change', notes: 'Fixture map update.' });
    }
    const scriptUrl = pathToFileURL(join(repoRootDir, 'scripts/repo-conformance-status.mjs')).href;
    for (const scope of ['working-tree', 'branch-diff']) {
      if (scope === 'branch-diff') commitAll(rootDir, 'Change manifest');
      await t.test(scope, () => {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
          import { runRepoConformanceStatus } from ${JSON.stringify(scriptUrl)};
          const result = await runRepoConformanceStatus({ rootDir: process.cwd(), changedFrom: ${scope === 'branch-diff' ? "'HEAD~1'" : 'undefined'}, changedTo: ${scope === 'branch-diff' ? "'HEAD'" : 'undefined'}, isCi: true, failOnAlerts: true });
          console.log(JSON.stringify({ health: result.healthStatus, report: result.report.record, draft: result.draft.record }));
        `], { cwd: rootDir, encoding: 'utf8', env: { ...cleanGitEnv(), CI: 'true' } });
        assert.equal(result.status, scenario.covered ? 0 : 1, result.stderr + result.stdout);
        const output = JSON.parse(result.stdout);
        assert.equal(output.health, scenario.covered ? 'green' : 'red');
        assert.deepEqual(output.report.unresolved_files, scenario.covered ? [] : ['old-manifest.json']);
        if (scenario.covered) {
          assert.ok(output.report.components.includes('governance.manifest'));
          assert.equal(output.report.file_nodes['old-manifest.json'][0].kind, 'protected-area');
          assert.equal(output.draft.governance.protected_standards_touched, true);
        }
      });
    }
  });
}

for (const scenario of [
  { name: 'protected file becomes symlink', protected: true, symlink: true, path: 'manifest.json' },
  { name: 'protected symlink becomes file', protected: true, symlink: false, path: 'manifest.json' },
  { name: 'protected non-ASCII path resolves', protected: true, path: 'café.json' },
  { name: 'unprotected type change', protected: false, symlink: true, path: 'ordinary.json' },
]) {
  test(`conformance visibility: ${scenario.name}`, async (t) => {
    const rootDir = initCommittedRepo(t, 'veritas-typechange-');
    writeBootstrapStarterKit({ rootDir, projectName: 'typechange-fixture', force: true });
    for (const path of ['.githooks', '.veritas/hooks', '.veritas/runtime']) {
      cpSync(join(repoRootDir, path), join(rootDir, path), { recursive: true });
    }
    const map = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-map.json'), 'utf8'));
    map.graph.nodes = [
      { id: 'governance.config', label: 'configuration', kind: 'protected-area', patterns: ['.veritas/', '.githooks/', '.gitignore'] },
      { id: scenario.protected ? 'governance.manifest' : 'fixture.target', label: 'target', kind: scenario.protected ? 'protected-area' : 'component', patterns: [scenario.path] },
    ];
    map.evidence.requiredEvidenceCheckIds = [];
    writeJsonFile(rootDir, '.veritas/repo-map.json', map);
    writeJsonFile(rootDir, '.veritas/repo-standards/default.repo-standards.json', { version: 1, name: 'typechange', rules: [] });
    // Keep the link target tracked and unchanged so only the named path changes.
    writeFileSync(join(rootDir, '.veritas/link-target.json'), '{}\n');
    if (scenario.symlink === false) symlinkSync('.veritas/link-target.json', join(rootDir, scenario.path));
    else writeFileSync(join(rootDir, scenario.path), '{}\n');
    createAttestation({ rootDir, kind: 'bootstrap', actor: 'brian', approvalRef: 'test://approved-bootstrap', notes: 'Fixture bootstrap.' });
    commitAll(rootDir, 'Base fixture');
    unlinkSync(join(rootDir, scenario.path));
    if (scenario.symlink === true) symlinkSync('.veritas/link-target.json', join(rootDir, scenario.path));
    else writeFileSync(join(rootDir, scenario.path), '{"changed":true}\n');
    const scriptUrl = pathToFileURL(join(repoRootDir, 'scripts/repo-conformance-status.mjs')).href;
    for (const scope of ['unstaged', 'staged', 'branch-diff']) {
      if (scope === 'staged') execGitFixture(['add', '--all'], { cwd: rootDir });
      if (scope === 'branch-diff') commitAll(rootDir, 'Change fixture');
      await t.test(scope, () => {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
          import { runRepoConformanceStatus } from ${JSON.stringify(scriptUrl)};
          const result = await runRepoConformanceStatus({ rootDir: process.cwd(), changedFrom: ${scope === 'branch-diff' ? "'HEAD~1'" : 'undefined'}, changedTo: ${scope === 'branch-diff' ? "'HEAD'" : 'undefined'}, isCi: true, failOnAlerts: true });
          console.log(JSON.stringify({ report: result.report.record, draft: result.draft.record }));
        `], { cwd: rootDir, encoding: 'utf8', env: { ...cleanGitEnv(), CI: 'true' } });
        assert.equal(result.status, 0, result.stderr + result.stdout);
        const output = JSON.parse(result.stdout);
        assert.deepEqual(output.report.unresolved_files, []);
        assert.deepEqual(Object.keys(output.report.file_nodes), [scenario.path]);
        assert.equal(output.report.file_nodes[scenario.path][0].kind, scenario.protected ? 'protected-area' : 'component');
        assert.ok(output.report.components.includes(scenario.protected ? 'governance.manifest' : 'fixture.target'));
        assert.equal(output.draft.governance.protected_standards_touched, scenario.protected);
      });
    }
  });
}

test('Protected Standards resolves non-ASCII governance paths', (t) => {
  const rootDir = createGovernanceRepo(t);
  writeJsonFile(rootDir, '.veritas/authority/café.json', { name: 'café' });
  commitAll(rootDir, 'Add non-ASCII authority');
  const result = classifyGovernanceSurface({ rootDir, changedFrom: 'HEAD~1', changedTo: 'HEAD' });
  assert.deepEqual(result.changed_paths, ['.veritas/authority/café.json']);
  assert.deepEqual(result.semantic_changed_paths, ['.veritas/authority/café.json']);
});

test('standing policy evaluates tracked non-ASCII paths', (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-unicode-policy-');
  writeFileSync(join(rootDir, 'café.json'), 'forbidden-content\n');
  commitAll(rootDir, 'Add policy target');
  const results = evaluateRepoStandards({ version: 1, name: 'unicode', rules: [{
    id: 'content', kind: 'forbidden-pattern', classification: 'hard-invariant',
    enforcementLevel: 'Require', message: 'Reject forbidden content.',
    match: { files: ['café.json'], pattern: 'forbidden-content' },
  }] }, { rootDir, changedFiles: [] });
  assert.equal(results[0].passed, false);
});

// ─── Conformance CI revision pair (#275) ──────────────────────────────────

const conformanceWorkflow = readFileSync(join(repoRootDir, '.github/workflows/veritas-conformance.yml'), 'utf8');
const PAIR_STEP = 'Pair The Pull Request Diff With The Checked-Out Merge Commit';
const REPORT_STEP = 'Generate Veritas Repo Conformance';

function workflowStep(name) {
  const start = conformanceWorkflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `the conformance workflow must keep the step "${name}"`);
  const rest = conformanceWorkflow.slice(start + 1);
  const next = rest.search(/\n {6}- name: /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function workflowStepScript(name) {
  const run = workflowStep(name).match(/\n {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1];
  assert.ok(run, `the "${name}" step must keep a multi-line run script`);
  return run.split('\n').map((line) => line.slice(10)).join('\n');
}

// Runs the workflow's own pairing script the way Actions does: bash, the step's
// PR_HEAD_SHA, and a GITHUB_ENV file whose lines later steps receive as env.
function runPairStep(t, rootDir, prHeadSha) {
  const envFile = join(tempDir(t, 'veritas-conformance-github-env-'), 'github-env');
  writeFileSync(envFile, '');
  const result = spawnSync('bash', ['-c', workflowStepScript(PAIR_STEP)], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...cleanGitEnv(), GITHUB_ENV: envFile, PR_HEAD_SHA: prHeadSha },
  });
  if (result.error) throw result.error;
  const env = Object.fromEntries(readFileSync(envFile, 'utf8').split('\n').filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, env };
}

function revParse(rootDir, ref) {
  return execGitFixture(['rev-parse', ref], { cwd: rootDir, encoding: 'utf8' }).trim();
}

// A pull request branched before the base branch changed the Repo Map, checked
// out the way actions/checkout does for pull_request: the merge commit, with
// the base tip as first parent and the PR head as second.
function createStalePullRequestCheckout(t) {
  const rootDir = createGovernanceRepo(t, 'veritas-conformance-stale-pr-');
  execGitFixture(['checkout', '-b', 'feature'], { cwd: rootDir, encoding: 'utf8' });
  writeFileSync(join(rootDir, 'feature.txt'), 'feature\n');
  commitAll(rootDir, 'Feature change');
  const headSha = revParse(rootDir, 'HEAD');
  execGitFixture(['checkout', 'main'], { cwd: rootDir, encoding: 'utf8' });
  writeJsonFile(rootDir, '.veritas/repo-map.json', { name: 'demo', graph: { version: 1 }, owner: 'platform' });
  commitAll(rootDir, 'Base-branch Repo Map change the feature branch never saw');
  const baseSha = revParse(rootDir, 'HEAD');
  execGitFixture(['merge', '--no-ff', '--no-edit', 'feature'], { cwd: rootDir, encoding: 'utf8' });
  const mergeSha = revParse(rootDir, 'HEAD');
  execGitFixture(['checkout', '--detach', mergeSha], { cwd: rootDir, encoding: 'utf8' });
  return { rootDir, baseSha, headSha, mergeSha };
}

test('conformance CI does not charge a stale pull request with base-branch progress (#275)', (t) => {
  const { rootDir, baseSha, headSha, mergeSha } = createStalePullRequestCheckout(t);

  // The fixture reproduces the bug: base.sha..head.sha reverses the base
  // branch's Repo Map change and reports it as this PR's protected change.
  assert.deepEqual(listChangedFiles(baseSha, headSha, rootDir), ['.veritas/repo-map.json', 'feature.txt']);
  assert.equal(
    classifyGovernanceSurface({ rootDir, changedFrom: baseSha, changedTo: headSha }).classification,
    'protected-standards-modification',
  );

  const step = runPairStep(t, rootDir, headSha);
  assert.equal(step.status, 0, step.stderr);
  assert.deepEqual(step.env, { VERITAS_CHANGED_FROM: baseSha, VERITAS_CHANGED_TO: mergeSha });
  // The pair ends at the commit the job evaluates, and its diff is only the PR's change.
  assert.equal(step.env.VERITAS_CHANGED_TO, revParse(rootDir, 'HEAD'));
  assert.deepEqual(listChangedFiles(step.env.VERITAS_CHANGED_FROM, step.env.VERITAS_CHANGED_TO, rootDir), ['feature.txt']);
  const surface = classifyGovernanceSurface({
    rootDir,
    changedFrom: step.env.VERITAS_CHANGED_FROM,
    changedTo: step.env.VERITAS_CHANGED_TO,
  });
  assert.equal(surface.classification, 'clean');
  assert.deepEqual(surface.semantic_changed_paths, []);
});

test('the conformance pairing step refuses a checkout that is not the merge of the pull request head', (t) => {
  const { rootDir, baseSha, headSha } = createStalePullRequestCheckout(t);

  const wrongHead = runPairStep(t, rootDir, baseSha);
  assert.notEqual(wrongHead.status, 0);
  assert.match(wrongHead.stdout, /refusing to diff one revision pair and evaluate another/);
  assert.deepEqual(wrongHead.env, {});

  execGitFixture(['checkout', '--detach', headSha], { cwd: rootDir, encoding: 'utf8' });
  const notAMerge = runPairStep(t, rootDir, headSha);
  assert.notEqual(notAMerge.status, 0);
  assert.match(notAMerge.stdout, /refusing to diff one revision pair and evaluate another/);
  assert.deepEqual(notAMerge.env, {});
});

test('the conformance report step takes its revision pair only from the pairing step', () => {
  // A step-level env on the report step would override what the pairing step
  // wrote to GITHUB_ENV, so the pair must not be set anywhere else.
  assert.doesNotMatch(workflowStep(REPORT_STEP), /VERITAS_CHANGED_(FROM|TO)/);
  assert.doesNotMatch(conformanceWorkflow, /pull_request\.base\.sha/);
  assert.match(workflowStep(PAIR_STEP), /\n {8}if: github\.event_name == 'pull_request'\n/);
  assert.ok(
    conformanceWorkflow.indexOf(`- name: ${PAIR_STEP}\n`) < conformanceWorkflow.indexOf(`- name: ${REPORT_STEP}\n`),
    'the pairing step must run before the report step',
  );
});
