import { markdownCode } from '../src/util/display.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAttestation, writeBootstrapStarterKit } from '../src/index.mjs';
import { cleanGitEnv, commitAll, execGitFixture, initCommittedRepo, mkdirp, repoRootDir } from './helpers.mjs';

function writeMap(rootDir, map) {
  writeFileSync(join(rootDir, '.veritas/repo-map.json'), `${JSON.stringify(map, null, 2)}\n`);
}

function fixture(t, { nested = false, baseMap } = {}) {
  const gitRoot = initCommittedRepo(t, 'veritas-removed-path-review-');
  const rootDir = nested ? join(gitRoot, 'pkg') : gitRoot;
  mkdirp(rootDir);
  writeBootstrapStarterKit({ rootDir, projectName: 'removed-path-review', force: true });
  for (const path of ['.githooks', '.veritas/hooks', '.veritas/runtime']) {
    cpSync(join(repoRootDir, path), join(rootDir, path), { recursive: true });
  }
  const map = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-map.json'), 'utf8'));
  map.graph.nodes = [
    { id: 'governance.config', label: 'configuration', kind: 'protected-area', patterns: ['.veritas/', '.githooks/', '.gitignore'] },
    { id: 'governance.manifest', label: 'manifest', kind: 'protected-area', patterns: ['old-manifest.json', 'Manifest.json'] },
  ];
  map.evidence.requiredEvidenceCheckIds = [];
  map.evidence.uncoveredPathPolicy = 'warn';
  writeMap(rootDir, map);
  writeFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), JSON.stringify({ version: 1, name: 'removed-path-review', rules: [] }));
  writeFileSync(join(rootDir, 'old-manifest.json'), '{"manifest":"protected"}\n');
  createAttestation({ rootDir, kind: 'bootstrap', actor: 'brian', approvalRef: 'test://approved-bootstrap', notes: 'Fixture bootstrap.' });
  if (nested) {
    mkdirp(join(gitRoot, '.veritas'));
    writeFileSync(join(gitRoot, '.veritas/repo-map.json'), JSON.stringify({ graph: { nodes: [
      { id: 'everything', label: 'everything', kind: 'work-area', patterns: ['**'] },
    ] } }));
  }
  if (baseMap === 'absent') unlinkSync(join(rootDir, '.veritas/repo-map.json'));
  else if (baseMap === 'malformed') writeFileSync(join(rootDir, '.veritas/repo-map.json'), '{invalid');
  else if (baseMap === 'no-graph') writeFileSync(join(rootDir, '.veritas/repo-map.json'), '{}');
  commitAll(gitRoot, 'Base manifest and maps');
  if (baseMap) writeMap(rootDir, map);
  return { rootDir, gitRoot, map };
}

function approveMap(rootDir) {
  createAttestation({ rootDir, kind: 'policy-change', actor: 'brian', approvalRef: 'test://approved-policy-change', notes: 'Fixture map update.' });
}

function health(rootDir, { changedFrom, changedTo, env = {} } = {}) {
  const scriptUrl = pathToFileURL(join(repoRootDir, 'scripts/repo-conformance-status.mjs')).href;
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runRepoConformanceStatus } from ${JSON.stringify(scriptUrl)};
    const result = await runRepoConformanceStatus({ rootDir: process.cwd(), changedFrom: ${JSON.stringify(changedFrom)}, changedTo: ${JSON.stringify(changedTo)}, isCi: true, failOnAlerts: true });
    console.log(JSON.stringify({ health: result.healthStatus, report: { files: result.report.record.files, unresolved_files: result.report.record.unresolved_files, file_nodes: result.report.record.file_nodes, recommendations: result.report.record.recommendations, policy_results: result.report.record.policy_results }, markdown: result.report.markdownSummary, governance: result.governanceSurface }));
  `], { cwd: rootDir, encoding: 'utf8', timeout: 30000, env: { ...cleanGitEnv(), CI: 'true', VERITAS_CHANGED_FROM: '', VERITAS_CHANGED_TO: '', ...env } });
}

function output(result, status = 0) {
  assert.equal(result.status, status, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

test('nested Veritas root classifies its removed manifest with its own committed map', async (t) => {
  const { rootDir, gitRoot, map } = fixture(t, { nested: true });
  unlinkSync(join(rootDir, 'old-manifest.json'));
  map.graph.nodes[1].patterns = [];
  writeMap(rootDir, map);
  approveMap(rootDir);
  for (const scope of ['working-tree', 'branch-diff']) {
    if (scope === 'branch-diff') commitAll(gitRoot, 'Remove nested manifest and its pattern');
    await t.test(scope, () => {
      const result = output(health(rootDir, scope === 'branch-diff' ? { changedFrom: 'HEAD~1', changedTo: 'HEAD' } : {}));
      assert.equal(result.health, 'green');
      assert.ok(result.report.files.includes('old-manifest.json'));
      assert.ok(result.report.files.every((file) => !file.startsWith('pkg/')));
      assert.equal(result.report.file_nodes['old-manifest.json'][0].id, 'governance.manifest');
      assert.equal(result.report.file_nodes['old-manifest.json'][0].kind, 'protected-area');
      assert.deepEqual(result.report.recommendations, []);
      if (scope === 'branch-diff') assert.equal(result.governance.classification, 'protected-standards-modification');
    });
  }
});

for (const baseMap of ['absent', 'malformed', 'no-graph']) {
  for (const scope of ['working-tree', 'branch-diff']) {
    test(`unavailable ${baseMap} base map uses current map and warns in ${scope}`, (t) => {
      const { rootDir, gitRoot } = fixture(t, { baseMap });
      unlinkSync(join(rootDir, 'old-manifest.json'));
      approveMap(rootDir);
      if (scope === 'branch-diff') commitAll(gitRoot, 'Adopt current map and delete manifest');
      const result = output(health(rootDir, scope === 'branch-diff' ? { changedFrom: 'HEAD~1', changedTo: 'HEAD' } : {}));
      assert.equal(result.health, 'green');
      assert.deepEqual(result.report.unresolved_files, []);
      assert.equal(result.report.file_nodes['old-manifest.json'][0].kind, 'protected-area');
      const warning = result.report.recommendations.find((item) => item.kind === 'base-map-unavailable');
      assert.equal(warning?.severity, 'warn');
      assert.deepEqual(warning.files, ['old-manifest.json']);
      assert.match(warning.message, /base Repo Map unavailable.*current Repo Map/);
      assert.match(warning.message, baseMap === 'absent' ? /does not exist|exists on disk|bad revision/ : baseMap === 'malformed' ? /invalid JSON/ : /no valid graph.nodes/);
      assert.ok(result.markdown.includes(markdownCode(warning.message)));
      if (baseMap === 'malformed' && scope === 'branch-diff') {
        assert.equal(result.governance.classification, 'protected-standards-modification');
      }
    });
  }
}

test('protected deletion with pattern removed still fails without a policy-change attestation', (t) => {
  const { rootDir, gitRoot, map } = fixture(t);
  unlinkSync(join(rootDir, 'old-manifest.json'));
  map.graph.nodes[1].patterns = [];
  writeMap(rootDir, map);
  commitAll(gitRoot, 'Delete protected manifest without approving map change');
  const result = output(health(rootDir, { changedFrom: 'HEAD~1', changedTo: 'HEAD' }), 1);
  assert.equal(result.health, 'red');
  assert.deepEqual(result.report.unresolved_files, []);
  const policy = result.report.policy_results.find((item) => item.rule_id === 'policy-changes-require-attestation');
  assert.equal(policy.passed, false);
  assert.match(policy.summary, /do not match|drift/i);
});

test('Git identifies the removed endpoint of a case-only working-tree rename', (t) => {
  const { rootDir, gitRoot, map } = fixture(t);
  renameSync(join(rootDir, 'old-manifest.json'), join(rootDir, 'Manifest.json'));
  commitAll(gitRoot, 'Use capitalized manifest');
  execGitFixture(['mv', 'Manifest.json', 'manifest.json'], { cwd: rootDir });
  map.graph.nodes[1].patterns = ['manifest.json'];
  writeMap(rootDir, map);
  approveMap(rootDir);
  const result = output(health(rootDir));
  assert.equal(result.health, 'green');
  assert.deepEqual(result.report.unresolved_files, []);
  assert.equal(result.report.file_nodes['Manifest.json'][0].kind, 'protected-area');
  assert.equal(result.report.file_nodes['manifest.json'][0].kind, 'protected-area');
});

for (const changedFrom of ['missing-review-base', '.veritas/repo-map.json', '--output=review-injection']) {
  test(`unresolvable changed-from revision fails clearly: ${changedFrom}`, (t) => {
    const { rootDir } = fixture(t);
    unlinkSync(join(rootDir, 'old-manifest.json'));
    const result = health(rootDir, { changedFrom, changedTo: 'HEAD' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot resolve Git revision .* to a commit/);
    assert.ok(result.stderr.includes(JSON.stringify(changedFrom)));
    assert.equal(result.stdout, '');
    assert.equal(existsSync(join(rootDir, 'review-injection')), false);
  });
}

test('base-map Git read times out and reports the current-map fallback', async (t) => {
  const { rootDir, gitRoot } = fixture(t);
  unlinkSync(join(rootDir, 'old-manifest.json'));
  const binDir = join(rootDir, 'node_modules', 'transport-bin');
  mkdirp(binDir);
  const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  assert.ok(existsSync(gitPath));
  const wrapper = join(binDir, 'git');
  writeFileSync(wrapper, `#!/bin/sh
if [ "$1" = "show" ]; then
  case "$2" in
    *:./.veritas/repo-map.json) exec '${process.execPath}' -e 'setTimeout(() => {}, 20000)' ;;
  esac
fi
exec '${gitPath}' "$@"
`);
  chmodSync(wrapper, 0o755);
  for (const scope of ['working-tree', 'branch-diff']) {
    if (scope === 'branch-diff') commitAll(gitRoot, 'Delete manifest before stalled transport');
    await t.test(scope, () => {
      const result = output(health(rootDir, {
        ...(scope === 'branch-diff' ? { changedFrom: 'HEAD~1', changedTo: 'HEAD' } : {}),
        env: { PATH: `${binDir}:${process.env.PATH}` },
      }));
      assert.equal(result.health, 'green');
      const warning = result.report.recommendations.find((item) => item.kind === 'base-map-unavailable');
      assert.match(warning?.message, /ETIMEDOUT|timed out/);
      if (scope === 'branch-diff') assert.equal(result.governance.classification, 'protected-standards-modification');
    });
  }
});
