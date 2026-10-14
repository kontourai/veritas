import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeBootstrapStarterKit } from '../../src/index.mjs';
import { CLAUDE_CODE_SESSION_END_MARKER, buildSuggestedClaudeCodePostSessionHook, buildSuggestedClaudeCodePreToolUseHook, buildSuggestedStopHook } from '../../src/hooks/suggestions.mjs';
import { buildSuggestedCodexHookConfig } from '../../src/integrations/codex-hooks.mjs';
import { PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS } from '../../src/hooks/claude-code-hook-history.mjs';
import { cleanGitEnv, commitAll, initCommittedRepo, installLocalVeritasBin, parseCliJson, repoRootDir } from '../helpers.mjs';
import { tempDir } from '../temp-dir.mjs';

const tempDirFor = (t) => tempDir(t, 'veritas-session-end-elsewhere-');

const CLI = join(repoRootDir, 'bin/veritas.mjs');
// The exact file v1.11.2 wrote: its own applyClaudeCodePostSessionHook over a settings file that
// already held the user's SessionEnd handler below. v0.5.0 through v1.11.1 wrote the same key.
const V1_11_2_SETTINGS = new URL('../fixtures/claude-code-settings-upgrade/v1.11.2.settings.json', import.meta.url);
const USER_SESSION_END = './scripts/archive-transcript.sh';

// Hook event names each runtime documents, pinned here independently of the code under test.
// Claude Code: https://code.claude.com/docs/en/hooks (checked 2026-10-14, Claude Code 2.1.296).
const CLAUDE_CODE_EVENTS = new Set([
  'SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse', 'PermissionRequest',
  'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification', 'MessageDisplay',
  'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure', 'TeammateIdle',
  'InstructionsLoaded', 'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate',
  'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'Elicitation',
  'ElicitationResult', 'SessionEnd',
]);
// Codex: https://learn.chatgpt.com/docs/hooks (checked 2026-10-14, codex-cli 0.162.1).
const CODEX_EVENTS = new Set([
  'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'UserPromptSubmit',
  'SubagentStop', 'Stop', 'Interrupt', 'SessionStart', 'SubagentStart', 'SessionEnd',
]);

function bootstrapRepo(t, prefix) {
  const rootDir = initCommittedRepo(t, prefix);
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2)}\n`);
  writeBootstrapStarterKit({ rootDir, projectName: 'session-end-fixture', evidenceCheck: 'npm test', force: true });
  commitAll(rootDir, 'Bootstrap Veritas');
  installLocalVeritasBin(rootDir);
  return rootDir;
}

function veritas(rootDir, args) {
  return parseCliJson(execFileSync('node', [CLI, ...args, '--root', rootDir], { cwd: rootDir, encoding: 'utf8', env: cleanGitEnv() }));
}

// A Claude Code transcript line carries these fields next to type and message.
function claudeTranscript(dir) {
  const path = join(dir, 'transcript.jsonl');
  const common = { sessionId: 'session-end-fixture', cwd: dir, version: '2.1.296', isSidechain: false, userType: 'external' };
  const lines = [
    { ...common, type: 'assistant', uuid: 'a1', parentUuid: null, timestamp: '2026-10-14T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npx --no @kontourai/veritas readiness --working-tree' } }] } },
    { ...common, type: 'user', uuid: 'u1', parentUuid: 'a1', timestamp: '2026-10-14T00:00:10.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'FAIL  rule-a: broken' }] }] } },
    { ...common, type: 'assistant', uuid: 'a2', parentUuid: 'u1', timestamp: '2026-10-14T00:01:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'npx --no @kontourai/veritas readiness --working-tree' } }] } },
    { ...common, type: 'user', uuid: 'u2', parentUuid: 'a2', timestamp: '2026-10-14T00:01:10.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'PASS  rule-a: fixed' }] }] } },
    { ...common, type: 'assistant', uuid: 'a3', parentUuid: 'u2', timestamp: '2026-10-14T00:02:00.000Z', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return path;
}

function sessionEndCommands(settings) {
  return (settings.hooks?.SessionEnd ?? []).flatMap((group) => group.hooks.map((hook) => hook.command));
}

test('the installed Claude Code SessionEnd hook reads transcript_path from its input and writes a draft', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-capture-');
  veritas(rootDir, ['integrations', 'claude-code', 'install']);
  const settings = JSON.parse(readFileSync(join(rootDir, '.claude/settings.json'), 'utf8'));
  const [command] = sessionEndCommands(settings);
  assert.ok(command, 'install writes a SessionEnd handler');

  // Run the configured command the way Claude Code does: through a shell, in the working directory,
  // with the documented SessionEnd input on stdin and no Veritas or transcript variables set.
  const env = cleanGitEnv();
  delete env.VERITAS_SESSION_LOG_PATH;
  const transcriptPath = claudeTranscript(rootDir);
  const result = spawnSync('sh', ['-c', command], {
    cwd: rootDir,
    encoding: 'utf8',
    env,
    input: JSON.stringify({ session_id: 'session-end-fixture', transcript_path: transcriptPath, cwd: rootDir, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }),
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.reader, 'claude-code');
  const draft = JSON.parse(readFileSync(join(rootDir, output.artifactPath), 'utf8'));
  assert.equal(draft.prefilled_measurements.time_to_green_minutes, 1);
});

test('the SessionEnd hook reports a missing transcript without failing or writing a draft', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-missing-');
  const [command] = sessionEndCommands(buildSuggestedClaudeCodePostSessionHook().toolConfig);
  for (const input of ['{}', JSON.stringify({ transcript_path: join(rootDir, 'gone.jsonl') })]) {
    const result = spawnSync('sh', ['-c', command], { cwd: rootDir, encoding: 'utf8', env: cleanGitEnv(), input });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /no standards feedback draft captured/);
    assert.equal(existsSync(join(rootDir, '.kontourai/veritas/standards-feedback-drafts')), false);
  }
});

test('reinstalling Claude Code over v1.11.2 moves the capture to SessionEnd and keeps the user handlers', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-upgrade-');
  mkdirSync(join(rootDir, '.claude'), { recursive: true });
  const settingsPath = join(rootDir, '.claude/settings.json');
  copyFileSync(V1_11_2_SETTINGS, settingsPath);
  const before = JSON.parse(readFileSync(settingsPath, 'utf8'));
  // The fixture really holds a recorded earlier command under PostSession.
  assert.ok(before.hooks.PostSession.flatMap((group) => group.hooks).some((hook) => PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS.includes(hook.command)));
  assert.deepEqual(sessionEndCommands(before), [USER_SESSION_END]);
  // A PostSession handler that cannot run does not count as a configured capture.
  assert.equal(veritas(rootDir, ['integrations', 'claude-code', 'status']).settings.postSessionConfigured, false);

  const [current] = sessionEndCommands(buildSuggestedClaudeCodePostSessionHook().toolConfig);
  for (const run of [1, 2]) {
    veritas(rootDir, ['integrations', 'claude-code', 'install', '--force']);
    const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(Object.hasOwn(after.hooks, 'PostSession'), false, `run ${run}: PostSession is removed`);
    assert.deepEqual(sessionEndCommands(after), [USER_SESSION_END, current], `run ${run}: one Veritas SessionEnd handler after the user's own`);
  }
  assert.equal(veritas(rootDir, ['integrations', 'claude-code', 'status']).settings.postSessionConfigured, true);
});

test('a PostSession handler Veritas did not write is kept on reinstall', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-user-postsession-');
  mkdirSync(join(rootDir, '.claude'), { recursive: true });
  const settingsPath = join(rootDir, '.claude/settings.json');
  const fixture = JSON.parse(readFileSync(V1_11_2_SETTINGS, 'utf8'));
  fixture.hooks.PostSession[0].hooks.push({ type: 'command', command: './scripts/user-post-session.sh' });
  writeFileSync(settingsPath, `${JSON.stringify(fixture, null, 2)}\n`);
  veritas(rootDir, ['integrations', 'claude-code', 'install', '--force']);
  const after = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(after.hooks.PostSession.flatMap((group) => group.hooks.map((hook) => hook.command)), ['./scripts/user-post-session.sh']);
});

test('every hook event Veritas writes is one the runtime documents', () => {
  const claude = [
    buildSuggestedClaudeCodePostSessionHook(),
    buildSuggestedClaudeCodePreToolUseHook(),
    buildSuggestedStopHook({ tool: 'claude-code' }),
  ].flatMap((suggestion) => Object.keys(suggestion.toolConfig.hooks));
  assert.deepEqual(claude.filter((event) => !CLAUDE_CODE_EVENTS.has(event)), []);
  assert.ok(claude.includes('SessionEnd'));
  const codex = Object.keys(buildSuggestedCodexHookConfig().hooks);
  assert.deepEqual(codex.filter((event) => !CODEX_EVENTS.has(event)), []);
});

function runSessionEnd(rootDir, input, env = {}) {
  const [command] = sessionEndCommands(buildSuggestedClaudeCodePostSessionHook().toolConfig);
  const base = cleanGitEnv();
  delete base.VERITAS_SESSION_LOG_PATH;
  return spawnSync('sh', ['-c', command], { cwd: rootDir, encoding: 'utf8', env: { ...base, ...env }, input: JSON.stringify(input) });
}

const draftsDir = (rootDir) => join(rootDir, '.kontourai/veritas/standards-feedback-drafts');

test('an unreadable or malformed transcript is reported on stderr and the hook still exits 0', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-unreadable-');
  const malformed = claudeTranscript(rootDir);
  const lines = readFileSync(malformed, 'utf8').trimEnd().split('\n');
  lines.splice(1, 0, '{"type":"user","message":');
  writeFileSync(malformed, `${lines.join('\n')}\n`);
  const directory = join(rootDir, 'transcript-dir.jsonl');
  mkdirSync(directory);
  const cases = [['a malformed line before the last', malformed], ['a directory', directory]];
  if (process.getuid?.() !== 0) {
    const locked = join(rootDir, 'locked.jsonl');
    writeFileSync(locked, readFileSync(claudeTranscript(tempDirFor(t)), 'utf8'));
    chmodSync(locked, 0o000);
    cases.push(['a file it may not read', locked]);
  }
  for (const [name, transcriptPath] of cases) {
    const result = runSessionEnd(rootDir, { transcript_path: transcriptPath, hook_event_name: 'SessionEnd', reason: 'other' });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.match(result.stderr, /could not read session log .*no standards feedback draft captured/, name);
    assert.equal(existsSync(draftsDir(rootDir)), false, `${name}: no draft`);
  }
});

test('a truncated final transcript line is skipped and the draft keeps the lines before it', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-truncated-');
  const transcriptPath = claudeTranscript(rootDir);
  // The runtime was still writing the last line: no closing brace and no newline.
  writeFileSync(transcriptPath, `${readFileSync(transcriptPath, 'utf8')}{"type":"assistant","message":{"content":[{"type":"te`);
  const result = runSessionEnd(rootDir, { transcript_path: transcriptPath, hook_event_name: 'SessionEnd', reason: 'other' });
  assert.equal(result.status, 0, result.stderr);
  const draft = JSON.parse(readFileSync(join(rootDir, JSON.parse(result.stdout).artifactPath), 'utf8'));
  assert.equal(draft.prefilled_measurements.time_to_green_minutes, 1);
});

test('VERITAS_SESSION_LOG_PATH takes precedence over the transcript_path in the hook input', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-override-');
  const override = claudeTranscript(tempDirFor(t));
  const result = runSessionEnd(rootDir, { transcript_path: join(rootDir, 'not-this.jsonl'), hook_event_name: 'SessionEnd', reason: 'other' }, { VERITAS_SESSION_LOG_PATH: override });
  assert.equal(result.status, 0, result.stderr);
  const draft = JSON.parse(readFileSync(join(rootDir, JSON.parse(result.stdout).artifactPath), 'utf8'));
  assert.equal(realpathSync(resolve(rootDir, draft.session_log_path)), realpathSync(override));
});

test('a reinstall replaces a SessionEnd capture any Veritas wrote and keeps a user handler that mentions the marker', (t) => {
  const rootDir = bootstrapRepo(t, 'veritas-session-end-marker-');
  mkdirSync(join(rootDir, '.claude'), { recursive: true });
  const settingsPath = join(rootDir, '.claude/settings.json');
  // An earlier Veritas capture command: a different command, ending with the same marker.
  const earlier = `npx --no @kontourai/veritas hooks claude-code session-end ${CLAUDE_CODE_SESSION_END_MARKER}`;
  const userMention = `echo '${CLAUDE_CODE_SESSION_END_MARKER}' >> session-ends.log; true`;
  writeFileSync(settingsPath, `${JSON.stringify({ hooks: { SessionEnd: [
    { matcher: '.*', hooks: [{ type: 'command', command: earlier, timeout: 60 }] },
    { matcher: '', hooks: [{ type: 'command', command: userMention }] },
  ] } }, null, 2)}\n`);
  const [current] = sessionEndCommands(buildSuggestedClaudeCodePostSessionHook().toolConfig);
  assert.notEqual(current, earlier);
  veritas(rootDir, ['integrations', 'claude-code', 'install', '--force']);
  assert.deepEqual(sessionEndCommands(JSON.parse(readFileSync(settingsPath, 'utf8'))), [userMention, current]);
});

test('a reinstall removes every PostSession command an earlier release wrote', (t) => {
  for (const [index, command] of PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS.entries()) {
    const rootDir = bootstrapRepo(t, `veritas-session-end-history-${index}-`);
    mkdirSync(join(rootDir, '.claude'), { recursive: true });
    const settingsPath = join(rootDir, '.claude/settings.json');
    writeFileSync(settingsPath, `${JSON.stringify({ hooks: { PostSession: [{ matcher: '.*', hooks: [{ type: 'command', command, timeout: 60 }] }] } }, null, 2)}\n`);
    veritas(rootDir, ['integrations', 'claude-code', 'install', '--force']);
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks, 'PostSession'), false, command);
  }
});
