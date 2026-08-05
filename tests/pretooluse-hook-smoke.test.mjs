/**
 * End-to-end smoke tests for the *installed* Claude Code PreToolUse gate.
 *
 * tests/pretooluse-deny.test.mjs covers the library function. That is not the same
 * assertion: between 955ce64 and #125 the generated hook body shelled into a CLI verb
 * `bin/veritas.mjs` did not route, so the installed gate exited 1 (a non-blocking error
 * under the Claude Code protocol) while every library-level test stayed green.
 *
 * These tests run the generated `.veritas/hooks/pre-tool-use.sh` as a process and assert
 * on its exit code, because exit 2 is the only exit code Claude Code treats as a block.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAttestation, writeBootstrapStarterKit } from '../src/index.mjs';
import {
  cleanGitEnv,
  commitAll,
  initCommittedRepo,
  installLocalVeritasBin,
  parseCliJson,
} from './helpers.mjs';

const DENIED_FILE = '.veritas/repo-map.json';
const ALLOWED_FILE = 'docs/notes.md';

function bootstrapGovernedRepo(prefix) {
  const rootDir = initCommittedRepo(prefix);
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'pretool-hook-smoke',
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
    approvalRef: 'test://pretool-hook-smoke',
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  installLocalVeritasBin(rootDir);
  return rootDir;
}

/** Installs the gate the way an operator does: through the public CLI. */
function installClaudeCodeIntegration(rootDir) {
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'integrations', 'claude-code', 'install', '--root', rootDir],
    { cwd: rootDir, encoding: 'utf8', env: cleanGitEnv() },
  );
  return parseCliJson(stdout);
}

function runInstalledHook(rootDir, filePath, env = {}) {
  const hookPath = join(rootDir, '.veritas/hooks/pre-tool-use.sh');
  return spawnSync(hookPath, [], {
    cwd: rootDir,
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } }),
    env: { ...cleanGitEnv(), ...env },
  });
}

function readExceptionRecords(rootDir) {
  const path = join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('installed PreToolUse hook exits 2 and blocks a denied strict-surface edit', () => {
  const rootDir = bootstrapGovernedRepo('veritas-pretool-smoke-deny-');
  const install = installClaudeCodeIntegration(rootDir);
  assert.equal(install.preToolUse.outputPath, '.veritas/hooks/pre-tool-use.sh');

  const result = runInstalledHook(rootDir, DENIED_FILE);

  assert.equal(
    result.status,
    2,
    `expected exit 2 (Claude Code's only blocking exit code), got ${result.status}: ${result.stdout}${result.stderr}`,
  );
  const payload = parseCliJson(result.stdout);
  assert.equal(payload.decision, 'block');
  assert.match(payload.reason, /work-area-boundary/);
});

test('installed PreToolUse hook exits 0 and approves an allowed edit', () => {
  const rootDir = bootstrapGovernedRepo('veritas-pretool-smoke-allow-');
  installClaudeCodeIntegration(rootDir);

  const result = runInstalledHook(rootDir, ALLOWED_FILE);

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stdout}${result.stderr}`);
  assert.equal(parseCliJson(result.stdout).decision, 'approve');
});

test('installed PreToolUse hook records VERITAS_HOOK_SKIP bypasses instead of exiting silently', () => {
  const rootDir = bootstrapGovernedRepo('veritas-pretool-smoke-skip-');
  installClaudeCodeIntegration(rootDir);
  assert.deepEqual(readExceptionRecords(rootDir), []);

  const result = runInstalledHook(rootDir, DENIED_FILE, {
    VERITAS_HOOK_SKIP: '1',
    VERITAS_HOOK_SKIP_REASON: 'Emergency hotfix, gate bypassed knowingly.',
  });

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stdout}${result.stderr}`);
  assert.equal(parseCliJson(result.stdout).decision, 'approve');
  assert.match(result.stderr, /PreToolUse gate skipped/);

  const records = readExceptionRecords(rootDir);
  assert.equal(records.length, 1, 'a skipped gate must leave exactly one record in the repo');
  assert.equal(records[0].kind, 'hook-skip');
  assert.equal(records[0].file, DENIED_FILE);
  assert.equal(records[0].actor, 'brian');
  assert.match(records[0].reason, /Emergency hotfix/);
});

test('generated PreToolUse hook body invokes a verb the bin actually routes', () => {
  const rootDir = bootstrapGovernedRepo('veritas-pretool-smoke-route-');
  installClaudeCodeIntegration(rootDir);
  const hookBody = readFileSync(join(rootDir, '.veritas/hooks/pre-tool-use.sh'), 'utf8');
  const invocation = hookBody.match(/^exec npm exec -- veritas (.+) "\$@"$/m);
  assert.ok(invocation, `hook body must exec a veritas verb:\n${hookBody}`);

  // Run the parsed verb through the real bin and assert it is not the
  // "unknown subcommand" path (top-level usage banner on stderr, exit 1).
  const probe = spawnSync(
    'npm',
    ['exec', '--', 'veritas', ...invocation[1].split(' '), '--root', rootDir],
    { cwd: rootDir, encoding: 'utf8', input: '{}', env: cleanGitEnv() },
  );
  assert.doesNotMatch(
    probe.stderr,
    /Usage:\s*\n\s*veritas --version/,
    `hook body names a verb the bin does not route: ${invocation[1]}`,
  );
  assert.notEqual(probe.status, 1, `hook body names a verb the bin does not route: ${probe.stderr}`);
});
