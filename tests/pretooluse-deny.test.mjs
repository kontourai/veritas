import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAttestation,
  evaluatePreToolUse,
  writeBootstrapStarterKit,
} from '../src/index.mjs';
import { commitAll, initCommittedRepo } from './helpers.mjs';

function bootstrapRepo() {
  const rootDir = initCommittedRepo('veritas-pretool-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'pretool-fixture',
    evidenceCheck: 'npm test',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  const governanceNode = repoMap.graph.nodes.find((node) => node.id === 'governance.guidance');
  governanceNode.owners = ['governance-team'];
  governanceNode.boundary = 'strict';
  governanceNode.boundaryAllow = ['repo-core'];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap Veritas');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    approvalRef: 'test://pretool-human-approval',
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  return rootDir;
}

test('Claude Code PreToolUse blocks denied strict-surface edits', () => {
  const rootDir = bootstrapRepo();
  const result = evaluatePreToolUse({
    rootDir,
    stdinText: JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: '.veritas/repo-map.json' },
    }),
  });

  assert.equal(result.actor, 'brian');
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /work-area-boundary/);
});

test('Claude Code PreToolUse allows edits when checks pass', () => {
  const rootDir = bootstrapRepo();
  const result = evaluatePreToolUse({
    rootDir,
    stdinText: JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: 'docs/notes.md' },
    }),
  });

  assert.equal(result.decision, 'approve');
});

test('Claude Code PreToolUse blocks malformed payloads', () => {
  const rootDir = bootstrapRepo();
  const result = evaluatePreToolUse({
    rootDir,
    stdinText: '{not-json',
  });

  assert.equal(result.actor, 'brian');
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /Malformed PreToolUse payload/);
});

test('Claude Code PreToolUse exception allows and records a rule bypass', () => {
  const rootDir = bootstrapRepo();
  const previousRule = process.env.VERITAS_EXCEPTION_RULE;
  const previousReason = process.env.VERITAS_EXCEPTION_REASON;
  process.env.VERITAS_EXCEPTION_RULE = 'work-area-boundary';
  process.env.VERITAS_EXCEPTION_REASON = 'Human-approved emergency policy edit.';
  try {
    const result = evaluatePreToolUse({
      rootDir,
      stdinText: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: '.veritas/repo-map.json' },
      }),
    });
    assert.equal(result.decision, 'approve');
    assert.equal(result.exceptions[0].ruleId, 'work-area-boundary');
    assert.equal(result.exceptions[0].actor, 'brian');
    assert.ok(existsSync(join(rootDir, result.exceptionPath)));
    assert.match(readFileSync(join(rootDir, result.exceptionPath), 'utf8'), /Human-approved emergency policy edit/);
  } finally {
    if (previousRule === undefined) delete process.env.VERITAS_EXCEPTION_RULE;
    else process.env.VERITAS_EXCEPTION_RULE = previousRule;
    if (previousReason === undefined) delete process.env.VERITAS_EXCEPTION_REASON;
    else process.env.VERITAS_EXCEPTION_REASON = previousReason;
  }
});
