import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBootstrapStarterKit } from '../../src/bootstrap.mjs';
import { readRunHistory } from '../../src/standards-feedback/run-history.mjs';
import { commitAll, initCommittedRepo, repoRootDir } from '../helpers.mjs';

// A repo whose Repo Standards declare a Require work-area-boundary rule over a strict Repo Map node
// owned by `owner-team`, with an uncommitted edit inside that node.
function strictOwnedFixture(t) {
  const rootDir = initCommittedRepo(t, 'veritas-readiness-actor-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-actor-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  const node = repoMap.graph.nodes.find((candidate) => candidate.id === 'app.src');
  Object.assign(node, { owners: ['owner-team'], boundary: 'strict', boundaryAllow: [] });
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  const repoStandardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const repoStandards = JSON.parse(readFileSync(repoStandardsPath, 'utf8'));
  repoStandards.rules.push({
    id: 'declared-work-area-boundary',
    kind: 'work-area-boundary',
    classification: 'hard-invariant',
    enforcementLevel: 'Require',
    message: 'Only owners edit strict work areas.',
    match: {},
  });
  writeFileSync(repoStandardsPath, `${JSON.stringify(repoStandards, null, 2)}\n`);
  mkdirSync(join(rootDir, 'src'));
  writeFileSync(join(rootDir, 'src/app.js'), 'export const value = 1;\n');
  commitAll(rootDir, 'Strict owned work area');
  writeFileSync(join(rootDir, 'src/app.js'), 'export const value = 2;\n');
  return rootDir;
}

function readiness(rootDir, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  if (!('VERITAS_ACTOR' in env)) delete childEnv.VERITAS_ACTOR;
  return spawnSync(
    process.execPath,
    [join(repoRootDir, 'bin/veritas.mjs'), 'readiness', '--root', rootDir, '--working-tree', ...args],
    { cwd: rootDir, encoding: 'utf8', env: childEnv },
  );
}

const OWNER_PASS = /^PASS\s+declared-work-area-boundary: Actor owner-team stayed within owned or allowed work areas\.$/m;
const MISSING_ACTOR = /^FAIL\s+declared-work-area-boundary: work-area-boundary requires --actor or VERITAS_ACTOR; refusing to silently pass\.$/m;

test('readiness --actor passes the owner of a strict work area', (t) => {
  const result = readiness(strictOwnedFixture(t), ['--actor', 'owner-team']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, OWNER_PASS);
});

test('readiness --actor fails a non-owner of a strict work area', (t) => {
  const result = readiness(strictOwnedFixture(t), ['--actor', 'rogue']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /^FAIL\s+declared-work-area-boundary: Actor rogue touched a strict work area they do not own\.$/m,
  );
});

test('readiness without --actor or VERITAS_ACTOR fails closed', (t) => {
  const result = readiness(strictOwnedFixture(t), []);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, MISSING_ACTOR);
});

test('readiness --actor takes precedence over VERITAS_ACTOR, including in run history', (t) => {
  const rootDir = strictOwnedFixture(t);
  const result = readiness(rootDir, ['--actor', 'owner-team'], { VERITAS_ACTOR: 'rogue' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, OWNER_PASS);
  assert.deepEqual(readRunHistory(rootDir).map((entry) => [entry.actor, entry.status]), [['owner-team', 'pass']]);
});

test('readiness --check coverage reads --actor for the work-area-boundary rule', (t) => {
  const rootDir = strictOwnedFixture(t);
  const withActor = readiness(rootDir, ['--check', 'coverage', '--format', 'feedback', '--actor', 'owner-team']);
  assert.equal(withActor.status, 0, withActor.stdout + withActor.stderr);
  assert.match(withActor.stdout, OWNER_PASS);

  const withoutActor = readiness(rootDir, ['--check', 'coverage', '--format', 'feedback']);
  assert.equal(withoutActor.status, 0, withoutActor.stdout + withoutActor.stderr);
  assert.match(withoutActor.stdout, MISSING_ACTOR);
});
