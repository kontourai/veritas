import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { writeBootstrapStarterKit } from '../src/index.mjs';
import { buildSuggestedCodexHookConfig } from '../src/integrations/codex-hooks.mjs';
import { buildClaudeCodeSessionLogCaptureCommand, buildSuggestedClaudeCodePreToolUseHook, buildSuggestedGitHook, buildSuggestedRuntimeHook, buildSuggestedStopHook } from '../src/hooks/suggestions.mjs';
import { cleanGitEnv, commitAll, disableGitAutoMaintenance, initCommittedRepo, installLocalVeritasBin, repoRootDir } from './helpers.mjs';
import { tempDir } from './temp-dir.mjs';

// Agent runtimes run these hook commands in the agent's working directory. In a pnpm workspace
// that can be packages/a, a package with its own package.json and no Veritas of its own: npx looks
// only under the nearest package root, so a bare `npx --no @kontourai/veritas` refuses there.
const codexHooks = buildSuggestedCodexHookConfig().hooks;
const CODEX_PRE_TOOL_USE = codexHooks.PreToolUse[0].hooks[0].command;
const CLAUDE_SESSION_END = buildClaudeCodeSessionLogCaptureCommand();

function pnpmWorkspace(t, { installVeritas }) {
  const rootDir = initCommittedRepo(t, 'veritas-nested-package-');
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

function runHook(command, { cwd, input = '', env = {}, timeout }) {
  const result = spawnSync('sh', ['-c', command], {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...cleanGitEnv(), ...env },
    ...(timeout ? { timeout, killSignal: 'SIGKILL' } : {}),
  });
  return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
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

const editPayload = (cwd) => JSON.stringify({
  cwd,
  tool_name: 'apply_patch',
  tool_input: { command: ['*** Begin Patch', '*** Update File: packages/a/index.js', '@@', '-old', '+new', '*** End Patch'].join('\n') },
});

test('Codex and Claude Code hook commands find a root-installed Veritas from a nested package', (t) => {
  const { rootDir, packageDir } = pnpmWorkspace(t, { installVeritas: true });

  // PreToolUse: VERITAS_HOOK_SKIP makes Veritas record the bypass under the root it resolved, which
  // proves the command reached Veritas from packages/a and evaluated the root's governance.
  const preToolUse = runHook(CODEX_PRE_TOOL_USE, { cwd: packageDir, input: editPayload(packageDir), env: { VERITAS_HOOK_SKIP: '1' } });
  assert.equal(preToolUse.status, 0, preToolUse.stderr);
  assert.doesNotMatch(preToolUse.stderr, /npx canceled/);
  JSON.parse(preToolUse.stdout);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);

  // Claude Code SessionEnd capture runs in the working directory, as before, and writes its draft
  // there. Claude Code names the session log in the hook input on stdin.
  const sessionEnd = runHook(CLAUDE_SESSION_END, {
    cwd: packageDir,
    input: JSON.stringify({ session_id: 'nested-package', transcript_path: claudeSessionLog(packageDir), cwd: packageDir, hook_event_name: 'SessionEnd', reason: 'other' }),
  });
  assert.equal(sessionEnd.status, 0, `Claude Code SessionEnd: ${sessionEnd.stderr}`);
  assert.doesNotMatch(sessionEnd.stderr, /npx canceled/);
  const result = JSON.parse(sessionEnd.stdout);
  assert.equal(existsSync(join(packageDir, result.artifactPath)), true, 'Claude Code SessionEnd draft');
});

test('the nested-package hook commands still refuse when no directory has Veritas installed', (t) => {
  const { packageDir } = pnpmWorkspace(t, { installVeritas: false });
  const cache = tempDir(t, 'veritas-empty-npm-cache-');
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: packageDir, input: editPayload(packageDir), env: { npm_config_cache: cache } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npx canceled due to missing packages/);
  assert.equal(existsSync(join(packageDir, 'node_modules')), false);
  assert.equal(readFileSync(join(packageDir, 'package.json'), 'utf8').includes('veritas'), false);
});

// A package laid out like Veritas that announces itself instead of running Veritas, so a test can
// tell whether it ran. It has the same entry point, so the walk would accept it if it reached it.
function plantedVeritas(dir, marker) {
  const packageDir = join(dir, 'planted-veritas');
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({ name: '@kontourai/veritas', version: '0.0.0-planted', type: 'module', bin: { veritas: 'bin/veritas.mjs' } })}\n`);
  writeFileSync(join(packageDir, 'bin/veritas.mjs'), `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  chmodSync(join(packageDir, 'bin/veritas.mjs'), 0o755);
  return packageDir;
}

// Veritas installed the way `npm install --no-bin-links` (or bin-links=false) leaves it: the package
// is under node_modules, with no node_modules/.bin/veritas link.
function installVeritasWithoutBinLink(dir, packageDir = repoRootDir) {
  mkdirSync(join(dir, 'node_modules/@kontourai'), { recursive: true });
  symlinkSync(packageDir, join(dir, 'node_modules/@kontourai/veritas'), 'dir');
}

// An executable named veritas that records that it ran, standing in for another veritas on PATH,
// such as a global install of the unrelated unscoped package.
function veritasOnPath(t) {
  const binDir = tempDir(t, 'veritas-other-on-path-');
  const marker = join(binDir, 'other-ran');
  writeFileSync(join(binDir, 'veritas'), `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`);
  chmodSync(join(binDir, 'veritas'), 0o755);
  return { binDir, marker };
}

const bashPayload = (cwd) => JSON.stringify({ cwd, tool_name: 'Bash', tool_input: { command: 'ls' } });

// A parent directory, outside any repository, with a planted Veritas install, and a git repository
// inside it with a package.json and no install of its own.
function plantedParent(t, { withPackageJson = true, repoName = 'repo' } = {}) {
  const parent = tempDir(t, 'veritas-planted-parent-');
  const marker = join(parent, 'planted-ran');
  const planted = plantedVeritas(parent, marker);
  mkdirSync(join(parent, 'node_modules/@kontourai'), { recursive: true });
  mkdirSync(join(parent, 'node_modules/.bin'), { recursive: true });
  symlinkSync(planted, join(parent, 'node_modules/@kontourai/veritas'), 'dir');
  symlinkSync('../@kontourai/veritas/bin/veritas.mjs', join(parent, 'node_modules/.bin/veritas'));
  const repo = join(parent, repoName);
  mkdirSync(join(repo, 'sub'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: repo, env: cleanGitEnv() });
  if (withPackageJson) writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'repo', version: '1.0.0' })}\n`);
  return { parent, repo, marker, cache: tempDir(t, 'veritas-empty-npm-cache-') };
}

function assertRefusedWithoutPlanted(result, marker) {
  assert.equal(existsSync(marker), false, `the planted parent package must not run:\n${result.stderr}`);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /npx canceled due to missing packages/);
}

test('the walk stops at the git root, so a node_modules planted in a parent outside the repository never runs', (t) => {
  const { repo, marker, cache } = plantedParent(t);
  // PWD is the logical path a shell that cd'd there would pass on. On macOS the temporary directory
  // sits behind a symlink, so the walk must use physical paths to reach git's root.
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: repo, input: editPayload(repo), env: { npm_config_cache: cache, PWD: repo } });
  assertRefusedWithoutPlanted(result, marker);
});

test('the git root is matched by identity when the working directory is typed in another case', (t) => {
  const { rootDir, packageDir } = pnpmWorkspace(t, { installVeritas: true });
  // The repository root itself is typed in another case: git reports it in its canonical case,
  // while the typed path keeps the case it was entered in. A string compare never matches, the walk
  // never reaches the root, and the root install is lost.
  const typedRoot = join(dirname(rootDir), basename(rootDir).toUpperCase());
  assert.notEqual(typedRoot, rootDir);
  if (!existsSync(typedRoot)) {
    t.skip('case-sensitive filesystem: a case-mismatched path cannot name the repository');
    return;
  }
  const typed = join(typedRoot, 'packages', 'a');
  assert.equal(existsSync(join(packageDir, 'package.json')), true);
  const found = runHook(CODEX_PRE_TOOL_USE, { cwd: typed, input: editPayload(typed), env: { VERITAS_HOOK_SKIP: '1', PWD: typed } });
  assert.equal(found.status, 0, found.stderr);
  assert.doesNotMatch(found.stderr, /npx canceled/);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);

  // And a case-mismatched path still never lets a planted parent run.
  const { parent, marker, cache } = plantedParent(t, { repoName: 'victim' });
  const victim = join(parent, 'VICTIM', 'SUB');
  const refused = runHook(CODEX_PRE_TOOL_USE, { cwd: victim, input: editPayload(victim), env: { npm_config_cache: cache, PWD: victim } });
  assertRefusedWithoutPlanted(refused, marker);
});

test('a GIT_DIR and GIT_WORK_TREE naming another repository do not let the walk escape', (t) => {
  const { repo, marker, cache } = plantedParent(t);
  const other = tempDir(t, 'veritas-other-repo-');
  spawnSync('git', ['init', '-q'], { cwd: other, env: cleanGitEnv() });
  const result = runHook(CODEX_PRE_TOOL_USE, {
    cwd: repo,
    input: editPayload(repo),
    env: { npm_config_cache: cache, GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other },
  });
  assertRefusedWithoutPlanted(result, marker);
});

test('outside a git repository the walk runs no install it found, so a planted parent never runs', (t) => {
  const { parent, marker, cache } = plantedParent(t);
  const dir = join(parent, 'not-a-repo');
  mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'not-a-repo', version: '1.0.0' })}\n`);
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: dir, input: editPayload(dir), env: { npm_config_cache: cache } });
  assertRefusedWithoutPlanted(result, marker);
});

// Stated limit, pinned so it stays visible: in a repository with no package.json, plain npx does
// npm's own upward search for the nearest package.json or node_modules, which can pass the git
// root. The walk does not widen this; it is npm's behaviour, and the released spelling did the same.
test('stated limit: a repository with no package.json gets npm\'s own upward search past the git root', (t) => {
  const { repo, marker, cache } = plantedParent(t, { withPackageJson: false });
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: repo, input: editPayload(repo), env: { npm_config_cache: cache } });
  assert.equal(existsSync(marker), true, `npm's upward search is expected to reach the planted parent:\n${result.stderr}`);
});

test('the walk follows physical paths, so a symlinked entry into a nested package still finds the root install', (t) => {
  const { rootDir, packageDir } = pnpmWorkspace(t, { installVeritas: true });
  const outside = tempDir(t, 'veritas-symlinked-entry-');
  const entry = join(outside, 'entry');
  symlinkSync(packageDir, entry, 'dir');
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: entry, input: editPayload(entry), env: { VERITAS_HOOK_SKIP: '1', PWD: entry } });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /npx canceled/);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);
});

test('with no local install the hook commands fall back to a global Veritas', (t) => {
  const { rootDir, packageDir } = pnpmWorkspace(t, { installVeritas: false });
  // A global install the way `npm install -g` lays it out under a prefix.
  const globalPrefix = tempDir(t, 'veritas-global-prefix-');
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

test('outside a git repository the hook commands skip the walk and run the local Veritas', (t) => {
  const dir = tempDir(t, 'veritas-no-git-');
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'no-git', version: '1.0.0' })}\n`);
  installLocalVeritasBin(dir);
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: dir, input: JSON.stringify({ cwd: dir, tool_name: 'Bash', tool_input: { command: 'ls' } }) });
  assert.equal(result.status, 0, result.stderr);
  JSON.parse(result.stdout);
});

test('the Codex PreToolUse hook carries the plain invocation for Windows, where hooks run through PowerShell', (t) => {
  const handler = codexHooks.PreToolUse[0].hooks[0];
  assert.equal(handler.commandWindows, 'npx --no @kontourai/veritas hooks codex pre-tool-use');
  // Windows is not exercised here; the same invocation run from the root reaches Veritas.
  const { rootDir } = pnpmWorkspace(t, { installVeritas: true });
  const result = runHook(handler.commandWindows, { cwd: rootDir, input: editPayload(rootDir), env: { VERITAS_HOOK_SKIP: '1' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);
});

// The walk must end on its own. A hang here would stall every agent edit, so these fail fast.
const WALK_TIMEOUT_MS = 20_000;

test('the walk ends when the working directory has been deleted', (t) => {
  // The deleted directory gets a parent of its own. On macOS, every process that asks for a deleted
  // working directory (git, the shell's pwd, node behind npx) takes time that grows with the number
  // of entries in its former parent: about 0.2 s per call at 100,000 entries, against 10 ms when the
  // parent is empty. The shared temporary directory holds every test's leftovers, so deleting there
  // made this test slow in proportion to the host's history, and it timed out under load.
  const parent = tempDir(t, 'veritas-deleted-cwd-');
  const dir = join(parent, 'cwd');
  mkdirSync(dir);
  const result = runHook(`cd "${dir}" && rmdir "${dir}" && ${CODEX_PRE_TOOL_USE}`, {
    cwd: parent,
    input: editPayload(dir),
    timeout: WALK_TIMEOUT_MS,
  });
  assert.equal(result.signal, null, `the hook command did not terminate within ${WALK_TIMEOUT_MS} ms`);
  // With no working directory there is nothing to walk; plain npx reports the missing directory.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /process\.cwd failed|uv_cwd|ENOENT/);
});

test('the walk ends from a working directory whose path is longer than 1024 bytes', (t) => {
  const base = tempDir(t, 'veritas-deep-cwd-');
  const level = 'd'.repeat(100);
  // Built with relative steps: an absolute path this long is past macOS's PATH_MAX for most calls.
  const descend = Array.from({ length: 11 }, () => `mkdir ${level} && cd ${level}`).join(' && ');
  try {
    const result = runHook(`${descend} && [ "$(pwd -P | wc -c)" -gt 1024 ] && ${CODEX_PRE_TOOL_USE}`, {
      cwd: base,
      input: editPayload(base),
      env: { npm_config_cache: tempDir(t, 'veritas-empty-npm-cache-') },
      timeout: WALK_TIMEOUT_MS,
    });
    assert.equal(result.signal, null, `the hook command did not terminate within ${WALK_TIMEOUT_MS} ms`);
    // The walk ended and the command reached plain npx. Nothing is installed on the path, so npx
    // refuses; on macOS, Node itself cannot read a working directory this long and stops first.
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npx canceled due to missing packages|process\.cwd failed/);
  } finally {
    spawnSync('rm', ['-rf', base]);
  }
});

// On Linux CI the case-mismatch test skips, so this exercises the identity match there: git names
// the root with a `/./` segment, the same directory under a different string.
test('the git root is matched by identity when git spells it differently', (t) => {
  const { rootDir, packageDir } = pnpmWorkspace(t, { installVeritas: true });
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(realGit, 'git must be on PATH');
  const fakeBin = tempDir(t, 'veritas-fake-git-');
  const spelledRoot = `${realpathSync(rootDir)}/.`;
  writeFileSync(join(fakeBin, 'git'), [
    '#!/bin/sh',
    `if [ "$1" = rev-parse ] && [ "$2" = --show-toplevel ]; then echo ${JSON.stringify(spelledRoot)}; exit 0; fi`,
    `exec ${JSON.stringify(realGit)} "$@"`,
    '',
  ].join('\n'));
  chmodSync(join(fakeBin, 'git'), 0o755);

  const result = runHook(CODEX_PRE_TOOL_USE, {
    cwd: packageDir,
    input: editPayload(packageDir),
    env: { PATH: `${fakeBin}:${process.env.PATH}`, VERITAS_HOOK_SKIP: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /npx canceled/);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);
});

// #286: npx --prefix decides only whether npx treats the package as installed, and the binary npx
// runs is the first veritas on a PATH built from the working directory's ancestors. The walk runs
// the install it found by path, so a missing .bin link cannot hand the hook to another veritas.
test('an install without a .bin link runs itself, not a .bin/veritas in a parent outside the repository', (t) => {
  const { repo, marker } = plantedParent(t);
  installVeritasWithoutBinLink(repo);
  for (const cwd of [repo, join(repo, 'sub')]) {
    const result = runHook(CODEX_PRE_TOOL_USE, { cwd, input: bashPayload(cwd) });
    assert.equal(existsSync(marker), false, `${cwd}: the parent's .bin/veritas ran instead of the repository's install:\n${result.stderr}`);
    assert.equal(result.status, 0, `${cwd}: ${result.stderr}`);
    JSON.parse(result.stdout);
  }
});

test('an install without a .bin link runs itself, not another veritas on PATH', (t) => {
  const repo = tempDir(t, 'veritas-no-bin-link-');
  spawnSync('git', ['init', '-q'], { cwd: repo, env: cleanGitEnv() });
  disableGitAutoMaintenance(repo);
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'repo', version: '1.0.0' })}\n`);
  mkdirSync(join(repo, 'sub'));
  installVeritasWithoutBinLink(repo);
  const other = veritasOnPath(t);
  for (const cwd of [repo, join(repo, 'sub')]) {
    const result = runHook(CODEX_PRE_TOOL_USE, { cwd, input: bashPayload(cwd), env: { PATH: `${other.binDir}:${process.env.PATH}` } });
    assert.equal(existsSync(other.marker), false, `${cwd}: another veritas on PATH ran instead of the repository's install:\n${result.stderr}`);
    assert.equal(result.status, 0, `${cwd}: ${result.stderr}`);
    JSON.parse(result.stdout);
  }
});

const rootScriptCases = [
  { name: 'post-commit initial history', body: () => buildSuggestedGitHook(), args: [], expectedArgs: (repo) => ['readiness', '--changed-from', spawnSync('git', ['hash-object', '-t', 'tree', '/dev/null'], { cwd: repo, encoding: 'utf8', env: cleanGitEnv() }).stdout.trim(), '--changed-to', 'HEAD'], exit: 7 },
  { name: 'post-commit with parent commit', body: () => buildSuggestedGitHook(), commits: 2, args: [], expectedArgs: () => ['readiness', '--changed-from', 'HEAD~1', '--changed-to', 'HEAD'], exit: 7 },
  { name: 'runtime default', body: () => buildSuggestedRuntimeHook(), args: [], expectedArgs: () => ['readiness', '--format', 'json', '--working-tree'], exit: 0 },
  { name: 'runtime forwarded arguments', body: () => buildSuggestedRuntimeHook(), args: ['--check', 'repo standards'], expectedArgs: () => ['readiness', '--format', 'json', '--check', 'repo standards'], exit: 7 },
  { name: 'Stop feedback', body: () => buildSuggestedStopHook().hookBody, args: [], expectedArgs: () => ['readiness', '--format', 'feedback', '--working-tree'], exit: 7, expectedExit: 0 },
  { name: 'Claude PreToolUse', body: () => buildSuggestedClaudeCodePreToolUseHook().hookBody, args: ['--root', 'root with spaces'], expectedArgs: () => ['hooks', 'claude-code', 'pre-tool-use', '--root', 'root with spaces'], exit: 2 },
];

for (const foreign of ['parent .bin', 'PATH']) {
  for (const script of rootScriptCases) {
    test(`root-script ${script.name} runs its local entry without bin links instead of ${foreign}`, (t) => {
      const planted = foreign === 'parent .bin' ? plantedParent(t) : null;
      const repo = planted?.repo ?? initCommittedRepo(t, 'veritas-root-script-');
      if (!planted) writeFileSync(join(repo, 'package.json'), '{"name":"root-script-fixture","version":"1.0.0"}\n');
      for (const [key, value] of [['user.name', 'Veritas Tests'], ['user.email', 'tests@example.com']]) {
        const configured = spawnSync('git', ['config', key, value], { cwd: repo, encoding: 'utf8', env: cleanGitEnv() });
        assert.equal(configured.status, 0, configured.stderr);
      }
      if (planted) commitAll(repo, 'Initial root-script fixture');
      for (let index = 0; index < (script.commits ?? 0); index += 1) {
        writeFileSync(join(repo, 'commit.txt'), String(index));
        commitAll(repo, `Fixture commit ${index}`);
      }
      const calls = join(repo, 'selected-entry.jsonl');
      const local = join(repo, 'node_modules/@kontourai/veritas');
      mkdirSync(join(local, 'bin'), { recursive: true });
      writeFileSync(join(local, 'package.json'), '{"name":"@kontourai/veritas","version":"0.0.0-fixture","type":"module","bin":{"veritas":"bin/veritas.mjs"}}\n');
      writeFileSync(join(local, 'bin/veritas.mjs'), `import { appendFileSync, readFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), input: readFileSync(0, 'utf8') }) + '\\n');\nconsole.log('fixture readiness failure');\nprocess.exit(${script.exit});\n`);
      const other = foreign === 'PATH' ? veritasOnPath(t) : null;
      const hook = join(repo, 'generated-root-hook.sh');
      writeFileSync(hook, script.body());
      chmodSync(hook, 0o755);
      const input = '{"tool_input":{"text":"literal $(echo source)"}}\n';
      const result = spawnSync(hook, script.args, { cwd: repo, input, encoding: 'utf8', env: { ...cleanGitEnv(), ...(other ? { PATH: `${other.binDir}:${process.env.PATH}` } : {}) } });
      assert.equal(existsSync(planted?.marker ?? other.marker), false, `${script.name}: foreign ${foreign} executable ran:\n${result.stderr}`);
      assert.equal(result.status, script.expectedExit ?? script.exit, result.stderr);
      const invocations = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(invocations, [{ args: script.expectedArgs(repo), input }], 'the selected entry receives stdin and argv exactly once');
      if (script.name === 'Stop feedback') assert.match(result.stdout, /fixture readiness failure[\s\S]*address the FAIL lines/);
    });
  }
}

test('root-script runtime outside Git retains the npm-selected local fallback', (t) => {
  const dir = tempDir(t, 'veritas-runtime-no-git-');
  writeFileSync(join(dir, 'package.json'), '{"name":"runtime-no-git","version":"1.0.0"}\n');
  installLocalVeritasBin(dir);
  const script = join(dir, 'runtime.sh');
  writeFileSync(script, buildSuggestedRuntimeHook());
  chmodSync(script, 0o755);
  const result = spawnSync(script, ['--help'], { cwd: dir, encoding: 'utf8', env: cleanGitEnv() });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:[\s\S]*veritas/);
});

// The file the walk checks is the file it runs: a Veritas package directory without the entry point
// does not count as an install, and the walk goes on to the next one.
test('a Veritas package without its entry point does not count as an install', (t) => {
  const { rootDir, packageDir } = pnpmWorkspace(t, { installVeritas: true });
  mkdirSync(join(packageDir, 'node_modules/@kontourai/veritas'), { recursive: true });
  writeFileSync(join(packageDir, 'node_modules/@kontourai/veritas/package.json'), `${JSON.stringify({ name: '@kontourai/veritas', version: '0.0.0-no-entry' })}\n`);
  const result = runHook(CODEX_PRE_TOOL_USE, { cwd: packageDir, input: editPayload(packageDir), env: { VERITAS_HOOK_SKIP: '1' } });
  assert.equal(result.status, 0, result.stderr);
  JSON.parse(result.stdout);
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl')), true);
});

// With installs in both packages/a and the root, the nearest one runs.
test('the walk runs the nearest install', (t) => {
  const { rootDir, packageDir } = pnpmWorkspace(t, { installVeritas: true });
  const marker = join(tempDir(t, 'veritas-nearest-marker-'), 'nearest-ran');
  installVeritasWithoutBinLink(packageDir, plantedVeritas(tempDir(t, 'veritas-nearest-install-'), marker));

  const fromRoot = runHook(CODEX_PRE_TOOL_USE, { cwd: rootDir, input: bashPayload(rootDir) });
  assert.equal(fromRoot.status, 0, fromRoot.stderr);
  JSON.parse(fromRoot.stdout);
  assert.equal(existsSync(marker), false, 'from the root, the root install runs');

  const fromPackage = runHook(CODEX_PRE_TOOL_USE, { cwd: packageDir, input: bashPayload(packageDir) });
  assert.equal(fromPackage.status, 0, fromPackage.stderr);
  assert.equal(existsSync(marker), true, `from packages/a, its own install runs:\n${fromPackage.stderr}`);
});
