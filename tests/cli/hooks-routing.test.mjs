import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { repoRootDir } from '../helpers.mjs';

// Regression for veritas#119: `veritas integrations claude-code install` writes a PreToolUse hook
// whose body shells into `veritas hooks claude-code pre-tool-use "$@"` (src/hooks/suggestions.mjs).
// The bin dispatcher had no `hooks` subcommand, so the installed hook shelled into an unrouted
// command and the per-edit boundary check never ran. These tests pin the routing.

function runHook(args, { stdin = '{}', expectExit } = {}) {
  try {
    const stdout = execFileSync(process.execPath, ['bin/veritas.mjs', 'hooks', ...args], {
      cwd: repoRootDir,
      encoding: 'utf8',
      input: stdin,
    });
    return { stdout, code: 0 };
  } catch (error) {
    if (expectExit !== undefined) return { stdout: `${error.stdout ?? ''}`, stderr: `${error.stderr ?? ''}`, code: error.status };
    throw error;
  }
}

test('hooks claude-code pre-tool-use routes to the PreToolUse evaluator and emits a decision', () => {
  // The point is it EVALUATES and returns a JSON decision, not that it falls through to
  // unknown-subcommand usage. Either decision is fine (a block also exits 2), so capture both.
  const { stdout } = runHook(['claude-code', 'pre-tool-use', '--root', repoRootDir], {
    stdin: '{"tool_input":{"file_path":"package.json"}}',
    expectExit: true,
  });
  const parsed = JSON.parse(stdout);
  assert.ok(['approve', 'block'].includes(parsed.decision), `expected a decision, got: ${stdout}`);
  assert.equal(typeof parsed.reason, 'string');
});

test('hooks claude-code pre-tool-use exits 2 when the edit is blocked', () => {
  // A path inside a strict work area the acting user does not own must block (exit 2 so the
  // harness stops the edit).
  const { code, stdout } = runHook(['claude-code', 'pre-tool-use', '--root', repoRootDir, '--actor', 'not-an-owner'], {
    stdin: '{"tool_input":{"file_path":".veritas/repo-map.json"}}',
    expectExit: true,
  });
  const parsed = JSON.parse(stdout);
  if (parsed.decision === 'block') assert.equal(code, 2, 'a block decision must exit 2');
});

test('hooks claude-code print routes to the print handler', () => {
  const { stdout } = runHook(['claude-code', 'print', '--root', repoRootDir], { stdin: '' });
  // Emits the suggested hook as JSON (path + content), not unknown-subcommand usage.
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed, 'object');
  assert.ok(JSON.stringify(parsed).includes('pre-tool-use'), 'print output should describe the pre-tool-use hook');
});

test('hooks with an unknown runtime/action prints usage and exits 1', () => {
  const unknownAction = runHook(['claude-code', 'bogus'], { expectExit: true });
  assert.equal(unknownAction.code, 1);
  assert.match(unknownAction.stderr, /veritas hooks claude-code pre-tool-use/);

  const unknownRuntime = runHook(['cursor', 'pre-tool-use'], { expectExit: true });
  assert.equal(unknownRuntime.code, 1);
});
