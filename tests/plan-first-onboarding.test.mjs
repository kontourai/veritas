import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanGitEnv, commitAll, initCommittedRepo, installLocalVeritasBin } from './helpers.mjs';

const repoRootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The reviewed onboarding path the setup skill, the governance-kit guide, getting-started and the
// brownfield guide prescribe, run as an adopter runs it: through `npx --no @kontourai/veritas`
// against a locally installed package, one child process per documented step, with no TTY.
function veritas(rootDir, args) {
  const result = spawnSync('npx', ['--no', '@kontourai/veritas', ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    input: '',
    env: cleanGitEnv(),
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test('the documented plan-first path reaches a passing readiness check', (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-plan-first-onboarding-');
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({
    name: 'plan-first-adopter',
    version: '1.0.0',
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2)}\n`);
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agent Instructions\n');
  commitAll(rootDir, 'Adopter repository');
  installLocalVeritasBin(rootDir);
  const plan = '.veritas/init-plans/first-pass.json';

  for (const step of [
    ['init', '--explore', '--output', plan],
    ['init', '--apply', '--plan', plan],
    ['setup', 'repo-hooks'],
    ['attest', 'bootstrap', '--actor', 'repo-owner', '--approval-ref', 'review:plan-first', '--non-interactive'],
  ]) {
    const result = veritas(rootDir, step);
    assert.equal(result.status, 0, `${step.join(' ')} failed:\n${result.output}`);
  }

  const readiness = veritas(rootDir, ['readiness', '--working-tree']);
  assert.equal(readiness.status, 0, `readiness failed:\n${readiness.output}`);
  assert.match(readiness.output, /^0 failures/m);
  assert.equal(existsSync(join(rootDir, 'veritas.claims.json')), true, 'applying the plan must create the claim store');
});

test('applying a plan keeps an existing authored claim store, even with --force', (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-plan-apply-keeps-claims-');
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2)}\n`);
  const authored = `${JSON.stringify({ schemaVersion: 1, producer: 'veritas', claims: [], policies: [] }, null, 2)}\n`;
  writeFileSync(join(rootDir, 'veritas.claims.json'), authored);
  const cli = (args) => spawnSync(process.execPath, [join(repoRootDir, 'bin/veritas.mjs'), ...args, '--root', rootDir], {
    cwd: rootDir,
    encoding: 'utf8',
    env: cleanGitEnv(),
  });
  const plan = '.veritas/init-plans/keep.json';
  assert.equal(cli(['init', '--explore', '--output', plan]).status, 0);
  const apply = cli(['init', '--apply', '--plan', plan, '--force']);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(readFileSync(join(rootDir, 'veritas.claims.json'), 'utf8'), authored);
  assert.equal(JSON.parse(apply.stdout).generatedFiles.includes('veritas.claims.json'), false);
  // The kept store has no work-area claims, so the warning names every work area in the Repo Map.
  const workAreas = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-map.json'), 'utf8')).graph.nodes.map((node) => node.id).sort();
  assert.ok(workAreas.length > 0);
  assert.match(apply.stderr, new RegExp(`Warning: veritas\\.claims\\.json was kept and differs from the applied Repo Map\\. Work areas without a claim: ${workAreas.join(', ').replaceAll('.', '\\.')}\\.`));

  // A kept store that matches the applied Repo Map draws no warning.
  rmSync(join(rootDir, 'veritas.claims.json'));
  assert.equal(cli(['init', '--apply', '--plan', plan, '--force']).status, 0);
  const again = cli(['init', '--apply', '--plan', plan, '--force']);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stderr, /was kept and differs/);
});
