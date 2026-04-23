import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classifyGovernanceSurface, renderGovernanceSurfaceLine } from '../scripts/checkin-status.mjs';
import { commitAll, initCommittedRepo, mkdirp } from './helpers.mjs';

function writeJsonFile(rootDir, relativePath, value) {
  const path = join(rootDir, relativePath);
  mkdirp(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createGovernanceRepo(prefix = 'veritas-checkin-governance-') {
  const rootDir = initCommittedRepo(prefix);
  mkdirp(join(rootDir, '.veritas/policy-packs'));
  mkdirp(join(rootDir, '.veritas/team'));
  writeJsonFile(rootDir, '.veritas/repo.adapter.json', {
    name: 'demo',
    graph: {
      version: 1,
    },
  });
  writeJsonFile(rootDir, '.veritas/policy-packs/default.policy-pack.json', {
    name: 'default',
    rules: [
      {
        id: 'keep-hooks',
      },
    ],
  });
  writeJsonFile(rootDir, '.veritas/team/default.team-profile.json', {
    name: 'default',
    reviewers: ['maintainer'],
  });
  commitAll(rootDir, 'Add governance fixtures');
  return rootDir;
}

test('governance surface is clean when no PR refs are supplied', () => {
  const result = classifyGovernanceSurface();

  assert.equal(result.classification, 'clean');
  assert.equal(result.evaluated, false);
  assert.equal(result.summary, 'clean (no PR base/head diff)');
  assert.equal(renderGovernanceSurfaceLine(result), '- **Governance surface:** clean (no PR base/head diff)');
});

test('governance surface treats added governance files as additive-only', () => {
  const rootDir = createGovernanceRepo('veritas-checkin-additive-');
  writeJsonFile(rootDir, '.veritas/team/release.team-profile.json', {
    name: 'release',
    reviewers: ['maintainer', 'ops'],
  });
  commitAll(rootDir, 'Add release team profile');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'additive-only');
  assert.deepEqual(result.semantic_changed_paths, ['.veritas/team/release.team-profile.json']);
  assert.deepEqual(result.files, [
    {
      path: '.veritas/team/release.team-profile.json',
      status: 'added',
      additive: true,
      semantic_change: true,
    },
  ]);
  assert.equal(
    renderGovernanceSurfaceLine(result),
    '- **Governance surface:** additive-only (.veritas/team/release.team-profile.json added)',
  );
});

test('governance surface stays clean for semantic no-op formatting changes', () => {
  const rootDir = createGovernanceRepo('veritas-checkin-clean-');
  writeFileSync(
    join(rootDir, '.veritas/repo.adapter.json'),
    '{\n  "graph": {\n    "version": 1\n  },\n  "name": "demo"\n}\n',
    'utf8',
  );
  commitAll(rootDir, 'Reformat adapter');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'clean');
  assert.deepEqual(result.changed_paths, ['.veritas/repo.adapter.json']);
  assert.deepEqual(result.semantic_changed_paths, []);
  assert.equal(result.files[0].status, 'equivalent');
  assert.equal(result.summary, 'clean (no semantic governance changes)');
});

test('governance surface treats removals as constitutional modifications', () => {
  const rootDir = createGovernanceRepo('veritas-checkin-constitutional-');
  unlinkSync(join(rootDir, '.veritas/team/default.team-profile.json'));
  commitAll(rootDir, 'Remove default team profile');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'constitutional-modification');
  assert.deepEqual(result.files, [
    {
      path: '.veritas/team/default.team-profile.json',
      status: 'removed',
      additive: false,
      semantic_change: true,
    },
  ]);
});

test('governance surface treats governance renames as constitutional modifications', () => {
  const rootDir = createGovernanceRepo('veritas-checkin-rename-');
  const originalPath = join(rootDir, '.veritas/team/default.team-profile.json');
  const renamedPath = join(rootDir, '.veritas/team/release.team-profile.json');
  writeFileSync(
    renamedPath,
    readFileSync(originalPath, 'utf8'),
    'utf8',
  );
  unlinkSync(originalPath);
  commitAll(rootDir, 'Rename team profile');

  const result = classifyGovernanceSurface({
    rootDir,
    changedFrom: 'HEAD~1',
    changedTo: 'HEAD',
  });

  assert.equal(result.classification, 'constitutional-modification');
  assert.deepEqual(result.semantic_changed_paths, [
    '.veritas/team/default.team-profile.json',
    '.veritas/team/release.team-profile.json',
  ]);
  assert.deepEqual(result.files, [
    {
      path: '.veritas/team/default.team-profile.json',
      status: 'removed',
      additive: false,
      semantic_change: true,
    },
    {
      path: '.veritas/team/release.team-profile.json',
      status: 'added',
      additive: true,
      semantic_change: true,
    },
  ]);
});
