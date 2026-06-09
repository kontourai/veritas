import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ClaudeCodeSessionLogReader,
  CodexSessionLogReader,
  observeSessionLogStandardsFeedback,
  writeBootstrapStarterKit,
} from '../../src/index.mjs';
import { commitAll, repoRootDir, initCommittedRepo, parseCliJson } from '../helpers.mjs';

function bootstrapRepo(prefix = 'veritas-claude-') {
  const rootDir = initCommittedRepo(prefix);
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  writeBootstrapStarterKit({ rootDir, projectName: 'integration-fixture', evidenceCheck: 'npm test', force: true });
  commitAll(rootDir, 'Bootstrap Veritas');
  return rootDir;
}

function writeClaudeSessionLog(rootDir) {
  const sessionLogPath = join(rootDir, 'claude-session.jsonl');
  const lines = [
    {
      type: 'assistant',
      timestamp: '2026-05-10T00:00:00.000Z',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'veritas readiness --working-tree' } }] },
    },
    {
      type: 'user',
      timestamp: '2026-05-10T00:00:10.000Z',
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'FAIL  rule-a: broken' }] }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-10T00:01:00.000Z',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/app.mjs' } }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-10T00:02:00.000Z',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'VERITAS_EXCEPTION_RULE=rule-a VERITAS_EXCEPTION_REASON=reviewed true' } }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-10T00:03:00.000Z',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'veritas readiness --working-tree' } }] },
    },
    {
      type: 'user',
      timestamp: '2026-05-10T00:03:10.000Z',
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'PASS  rule-a: fixed' }] }] },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-10T00:04:00.000Z',
      message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
    },
  ];
  writeFileSync(sessionLogPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return sessionLogPath;
}

test('ClaudeCodeSessionLogReader normalizes Claude Code JSONL events', () => {
  const rootDir = bootstrapRepo();
  const sessionLogPath = writeClaudeSessionLog(rootDir);
  const events = [...ClaudeCodeSessionLogReader.readEvents(sessionLogPath)];

  assert.ok(events.some((event) => event.kind === 'readiness-check'));
  assert.ok(events.some((event) => event.kind === 'edit' && event.files.includes('src/app.mjs')));
  assert.ok(events.some((event) => event.kind === 'exception'));
  assert.ok(events.some((event) => event.kind === 'completion'));
});

test('feedback observe derives Claude Code parity fields from session log reader', () => {
  const rootDir = bootstrapRepo();
  const sessionLogPath = writeClaudeSessionLog(rootDir);
  const result = observeSessionLogStandardsFeedback({
    rootDir,
    sessionLogPath,
    tool: 'claude-code',
  });

  assert.equal(result.reader, 'claude-code');
  assert.equal(result.draft.prefilled_measurements.time_to_green_minutes, 3);
  assert.equal(result.draft.prefilled_measurements.exception_count, 1);
  assert.equal(result.draft.prefilled_outcome.accepted_without_major_rewrite, true);
});

test('feedback observe rejects session-log run ids that would escape output directories', () => {
  const rootDir = bootstrapRepo('veritas-unsafe-session-log-');
  const sessionLogPath = join(rootDir, 'codex.json');
  writeFileSync(sessionLogPath, JSON.stringify({
    session_id: '../../outside',
    events: [
      { timestamp: '2026-05-10T00:00:00.000Z', command: 'veritas readiness', status: 'failed', files: ['src/app.mjs'] },
      { timestamp: '2026-05-10T00:01:00.000Z', command: 'veritas readiness', status: 'passed', files: ['src/app.mjs'] },
    ],
  }, null, 2));

  assert.throws(
    () => observeSessionLogStandardsFeedback({
      rootDir,
      sessionLogPath,
      tool: 'codex',
    }),
    /Standards feedback draft run id may only contain letters, numbers, dot, underscore, and hyphen/,
  );
  assert.equal(existsSync(join(rootDir, 'outside.json')), false);
});

test('CodexSessionLogReader reads legacy JSON session log shape through the registry contract', () => {
  const rootDir = bootstrapRepo('veritas-codex-reader-');
  const sessionLogPath = join(rootDir, 'codex.json');
  writeFileSync(sessionLogPath, JSON.stringify({
    events: [
      { timestamp: '2026-05-10T00:00:00.000Z', command: 'veritas readiness', status: 'failed', files: ['src/app.mjs'] },
      { timestamp: '2026-05-10T00:01:00.000Z', command: 'veritas readiness', status: 'passed', files: ['src/app.mjs'] },
    ],
  }, null, 2));
  const events = [...CodexSessionLogReader.readEvents(sessionLogPath)];
  assert.equal(events.filter((event) => event.kind === 'readiness-check').length, 2);
});

test('integrations claude-code install wires PreToolUse, Stop, and PostSession hooks', () => {
  const rootDir = bootstrapRepo('veritas-claude-install-');
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'integrations',
    'claude-code',
    'install',
    '--root',
    rootDir,
  ], { cwd: rootDir, encoding: 'utf8' });
  const parsed = parseCliJson(output);
  const settings = JSON.parse(readFileSync(join(rootDir, '.claude/settings.json'), 'utf8'));
  const statusOutput = execFileSync('node', [
    cli,
    'integrations',
    'claude-code',
    'status',
    '--root',
    rootDir,
  ], { cwd: rootDir, encoding: 'utf8' });
  const status = parseCliJson(statusOutput);

  assert.equal(parsed.tool, 'claude-code');
  assert.ok(settings.hooks.PreToolUse);
  assert.ok(settings.hooks.Stop);
  assert.ok(settings.hooks.PostSession);
  assert.match(
    settings.hooks.PostSession[0].hooks[0].command,
    /VERITAS_SESSION_LOG_PATH/,
  );
  assert.equal(status.preToolUseHook.exists, true);
  assert.equal(status.preToolUseHook.executable, true);
  assert.equal(status.stopHook.exists, true);
  assert.equal(status.stopHook.executable, true);
  assert.equal(status.settings.preToolUseConfigured, true);
  assert.equal(status.settings.stopConfigured, true);
  assert.equal(status.settings.postSessionConfigured, true);
});

test('integrations cursor install wires generic stop hook and reports config status', () => {
  const rootDir = bootstrapRepo('veritas-cursor-install-');
  const cli = join(repoRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'integrations',
    'cursor',
    'install',
    '--root',
    rootDir,
  ], { cwd: rootDir, encoding: 'utf8' });
  const parsed = parseCliJson(output);
  const statusOutput = execFileSync('node', [
    cli,
    'integrations',
    'cursor',
    'status',
    '--root',
    rootDir,
  ], { cwd: rootDir, encoding: 'utf8' });
  const status = parseCliJson(statusOutput);

  assert.equal(parsed.tool, 'cursor');
  assert.equal(parsed.stop.outputPath, '.veritas/hooks/stop.sh');
  assert.equal(parsed.stop.configuredToolConfigPath, '.cursor/hooks.json');
  assert.equal(status.stopHook.exists, true);
  assert.equal(status.stopHook.executable, true);
  assert.equal(status.toolConfig.path, '.cursor/hooks.json');
  assert.equal(status.toolConfig.stopConfigured, true);
  assert.equal(status.sessionLogReader, null);
});
