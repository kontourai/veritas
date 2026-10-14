import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeBootstrapStarterKit } from '../src/index.mjs';
import { buildSuggestedCodexHookConfig } from '../src/integrations/codex-hooks.mjs';
import { buildClaudeCodeSessionLogCaptureCommand } from '../src/hooks/suggestions.mjs';
import { cleanGitEnv, commitAll, initCommittedRepo, installLocalVeritasBin, repoRootDir } from './helpers.mjs';

// Agent runtimes run these hook commands in the agent's working directory. In a pnpm workspace
// that can be packages/a, a package with its own package.json and no Veritas of its own: npx looks
// only under the nearest package root, so a bare `npx --no @kontourai/veritas` refuses there.
const codexHooks = buildSuggestedCodexHookConfig().hooks;
const CODEX_PRE_TOOL_USE = codexHooks.PreToolUse[0].hooks[0].command;
const CODEX_POST_SESSION = codexHooks.PostSession[0].hooks[0].command;
const CLAUDE_POST_SESSION = buildClaudeCodeSessionLogCaptureCommand();

function pnpmWorkspace({ installVeritas }) {
  const rootDir = initCommittedRepo('veritas-nested-package-');
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({
    name: 'workspace-root',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2)}\n`);
  writeFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  const packageDir = join(rootDir, 'packages/a');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({ name: 'a', version: '1.0.0' }, null, 2)}\n`);
  writeFileSync(join(packageDir, 'index.js'), 'export const a = 1;\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'workspace-root', evidenceCheck: 'npm test', force: true });
  commitAll(rootDir, 'pnpm workspace with Veritas governance at the root');
  if (installVeritas) installLocalVeritasBin(rootDir);
  return { rootDir, packageDir };
}

function runHook(command, { cwd, input = '', env = {} }) {
  const result = spawnSync('sh', ['-c', command], {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...cleanGitEnv(), ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// A Claude Code session log is JSONL in the shape tests/integrations/claude-code-session-log.test.mjs uses.
function claudeSessionLog(dir) {
  const path = join(dir, 'claude-session.jsonl');
  const lines = [
    { type: 'assistant', timestamp: '2026-05-10T00:00:00.000Z', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'veritas readiness --working-tree' } }] } },
    { type: 'user', timestamp: '2026-05-10T00:00:10.000Z', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'PASS  rule-a: fine' }] }] } },
    { type: 'assistant', timestamp: '2026-05-10T00:01:00.000Z', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return path;
}

function sessionLog(dir) {
  const path = join(dir, 'session.json');
  writeFileSync(path, `${JSON.stringify({
    session_id: 'nested-package',
    events: [
      { timestamp: '2026-05-09T10:00:00.000Z', command: 'veritas readiness', exit_code: 1, files: ['packages/a/index.js'], reported_lines: 10 },
      { timestamp: '2026-05-09T10:02:00.000Z', command: 'veritas readiness', exit_code: 0, files: ['packages/a/index.js'], reported_lines: 10 },
    ],
  }, null, 2)}\n`);
  return path;
}

const editPayload = (cwd) => JSON.stringify({
  cwd,
  tool_name: 'apply_patch',
  tool_input: { command: ['*** Begin Patch', '*** Update File: packages/a/index.js', '@@', '-old', '+new', '*** End Patch'].join('\n') },
});

test('Codex and Claude Code hook commands find a root-installed Veritas from a nested package', () => {
  const { rootDir, packageDir } = pnpmWorkspace({ installVeritas: true });

  // PreToolUse: VERITAS_HOOK_SKIP makes Veritas record the bypass under the root it resolved, which
  // proves the command reached Veritas from packages/a and evaluated the root's governance.
  const preToolUse = runHook(CODEX_PRE_TOOL_USE, { cwd: packageDir, input: editPayload(packageDir), env: { VERITAS_HOOK_SKIP: '1' } });
  assert.equal(preToolUse.status, 0, preToolUse.stderr);
  assert.doesNotMatch(preToolUse.stderr, /npx canceled/);
  JSON.parse(preToolUse.stdout);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);

  // PostSession capture runs in the working directory, as before, and writes its draft there.
  for (const [name, command, log] of [['Codex', CODEX_POST_SESSION, sessionLog], ['Claude Code', CLAUDE_POST_SESSION, claudeSessionLog]]) {
    const postSession = runHook(command, { cwd: packageDir, env: { VERITAS_SESSION_LOG_PATH: log(packageDir) } });
    assert.equal(postSession.status, 0, `${name} PostSession: ${postSession.stderr}`);
    assert.doesNotMatch(postSession.stderr, /npx canceled/);
    const result = JSON.parse(postSession.stdout);
    assert.equal(existsSync(join(packageDir, result.artifactPath)), true, `${name} PostSession draft`);
  }
});

test('the nested-package hook commands still refuse when no directory has Veritas installed', () => {
  const { packageDir } = pnpmWorkspace({ installVeritas: false });
  const cache = mkdtempSync(join(tmpdir(), 'veritas-empty-npm-cache-'));
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: packageDir, input: editPayload(packageDir), env: { npm_config_cache: cache } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npx canceled due to missing packages/);
  assert.equal(existsSync(join(packageDir, 'node_modules')), false);
  assert.equal(readFileSync(join(packageDir, 'package.json'), 'utf8').includes('veritas'), false);
});

// A package that announces itself instead of running Veritas, so a test can tell whether it ran.
function plantedVeritas(dir, marker) {
  const packageDir = join(dir, 'planted-veritas');
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({ name: '@kontourai/veritas', version: '0.0.0-planted', bin: { veritas: 'bin/veritas.js' } })}\n`);
  writeFileSync(join(packageDir, 'bin/veritas.js'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  chmodSync(join(packageDir, 'bin/veritas.js'), 0o755);
  return packageDir;
}

test('the walk stops at the git root, so a node_modules planted in a parent outside the repository never runs', () => {
  const parent = mkdtempSync(join(tmpdir(), 'veritas-planted-parent-'));
  const marker = join(parent, 'planted-ran');
  const planted = plantedVeritas(parent, marker);
  mkdirSync(join(parent, 'node_modules/@kontourai'), { recursive: true });
  mkdirSync(join(parent, 'node_modules/.bin'), { recursive: true });
  symlinkSync(planted, join(parent, 'node_modules/@kontourai/veritas'), 'dir');
  symlinkSync('../@kontourai/veritas/bin/veritas.js', join(parent, 'node_modules/.bin/veritas'));
  const repo = join(parent, 'repo');
  mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo, env: cleanGitEnv() });
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'repo', version: '1.0.0' })}\n`);
  const cache = mkdtempSync(join(tmpdir(), 'veritas-empty-npm-cache-'));

  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: repo, input: editPayload(repo), env: { npm_config_cache: cache } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /npx canceled due to missing packages/);
  assert.equal(existsSync(marker), false, 'the planted parent package must not run');
});

test('with no local install the hook commands fall back to a global Veritas', () => {
  const { rootDir, packageDir } = pnpmWorkspace({ installVeritas: false });
  // A global install the way `npm install -g` lays it out under a prefix.
  const globalPrefix = mkdtempSync(join(tmpdir(), 'veritas-global-prefix-'));
  mkdirSync(join(globalPrefix, 'lib/node_modules/@kontourai'), { recursive: true });
  mkdirSync(join(globalPrefix, 'bin'), { recursive: true });
  symlinkSync(repoRootDir, join(globalPrefix, 'lib/node_modules/@kontourai/veritas'), 'dir');
  symlinkSync('../lib/node_modules/@kontourai/veritas/bin/veritas.mjs', join(globalPrefix, 'bin/veritas'));
  const env = { npm_config_prefix: globalPrefix, VERITAS_HOOK_SKIP: '1' };

  for (const cwd of [rootDir, packageDir]) {
    const result = runHook(CODEX_PRE_TOOL_USE, { cwd, input: editPayload(cwd), env });
    assert.equal(result.status, 0, `${cwd}: ${result.stderr}`);
    JSON.parse(result.stdout);
  }
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);
});

test('outside a git repository the hook commands skip the walk and run the local Veritas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-no-git-'));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'no-git', version: '1.0.0' })}\n`);
  installLocalVeritasBin(dir);
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: dir, input: JSON.stringify({ cwd: dir, tool_name: 'Bash', tool_input: { command: 'ls' } }) });
  assert.equal(result.status, 0, result.stderr);
  JSON.parse(result.stdout);
});

test('the Codex PreToolUse hook carries the plain invocation for Windows, where hooks run through PowerShell', () => {
  const handler = codexHooks.PreToolUse[0].hooks[0];
  assert.equal(handler.commandWindows, 'npx --no @kontourai/veritas hooks codex pre-tool-use');
  // Windows is not exercised here; the same invocation run from the root reaches Veritas.
  const { rootDir } = pnpmWorkspace({ installVeritas: true });
  const result = runHook(handler.commandWindows, { cwd: rootDir, input: editPayload(rootDir), env: { VERITAS_HOOK_SKIP: '1' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);
});
