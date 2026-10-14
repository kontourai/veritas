import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSuggestedCodexHookConfig } from '../src/integrations/codex-hooks.mjs';
import { PREVIOUS_CODEX_HOOK_COMMANDS } from '../src/integrations/codex-hook-history.mjs';
import { cleanGitEnv, initCommittedRepo, installLocalVeritasBin } from './helpers.mjs';

// The fixture is the exact file v1.11.0 wrote: its own applyCodexHook (src/integrations/
// codex-hooks.mjs at tag v1.11.0) with targetHooksFile, merged into a hooks file that already held
// the two user handlers below. Every release from v1.7.0 to v1.11.0 merges the same commands.
const OLD_ENGINE_HOOKS = new URL('./fixtures/codex-hooks-upgrade/v1.11.0.hooks.json', import.meta.url);
const USER_PRE_TOOL_USE = './scripts/check-owned-paths.sh';
const USER_POST_SESSION = './scripts/archive-session-log.sh';
// A user's own handler that runs Veritas: not written by Veritas, so never removed, even though it
// starts with a recorded command.
const USER_VERITAS_HANDLER = 'npm exec -- veritas hooks codex pre-tool-use --actor reviewer';

const commandsOf = (groups = []) => groups.flatMap((group) => group.hooks.map((hook) => hook.command));

function veritas(rootDir, args) {
  const result = spawnSync('npx', ['--no', '@kontourai/veritas', ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    input: '',
    env: cleanGitEnv(),
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test('reinstalling the Codex integration over an older engine leaves one Veritas handler per event', () => {
  const rootDir = initCommittedRepo('veritas-codex-hook-upgrade-');
  installLocalVeritasBin(rootDir);
  mkdirSync(join(rootDir, '.codex'), { recursive: true });
  const hooksPath = join(rootDir, '.codex/hooks.json');
  copyFileSync(OLD_ENGINE_HOOKS, hooksPath);
  const before = JSON.parse(readFileSync(hooksPath, 'utf8'));
  // The fixture really holds the recorded earlier commands, so the upgrade has something to replace.
  assert.ok(commandsOf(before.hooks.PreToolUse).includes(PREVIOUS_CODEX_HOOK_COMMANDS.PreToolUse[0]));
  assert.ok(commandsOf(before.hooks.PostSession).includes(PREVIOUS_CODEX_HOOK_COMMANDS.PostSession[0]));
  before.hooks.PreToolUse.push({ matcher: 'Write', hooks: [{ type: 'command', command: USER_VERITAS_HANDLER }] });
  writeFileSync(hooksPath, `${JSON.stringify(before, null, 2)}\n`);

  const current = buildSuggestedCodexHookConfig().hooks;
  const recorded = new Set(Object.values(PREVIOUS_CODEX_HOOK_COMMANDS).flat());
  const ours = new Set([...Object.values(current).flatMap(commandsOf), ...recorded]);
  const userGroups = Object.fromEntries(Object.entries(before.hooks).map(([event, groups]) => [
    event,
    groups.filter((group) => commandsOf([group]).every((command) => !ours.has(command))),
  ]));
  assert.deepEqual(commandsOf(userGroups.PreToolUse), [USER_PRE_TOOL_USE, USER_VERITAS_HANDLER]);
  assert.deepEqual(commandsOf(userGroups.PostSession), [USER_POST_SESSION]);

  for (const run of [1, 2]) {
    const install = veritas(rootDir, ['integrations', 'codex', 'install', '--force', '--target-hooks-file', '.codex/hooks.json']);
    assert.equal(install.status, 0, `install run ${run} failed:\n${install.output}`);
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8')).hooks;
    for (const event of Object.keys(current)) {
      const veritasCommands = commandsOf(hooks[event]).filter((command) => ours.has(command));
      assert.deepEqual(veritasCommands, commandsOf(current[event]), `run ${run}: ${event} must hold one current Veritas handler`);
      // The whole current handler is installed, including the Windows override.
      assert.deepEqual(hooks[event].flatMap((group) => group.hooks).filter((hook) => ours.has(hook.command)), current[event].flatMap((group) => group.hooks));
      // Every handler Veritas did not write survives unchanged, including one that runs Veritas.
      assert.deepEqual(hooks[event].filter((group) => commandsOf([group]).every((command) => !ours.has(command))), userGroups[event] ?? [], `run ${run}: ${event} user handlers`);
    }
  }

  const status = veritas(rootDir, ['integrations', 'codex', 'status', '--target-hooks-file', '.codex/hooks.json']);
  assert.match(status.output, /"integrationInstalled": true/);
});

test('a Veritas Codex handler without the current Windows override reads as not installed until reinstalled', () => {
  const rootDir = initCommittedRepo('veritas-codex-hook-windows-');
  installLocalVeritasBin(rootDir);
  mkdirSync(join(rootDir, '.codex'), { recursive: true });
  const hooksPath = join(rootDir, '.codex/hooks.json');
  const current = buildSuggestedCodexHookConfig();
  const withoutWindows = structuredClone(current);
  for (const group of withoutWindows.hooks.PreToolUse) for (const hook of group.hooks) delete hook.commandWindows;
  assert.ok(current.hooks.PreToolUse[0].hooks[0].commandWindows);
  writeFileSync(hooksPath, `${JSON.stringify(withoutWindows, null, 2)}\n`);

  const before = veritas(rootDir, ['integrations', 'codex', 'status', '--target-hooks-file', '.codex/hooks.json']);
  assert.match(before.output, /"integrationInstalled": false/);
  const install = veritas(rootDir, ['integrations', 'codex', 'install', '--force', '--target-hooks-file', '.codex/hooks.json']);
  assert.equal(install.status, 0, install.output);
  const hooks = JSON.parse(readFileSync(hooksPath, 'utf8')).hooks;
  assert.deepEqual(hooks.PreToolUse.flatMap((group) => group.hooks), current.hooks.PreToolUse[0].hooks);
  const after = veritas(rootDir, ['integrations', 'codex', 'status', '--target-hooks-file', '.codex/hooks.json']);
  assert.match(after.output, /"integrationInstalled": true/);
});
