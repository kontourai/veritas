import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareGuidanceBriefing } from '../src/hooks/guidance-briefing.mjs';

function fixture() {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-guidance-briefing-'));
  mkdirSync(join(rootDir, '.veritas/repo-standards'), { recursive: true });
  writeFileSync(join(rootDir, '.veritas/repo-map.json'), '{}');
  writeFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), '{}');
  return rootDir;
}

test('briefs once per session and guidance, and rebriefs on standards changes', () => {
  const rootDir = fixture();
  const args = { rootDir, stdinText: JSON.stringify({ session_id: 'session-one' }), guidanceContext: 'Rule one' };
  const first = prepareGuidanceBriefing(args);
  assert.equal(first.guidanceContext, 'Rule one');
  first.record();
  assert.equal(prepareGuidanceBriefing(args).guidanceContext, '');
  assert.equal(prepareGuidanceBriefing({ ...args, stdinText: JSON.stringify({ session_id: 'session-two' }) }).guidanceContext, 'Rule one');
  assert.equal(prepareGuidanceBriefing({ ...args, guidanceContext: 'Rule two' }).guidanceContext, 'Rule two');
  writeFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), '{"changed":true}');
  assert.equal(prepareGuidanceBriefing(args).guidanceContext, 'Rule one');
});

test('concurrent invocations may repeat guidance but cannot suppress the first briefing', () => {
  const args = { rootDir: fixture(), stdinText: JSON.stringify({ session_id: 'shared' }), guidanceContext: 'Rule one' };
  const first = prepareGuidanceBriefing(args);
  const concurrent = prepareGuidanceBriefing(args);
  assert.equal(first.guidanceContext, 'Rule one');
  assert.equal(concurrent.guidanceContext, 'Rule one');
  first.record();
  concurrent.record();
  assert.equal(prepareGuidanceBriefing(args).guidanceContext, '');
});

test('missing session identity and cache errors retain the full briefing', () => {
  const rootDir = fixture();
  assert.equal(prepareGuidanceBriefing({ rootDir, stdinText: '{}', guidanceContext: 'Rule one' }).guidanceContext, 'Rule one');
  mkdirSync(join(rootDir, '.kontourai/veritas'), { recursive: true });
  writeFileSync(join(rootDir, '.kontourai/veritas/hook-briefings'), 'unavailable');
  assert.equal(prepareGuidanceBriefing({ rootDir, stdinText: '{"session_id":"one"}', guidanceContext: 'Rule one' }).guidanceContext, 'Rule one');
});
