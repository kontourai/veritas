import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { cleanGitEnv, initCommittedRepo, installLocalVeritasBin, repoRootDir } from './helpers.mjs';

// The governance block is what an agent in an adopter repository reads (#193). Its command,
// `npx --no @kontourai/veritas readiness`, runs only an installed Veritas, so in a fresh clone it
// stops. This follows the block as written into AGENTS.md by `init`: the command refuses before
// the dependency is installed, the block names that remedy, and after it the same command runs.

function blockIn(rootDir) {
  const content = readFileSync(join(rootDir, 'AGENTS.md'), 'utf8');
  const block = content.match(/<!-- veritas:governance-block:start -->[\s\S]*?<!-- veritas:governance-block:end -->/);
  assert.ok(block, 'init wrote a governance block into AGENTS.md');
  return block[0];
}

function runBlockCommand(rootDir, block) {
  const [program, ...args] = block.match(/run `([^`]+)` and address any FAIL lines/)[1].split(' ');
  return spawnSync(program, args, {
    cwd: rootDir,
    encoding: 'utf8',
    input: '',
    env: { ...cleanGitEnv(), npm_config_offline: 'true' },
  });
}

test('the block written by init names the remedy for a fresh clone, and its command runs after it', (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-block-command-');
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '1.0.0' }, null, 2)}\n`);
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agents\n');
  const init = spawnSync(process.execPath, [join(repoRootDir, 'bin/veritas.mjs'), 'init', '--non-interactive'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);
  const block = blockIn(rootDir);

  // A fresh clone: Veritas is not installed, so the block's command cannot run.
  const fresh = runBlockCommand(rootDir, block);
  assert.notEqual(fresh.status, 0, 'npx --no refuses without an installed Veritas');
  assert.doesNotMatch(fresh.stdout, /ai-instruction-files-synced/);

  // The block tells the agent what to do about it.
  assert.match(block, /If npx says the package is missing, install this repo's dependencies/);
  assert.match(block, /adding `@kontourai\/veritas` as a development dependency if it is not one/);

  // Following the remedy, the same command runs readiness.
  installLocalVeritasBin(rootDir);
  const installed = runBlockCommand(rootDir, block);
  assert.match(installed.stdout, /ai-instruction-files-synced/, installed.stderr);
});
