import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyCodexHook,
  buildSuggestedCodexHookConfig,
  createAttestation,
  writeBootstrapStarterKit,
} from '../src/index.mjs';
import { codexEditPaths, evaluateCodexPreToolUse } from '../src/hooks/codex-pre-tool-use.mjs';
import { commitAll, initCommittedRepo, installLocalVeritasBin } from './helpers.mjs';

function fixture() {
  const rootDir = initCommittedRepo('veritas-codex-pretool-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --version' } }));
  writeBootstrapStarterKit({ rootDir, projectName: 'codex-hook', evidenceCheck: 'npm test', force: true });
  mkdirSync(join(rootDir, 'docs'), { recursive: true });
  writeFileSync(join(rootDir, 'docs/notes.md'), '# Notes\n');
  const mapPath = join(rootDir, '.veritas/repo-map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const guidanceNode = map.graph.nodes.find((node) => node.id === 'governance.guidance');
  guidanceNode.owners = ['governance-team'];
  guidanceNode.boundary = 'strict';
  guidanceNode.boundaryAllow = ['repo-core'];
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  const standardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const standards = JSON.parse(readFileSync(standardsPath, 'utf8'));
  standards.rules.push({
    id: 'notes-review', kind: 'required-artifacts', classification: 'promotable-policy',
    enforcementLevel: 'Guide', message: 'Review notes.',
    explain: { summary: 'Review the note owner.', mustDo: ['Check the named owner.'] },
    match: { artifacts: ['docs/notes.md'] },
  });
  writeFileSync(standardsPath, `${JSON.stringify(standards, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap Codex hook fixture');
  createAttestation({
    rootDir, kind: 'bootstrap', actor: 'brian', notes: 'Approved fixture.',
    approvalRef: 'test://codex-hook', attestedAt: '2026-05-10T00:00:00.000Z',
  });
  installLocalVeritasBin(rootDir);
  return rootDir;
}

function patch(...paths) {
  return ['*** Begin Patch', ...paths.flatMap((path) => [
    `*** Update File: ${path}`, '@@', '-old', '+new',
  ]), '*** End Patch'].join('\n');
}

test('Codex patch path parsing includes all changed paths and refuses pathless edits', () => {
  assert.deepEqual(codexEditPaths({
    tool_name: 'apply_patch',
    tool_input: { command: [
      '*** Begin Patch',
      '*** Update File: docs/notes.md',
      '*** Move to: docs/renamed.md',
      '*** Add File: docs/another.md',
      '*** End Patch',
    ].join('\n') },
  }), ['docs/notes.md', 'docs/renamed.md', 'docs/another.md']);
  assert.deepEqual(codexEditPaths({ tool_name: 'apply_patch', tool_input: { command: 'no patch' } }), []);
});

test('Codex PreToolUse presents matching guidance before an allowed edit', () => {
  const rootDir = fixture();
  const result = evaluateCodexPreToolUse({
    rootDir,
    stdinText: JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: patch('docs/notes.md', 'docs/other.md') } }),
  });
  assert.equal(result.decision, 'approve');
  assert.deepEqual(result.paths, ['docs/notes.md', 'docs/other.md']);
  assert.match(result.guidanceContext, /Rule notes-review \(Guide\)/);
  assert.match(result.guidanceContext, /Do: Check the named owner/);
});

test('Codex PreToolUse defers content checks until a newly added file exists', () => {
  const rootDir = fixture();
  const standardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const standards = JSON.parse(readFileSync(standardsPath, 'utf8'));
  standards.rules.push({
    id: 'new-file-header', kind: 'required-pattern', classification: 'hard-invariant',
    enforcementLevel: 'Require', enforcement: 'deny', message: 'New notes need a header.',
    explain: { summary: 'Add the required header.' },
    match: { files: ['docs/new.md'], pattern: '^# Required header' },
  });
  writeFileSync(standardsPath, `${JSON.stringify(standards, null, 2)}\n`);
  const addInput = JSON.stringify({
    cwd: rootDir, tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Add File: docs/new.md\n+# Required header\n*** End Patch' },
  });
  const before = evaluateCodexPreToolUse({ rootDir, stdinText: addInput });
  assert.equal(before.decision, 'approve');
  assert.match(before.guidanceContext, /new-file-header/);
  const cli = spawnSync(process.execPath, [
    'bin/veritas.mjs', 'hooks', 'codex', 'pre-tool-use', '--root', rootDir,
  ], { encoding: 'utf8', input: addInput });
  assert.equal(cli.status, 0, cli.stderr);

  const strictAdd = evaluateCodexPreToolUse({
    rootDir, actor: 'other',
    stdinText: JSON.stringify({
      tool_name: 'apply_patch',
      tool_input: { command: '*** Begin Patch\n*** Add File: .veritas/new-policy.json\n+{}\n*** End Patch' },
    }),
  });
  assert.equal(strictAdd.decision, 'block');
  assert.match(strictAdd.reason, /work-area-boundary/);

  writeFileSync(join(rootDir, 'docs/new.md'), 'Missing the required header.\n');
  const existing = evaluateCodexPreToolUse({ rootDir, stdinText: addInput });
  assert.equal(existing.decision, 'block');
  assert.match(existing.reason, /new-file-header/);
  writeFileSync(join(rootDir, 'docs/new.md'), '# Required header\n');
  assert.equal(evaluateCodexPreToolUse({ rootDir, stdinText: addInput }).decision, 'approve');
});

test('Codex PreToolUse denies strict-area edits and pathless patches', () => {
  const rootDir = fixture();
  const denied = evaluateCodexPreToolUse({
    rootDir, actor: 'other',
    stdinText: JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: patch('.veritas/repo-map.json') } }),
  });
  assert.equal(denied.decision, 'block');
  assert.match(denied.reason, /work-area-boundary/);
  const pathless = evaluateCodexPreToolUse({
    rootDir,
    stdinText: JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** End Patch' } }),
  });
  assert.equal(pathless.decision, 'block');
  assert.match(pathless.reason, /no parseable file path/);
});

test('Codex PreToolUse still denies every strict-area edit after a briefing', () => {
  const rootDir = fixture();
  const stdinText = JSON.stringify({ session_id: 'repeat-denial', tool_name: 'apply_patch', tool_input: { command: patch('.veritas/repo-map.json') } });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = evaluateCodexPreToolUse({ rootDir, actor: 'other', stdinText });
    assert.equal(result.decision, 'block');
    assert.match(result.reason, /work-area-boundary/);
  }
});

test('Codex PreToolUse records an explicit hook skip as a bypass', () => {
  const rootDir = fixture();
  const before = process.env.VERITAS_HOOK_SKIP;
  process.env.VERITAS_HOOK_SKIP = '1';
  try {
    const result = evaluateCodexPreToolUse({
      rootDir,
      stdinText: JSON.stringify({ tool_name: 'apply_patch', tool_input: { command: patch('.veritas/repo-map.json') } }),
    });
    assert.equal(result.decision, 'approve');
    assert.equal(result.skipped, true);
    assert.ok(existsSync(join(rootDir, result.exceptionPath)));
  } finally {
    if (before === undefined) delete process.env.VERITAS_HOOK_SKIP;
    else process.env.VERITAS_HOOK_SKIP = before;
  }
});

test('the Flow Agents provisioned Codex hook stays identical to the Veritas installer hook', () => {
  const provision = JSON.parse(readFileSync('provisions/codex-hooks.json', 'utf8'));
  const kit = JSON.parse(readFileSync('kit.json', 'utf8'));
  assert.deepEqual(provision.hooks.PreToolUse, buildSuggestedCodexHookConfig().hooks.PreToolUse);
  assert.deepEqual(kit.provisions.map((item) => item.target), ['.codex/hooks.json']);
  assert.deepEqual(kit.provisions.map((item) => [item.host, item.kind]), [['codex', 'hook']]);
  assert.deepEqual(kit.provisions.map((item) => item.merge), ['hooks-json']);
});

test('installed Codex hook config routes a real CLI invocation with model-visible context', () => {
  const rootDir = fixture();
  const targetHooksFile = join(rootDir, '.codex/hooks.json');
  applyCodexHook({ rootDir, targetHooksFile });
  const installed = JSON.parse(readFileSync(targetHooksFile, 'utf8'));
  const command = buildSuggestedCodexHookConfig().hooks.PreToolUse[0].hooks[0].command;
  assert.equal(installed.hooks.PreToolUse[0].hooks[0].command, command);
  const [binary, ...args] = command.split(' ');
  const nestedCwd = join(rootDir, 'docs');
  const result = spawnSync(binary, args, {
    cwd: nestedCwd, encoding: 'utf8',
    input: JSON.stringify({ cwd: nestedCwd, tool_name: 'apply_patch', tool_input: { command: patch('docs/notes.md') } }),
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ['hookSpecificOutput']);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(output.hookSpecificOutput.additionalContext, /notes-review/);

  const blocked = execFileSync(process.execPath, [
    'bin/veritas.mjs', 'hooks', 'codex', 'pre-tool-use', '--root', rootDir,
  ], {
    cwd: process.cwd(), encoding: 'utf8',
    input: JSON.stringify({ cwd: rootDir, tool_name: 'apply_patch', tool_input: { command: patch('docs/notes.md') } }),
  });
  assert.match(JSON.parse(blocked).hookSpecificOutput.additionalContext, /notes-review/);
});

test('installed Codex hook briefs once per session while preserving repeated policy decisions', () => {
  const rootDir = fixture();
  const input = JSON.stringify({
    session_id: 'codex-briefing-smoke', cwd: rootDir, tool_name: 'apply_patch',
    tool_input: { command: patch('docs/notes.md') },
  });
  const run = () => JSON.parse(execFileSync(process.execPath, [
    'bin/veritas.mjs', 'hooks', 'codex', 'pre-tool-use', '--root', rootDir,
  ], { encoding: 'utf8', input }));
  const first = run();
  assert.deepEqual(Object.keys(first), ['hookSpecificOutput']);
  assert.match(first.hookSpecificOutput.additionalContext, /notes-review/);
  const second = run();
  assert.deepEqual(second, {});
});

test('Codex CLI emits the supported deny shape without legacy decision fields', () => {
  const rootDir = fixture();
  const result = spawnSync(process.execPath, [
    'bin/veritas.mjs', 'hooks', 'codex', 'pre-tool-use', '--root', rootDir, '--actor', 'other',
  ], {
    encoding: 'utf8',
    input: JSON.stringify({ cwd: rootDir, tool_name: 'apply_patch', tool_input: { command: patch('.veritas/repo-map.json') } }),
  });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output), ['hookSpecificOutput']);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /work-area-boundary/);
});
