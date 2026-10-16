import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import crossSpawn from 'cross-spawn';

import { cleanGitEnv, initCommittedRepo, installLocalVeritasBin, repoRootDir } from './helpers.mjs';
import { tempDir } from './temp-dir.mjs';

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

function runBlockCommand(rootDir, block, env) {
  const [program, ...args] = block.match(/run `([^`]+)` and address any FAIL lines/)[1].split(' ');
  return new Promise((resolve, reject) => {
    const child = crossSpawn(program, args, { cwd: rootDir, env, windowsHide: true, timeout: 30_000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', (part) => { stdout += part; });
    child.stderr.on('data', (part) => { stderr += part; });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
    child.stdin.end();
  });
}

test('the block written by init names the remedy for a fresh clone, and its command runs after it', async (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-block-command-');
  const npmState = tempDir(t, 'veritas-block-npm-');
  const emptyConfig = join(npmState, 'npmrc');
  const globalConfig = join(npmState, 'global-npmrc');
  writeFileSync(emptyConfig, '');
  writeFileSync(globalConfig, '');
  const version = JSON.parse(readFileSync(join(repoRootDir, 'package.json'), 'utf8')).version;
  let downloads = 0;
  const registry = createServer((request, response) => {
    if (!request.url.toLowerCase().startsWith('/@kontourai%2fveritas')) {
      downloads += 1;
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ name: '@kontourai/veritas', 'dist-tags': { latest: version }, versions: {
      [version]: { name: '@kontourai/veritas', version, bin: { veritas: 'bin/veritas.mjs' }, dist: { tarball: `http://127.0.0.1:${registry.address().port}/package.tgz` } },
    } }));
  });
  await new Promise((resolve) => registry.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => registry.close(resolve)));
  const env = { ...cleanGitEnv(), npm_config_cache: join(npmState, 'cache'), npm_config_prefix: join(npmState, 'prefix'),
    npm_config_userconfig: emptyConfig, npm_config_globalconfig: globalConfig,
    npm_config_registry: `http://127.0.0.1:${registry.address().port}`, npm_config_update_notifier: 'false', npm_config_offline: 'false' };
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({ name: 'consumer', version: '1.0.0' }, null, 2)}\n`);
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agents\n');
  const init = spawnSync(process.execPath, [join(repoRootDir, 'bin/veritas.mjs'), 'init', '--non-interactive'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);
  const block = blockIn(rootDir);

  // A fresh clone: Veritas is not installed, so the block's command cannot run.
  const fresh = await runBlockCommand(rootDir, block, env);
  assert.equal(fresh.signal, null);
  assert.notEqual(fresh.status, 0, 'npx --no refuses without an installed Veritas');
  assert.match(fresh.stderr, /npx canceled due to missing packages/);
  assert.equal(downloads, 0, '--no never requested a package tarball');
  assert.doesNotMatch(fresh.stdout, /ai-instruction-files-synced/);

  // The block tells the agent what to do about it.
  assert.match(block, /If npx says the package is missing, install this repo's dependencies/);
  assert.match(block, /adding `@kontourai\/veritas` as a development dependency if it is not one/);

  // Following the remedy, the same command runs readiness.
  installLocalVeritasBin(rootDir);
  const installed = await runBlockCommand(rootDir, block, env);
  assert.match(installed.stdout, /ai-instruction-files-synced/, installed.stderr);
});

test('the product checkout runs its own CLI from maintenance scripts despite a foreign Veritas on PATH', (t) => {
  const fakeBin = tempDir(t, 'veritas-self-script-path-');
  const marker = join(fakeBin, 'foreign-ran');
  const fakeEntry = join(fakeBin, 'foreign.mjs');
  writeFileSync(fakeEntry, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'foreign'); process.exit(86);\n`);
  if (process.platform === 'win32') {
    writeFileSync(join(fakeBin, 'veritas.cmd'), `@"${process.execPath}" "${fakeEntry}" %*\r\n`);
  } else {
    writeFileSync(join(fakeBin, 'veritas'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${fakeEntry.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
  }
  const env = {
    ...cleanGitEnv(),
    PATH: `${fakeBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
    npm_config_offline: 'true',
    npm_config_cache: join(fakeBin, 'npm-cache'),
  };
  mkdirSync(env.npm_config_cache);
  for (const script of [
    'veritas:init', 'veritas:status:codex', 'veritas:check',
    'veritas:check:working-tree', 'veritas:check:diff', 'veritas:coverage',
    'lint:governance', 'veritas:readiness',
  ]) {
    const result = crossSpawn.sync('npm', ['run', script, '--', '--help'], {
      cwd: repoRootDir, env, encoding: 'utf8', windowsHide: true, timeout: 15_000,
    });
    assert.equal(result.status, 0, `${script}: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /[Vv]eritas/);
  }
  const readiness = crossSpawn.sync('npm', ['run', 'veritas:readiness', '--', '--check', 'config', '--format', 'json'], {
    cwd: repoRootDir, env, encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
  assert.equal(readiness.status, 0, `${readiness.stdout}\n${readiness.stderr}`);
  assert.match(readiness.stdout, /"rootDir"/);
  assert.match(readiness.stdout, /"status": "valid"/);
  assert.throws(() => readFileSync(marker), { code: 'ENOENT' });
});
