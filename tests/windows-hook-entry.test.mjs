import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildSuggestedCodexHookConfig } from '../src/integrations/codex-hooks.mjs';
import { applyCodexHook, writeBootstrapStarterKit } from '../src/index.mjs';
import { cleanGitEnv, execGitFixture, initCommittedRepo, repoRootDir } from './helpers.mjs';
import { tempDir } from './temp-dir.mjs';

const native = { skip: process.platform !== 'win32' };

function install(root, name, exitCode = 0) {
  const pkg = join(root, 'node_modules', '@kontourai', 'veritas');
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@kontourai/veritas', version: '1.0.0', bin: { veritas: 'bin/veritas.mjs' } }));
  writeFileSync(join(pkg, 'bin', 'veritas.mjs'), `let input=''; for await (const part of process.stdin) input+=part; console.log(JSON.stringify({ install: ${JSON.stringify(name)}, args: process.argv.slice(2), input })); process.exitCode=${exitCode};\n`);
}

function fixture(t) {
  const parent = initCommittedRepo(t, 'veritas windows entry ');
  const root = join(parent, "repo with spaces and 'quote");
  mkdirSync(root);
  execGitFixture(['init', '-b', 'main'], { cwd: root });
  writeFileSync(join(root, 'package.json'), '{"name":"consumer","version":"1.0.0"}\n');
  const nested = join(root, 'packages', 'nested with spaces');
  mkdirSync(nested, { recursive: true });
  const foreignBin = tempDir(t, 'veritas-foreign-windows-');
  const marker = join(foreignBin, 'foreign-ran');
  writeFileSync(join(foreignBin, 'veritas.cmd'), `@echo foreign>"${marker}"\r\n@exit /b 0\r\n`);
  const script = join(root, 'run-hook.ps1');
  writeFileSync(script, buildSuggestedCodexHookConfig().hooks.PreToolUse[0].hooks[0].commandWindows);
  const env = { ...cleanGitEnv(), PATH: `${foreignBin};${process.env.PATH}`, npm_config_prefix: join(foreignBin, 'global'), npm_config_offline: 'true' };
  const powershell = process.env.VERITAS_TEST_POWERSHELL || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const run = (cwd, overrides = {}, input = '{"tool_name":"Edit","tool_input":{"file_path":"file with spaces.md"}}') => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    cwd, env: { ...env, ...overrides }, input,
    encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  return { root, nested, run, marker, foreignBin, script };
}

test('native Windows generated hook runs the nearest validated entry with stdin and exact exit status', native, (t) => {
  const { root, nested, run, marker } = fixture(t);
  install(root, 'root', 7);
  for (const cwd of [root, nested, root.toUpperCase()]) {
    const result = run(cwd);
    assert.equal(result.status, 7, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.install, 'root');
    assert.deepEqual(output.args, ['hooks', 'codex', 'pre-tool-use']);
    assert.equal(JSON.parse(output.input).tool_input.file_path, 'file with spaces.md');
  }
  install(nested, 'nested');
  assert.equal(JSON.parse(run(nested).stdout.trim()).install, 'nested');
  assert.equal(existsSync(marker), false);
});

test('native Windows refuses before editing when Node is unavailable', native, (t) => {
  const { root, run } = fixture(t);
  const result = run(root, { PATH: join(process.env.SystemRoot, 'System32') });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /node/);
});

test('native Windows refuses a repository install when GIT_WORK_TREE names an unrelated directory', native, (t) => {
  const { root, nested, run, marker } = fixture(t);
  install(root, 'must-not-run');
  const other = initCommittedRepo(t, 'veritas-unrelated-root-');
  const result = run(nested, { GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(marker), false);
});

test('native Windows installed hook forwards real Veritas guidance and denies an invalid edit', native, (t) => {
  const { root, nested, run, script } = fixture(t);
  writeBootstrapStarterKit({ rootDir: root, projectName: 'Windows hook', evidenceCheck: 'node --version', force: true });
  const scope = join(root, 'node_modules', '@kontourai');
  mkdirSync(scope, { recursive: true });
  symlinkSync(repoRootDir, join(scope, 'veritas'), 'junction');
  const hooks = join(root, '.codex', 'hooks.json');
  applyCodexHook({ rootDir: root, targetHooksFile: hooks });
  const installed = JSON.parse(readFileSync(hooks, 'utf8')).hooks.PreToolUse[0].hooks[0];
  writeFileSync(script, installed.commandWindows);
  const allowed = run(nested, {}, JSON.stringify({ cwd: nested, tool_name: 'Edit', tool_input: { file_path: 'README.md' } }));
  assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`);
  assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');
  const denied = run(nested, {}, JSON.stringify({ cwd: nested, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** End Patch' } }));
  assert.equal(denied.status, 2, `${denied.stdout}\n${denied.stderr}`);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('native Windows skips an incomplete nested package and resolves a junction by physical repository identity', native, (t) => {
  const { root, nested, run, marker } = fixture(t);
  install(root, 'root');
  mkdirSync(join(nested, 'node_modules', '@kontourai', 'veritas'), { recursive: true });
  const alias = join(dirname(root), `${root.split(/[\\/]/).at(-1)}-alias`);
  symlinkSync(nested, alias, 'junction');
  t.after(() => rmSync(alias, { recursive: true, force: true }));
  const result = run(alias);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).install, 'root');
  assert.equal(existsSync(marker), false);
});

test('native Windows never runs a parent or PATH Veritas when no eligible package entry exists', native, (t) => {
  const { root, nested, run, marker } = fixture(t);
  install(dirname(root), 'outside-repository');
  const result = run(nested);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /no installed package entry found/);
  assert.equal(existsSync(marker), false);
});

test('native Windows supports an explicitly installed scoped global package without a repository install', native, (t) => {
  const { nested, run, marker, foreignBin } = fixture(t);
  const prefix = join(foreignBin, 'global');
  install(prefix, 'global');
  const result = run(nested);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).install, 'global');
  assert.equal(existsSync(marker), false);
});
