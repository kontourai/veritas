import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBootstrapStarterKit } from '../../src/bootstrap.mjs';
import { runMergeReadiness } from '../../src/readiness/run.mjs';
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

function readinessVerdictAuthorityTrace(bundle) {
  const traces = bundle.authorityTrace.filter((trace) => trace.id.includes('.readiness-verdict.'));
  assert.equal(traces.length, 1, JSON.stringify(bundle.authorityTrace));
  return traces[0];
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

test('readiness --actor names the authority trace actor over VERITAS_ACTOR', (t) => {
  const rootDir = strictOwnedFixture(t);
  const result = readiness(
    rootDir,
    ['--actor', 'owner-team', '--run-id', 'actor-trace', '--format', 'trust-bundle'],
    { VERITAS_ACTOR: 'rogue' },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const streamed = readinessVerdictAuthorityTrace(JSON.parse(result.stdout));
  assert.equal(streamed.actorRef, 'system:owner-team');
  assert.equal(streamed.metadata.actor, 'owner-team');

  const evidence = JSON.parse(readFileSync(join(rootDir, '.kontourai/veritas/evidence/actor-trace.json'), 'utf8'));
  const stored = readinessVerdictAuthorityTrace(evidence.trust.bundle);
  assert.equal(stored.actorRef, 'system:owner-team');
  assert.equal(stored.metadata.actor, 'owner-team');
});

test('readiness --actor with an empty value names no actor', (t) => {
  const unset = strictOwnedFixture(t);
  const failed = readiness(unset, ['--actor', '']);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stdout, MISSING_ACTOR);
  assert.deepEqual(readRunHistory(unset).map((entry) => [entry.actor, entry.status]), [['unknown', 'fail']]);

  const fromEnv = strictOwnedFixture(t);
  const passed = readiness(fromEnv, ['--actor', ''], { VERITAS_ACTOR: 'owner-team' });
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, OWNER_PASS);
});

test('an embedder runtime.actor feeds the rule, the authority trace, and run history alike', async (t) => {
  const rootDir = strictOwnedFixture(t);
  const previousActor = process.env.VERITAS_ACTOR;
  process.env.VERITAS_ACTOR = 'rogue-env';
  t.after(() => {
    if (previousActor === undefined) delete process.env.VERITAS_ACTOR;
    else process.env.VERITAS_ACTOR = previousActor;
  });

  const result = await runMergeReadiness(
    { rootDir, workingTree: true, actor: 'rogue-option', runId: 'embedder-actor' },
    { rootDir },
    [],
    { actor: 'owner-team' },
  );

  const rule = result.reportResult.record.policy_results.find((entry) => entry.rule_id === 'declared-work-area-boundary');
  assert.equal(rule.passed, true, JSON.stringify(rule));
  assert.equal(readinessVerdictAuthorityTrace(result.reportResult.record.trust.bundle).actorRef, 'system:owner-team');
  assert.equal(result.actor, 'owner-team');
  assert.deepEqual(readRunHistory(rootDir).map((entry) => entry.actor), ['owner-team']);
});
