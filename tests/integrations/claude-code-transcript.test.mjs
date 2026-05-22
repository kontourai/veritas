import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ClaudeCodeTranscriptReader,
  CodexTranscriptReader,
  observeTranscriptEval,
  writeBootstrapStarterKit,
} from '../../src/index.mjs';
import { commitAll, frameworkRootDir, initCommittedRepo, parseCliJson } from '../helpers.mjs';

function bootstrapRepo(prefix = 'veritas-claude-') {
  const rootDir = initCommittedRepo(prefix);
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  writeBootstrapStarterKit({ rootDir, projectName: 'integration-fixture', evidenceCheck: 'npm test', force: true });
  commitAll(rootDir, 'Bootstrap Veritas');
  return rootDir;
}

function writeClaudeTranscript(rootDir) {
  const transcriptPath = join(rootDir, 'claude-session.jsonl');
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
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'VERITAS_OVERRIDE_RULE=rule-a VERITAS_OVERRIDE_REASON=reviewed true' } }] },
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
  writeFileSync(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return transcriptPath;
}

test('ClaudeCodeTranscriptReader normalizes Claude Code JSONL events', () => {
  const rootDir = bootstrapRepo();
  const transcriptPath = writeClaudeTranscript(rootDir);
  const events = [...ClaudeCodeTranscriptReader.readEvents(transcriptPath)];

  assert.ok(events.some((event) => event.kind === 'readiness-check'));
  assert.ok(events.some((event) => event.kind === 'edit' && event.files.includes('src/app.mjs')));
  assert.ok(events.some((event) => event.kind === 'override'));
  assert.ok(events.some((event) => event.kind === 'completion'));
});

test('eval observe derives Claude Code parity fields from transcript reader', () => {
  const rootDir = bootstrapRepo();
  const transcriptPath = writeClaudeTranscript(rootDir);
  const result = observeTranscriptEval({
    rootDir,
    transcriptPath,
    tool: 'claude-code',
  });

  assert.equal(result.reader, 'claude-code');
  assert.equal(result.draft.prefilled_measurements.time_to_green_minutes, 3);
  assert.equal(result.draft.prefilled_measurements.override_count, 1);
  assert.equal(result.draft.prefilled_outcome.accepted_without_major_rewrite, true);
});

test('CodexTranscriptReader reads legacy JSON transcript shape through the registry contract', () => {
  const rootDir = bootstrapRepo('veritas-codex-reader-');
  const transcriptPath = join(rootDir, 'codex.json');
  writeFileSync(transcriptPath, JSON.stringify({
    events: [
      { timestamp: '2026-05-10T00:00:00.000Z', command: 'veritas readiness', status: 'failed', files: ['src/app.mjs'] },
      { timestamp: '2026-05-10T00:01:00.000Z', command: 'veritas readiness', status: 'passed', files: ['src/app.mjs'] },
    ],
  }, null, 2));
  const events = [...CodexTranscriptReader.readEvents(transcriptPath)];
  assert.equal(events.filter((event) => event.kind === 'readiness-check').length, 2);
});

test('integrations claude-code install wires PreToolUse, Stop, and PostSession hooks', () => {
  const rootDir = bootstrapRepo('veritas-claude-install-');
  const cli = join(frameworkRootDir, 'bin/veritas.mjs');
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

  assert.equal(parsed.tool, 'claude-code');
  assert.ok(settings.hooks.PreToolUse);
  assert.ok(settings.hooks.Stop);
  assert.ok(settings.hooks.PostSession);
});
