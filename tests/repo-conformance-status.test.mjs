import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  classifyGovernanceSurface,
  renderGovernanceSurfaceLine,
  summarizeGovernanceTrend,
} from '../src/conformance/run.mjs';
import { commitAll, initCommittedRepo, mkdirp } from './helpers.mjs';

function writeJsonFile(rootDir, relativePath, value) {
  const path = join(rootDir, relativePath);
  mkdirp(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createGovernanceRepo(prefix = 'veritas-conformance-governance-') {
  const rootDir = initCommittedRepo(prefix);
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
  assert.equal(renderGovernanceSurfaceLine(result), '- **Governance surface:** clean (no PR base/head diff)');
});

test('Protected Standards treats added governance files as additive-only', () => {
  const rootDir = createGovernanceRepo('veritas-conformance-additive-');
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
    '- **Governance surface:** additive-only (.veritas/authority/release.authority-settings.json added)',
  );
});

test('Protected Standards stays clean for semantic no-op formatting changes', () => {
  const rootDir = createGovernanceRepo('veritas-conformance-clean-');
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

test('Protected Standards treats removals as protected standards modifications', () => {
  const rootDir = createGovernanceRepo('veritas-conformance-protected-standards-');
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

test('Protected Standards treats governance renames as protected standards modifications', () => {
  const rootDir = createGovernanceRepo('veritas-conformance-rename-');
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

test('governance trend summary includes recent classification counts', () => {
  const rootDir = createGovernanceRepo('veritas-conformance-trend-');
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
