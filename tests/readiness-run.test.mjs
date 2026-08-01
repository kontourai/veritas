import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeBootstrapStarterKit } from '../src/bootstrap.mjs';
import { runMergeReadiness } from '../src/readiness/run.mjs';
import { commitAll, initCommittedRepo } from './helpers.mjs';

test('Merge Readiness run coordinates evidence, report, and draft behind one interface', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-run-fixture',
    evidenceCheck: 'npm test',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap Veritas');

  const result = await runMergeReadiness(
    {
      rootDir,
      runId: 'readiness-run-test',
      workingTree: true,
      force: true,
    },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.equal(result.currentStatus, 'pass');
  assert.deepEqual(result.evidenceCheckLabels, ['npm test']);
  assert.equal(result.evidenceCheckResults[0].passed, true);
  assert.equal(result.reportResult.record.run_id, 'readiness-run-test');
  assert.equal(result.draftResult.record.run_id, 'readiness-run-test');
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/runs/history.jsonl')), false);
});

test('Merge Readiness reports a typed evidence-check timeout and phase progress', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-timeout-');
  const markerPath = join(rootDir, 'descendant-ran');
  const childScriptPath = join(rootDir, 'descendant.mjs');
  writeFileSync(
    childScriptPath,
    "import { writeFileSync } from 'node:fs'; setTimeout(() => writeFileSync(process.argv[2], 'ran'), 300);\n",
  );
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-timeout-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks[0] = {
    ...repoMap.evidence.evidenceChecks[0],
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(childScriptPath)} ${JSON.stringify(markerPath)} & wait`,
    timeoutMs: 50,
  };
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap Veritas timeout fixture');

  const phases = [];
  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-timeout-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false, onReadinessPhase: (phase) => phases.push(phase) },
  );

  assert.equal(result.currentStatus, 'fail');
  assert.equal(result.evidenceCheckResults[0].timedOut, true);
  assert.equal(result.evidenceCheckResults[0].passed, false);
  assert.deepEqual(result.evidenceCheckFailure, {
    phase: 'evidence-check',
    reason: 'timeout',
    id: result.evidenceCheckResults[0].id,
    runner: 'bash',
    label: result.evidenceCheckResults[0].label,
    message: 'Evidence Check command timed out after 50ms',
    stdout: '',
    stderr: '',
    exitCode: null,
  });
  assert.deepEqual(phases.map((phase) => phase.phase), ['scope-resolution', 'evidence-check']);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(existsSync(markerPath), false, 'timed-out evidence check descendant must not continue');
});

test('Merge Readiness reports a typed MCP evidence-check timeout and phase progress', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-mcp-timeout-');
  const serverPath = join(rootDir, 'mcp-server.mjs');
  const sdkRoot = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  writeFileSync(serverPath, `
import { Server } from '${pathToFileURL(join(sdkRoot, 'server/index.js')).href}';
import { StdioServerTransport } from '${pathToFileURL(join(sdkRoot, 'server/stdio.js')).href}';
import { CallToolRequestSchema } from '${pathToFileURL(join(sdkRoot, 'types.js')).href}';

const server = new Server({ name: 'veritas-readiness-timeout-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(CallToolRequestSchema, async () => new Promise(() => {}));
await server.connect(new StdioServerTransport());
`);
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-mcp-timeout-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks[0] = {
    ...repoMap.evidence.evidenceChecks[0],
    runner: 'mcp',
    server: { command: process.execPath, args: [serverPath] },
    tool: 'scan',
    input: {},
    timeoutMs: 50,
  };
  delete repoMap.evidence.evidenceChecks[0].command;
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap Veritas MCP timeout fixture');

  const phases = [];
  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-mcp-timeout-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false, onReadinessPhase: (phase) => phases.push(phase) },
  );

  const evidenceCheck = repoMap.evidence.evidenceChecks[0];
  assert.equal(result.currentStatus, 'fail');
  assert.deepEqual(result.evidenceCheckResults, []);
  assert.deepEqual(result.evidenceCheckFailure, {
    phase: 'evidence-check',
    reason: 'timeout',
    id: evidenceCheck.id,
    runner: 'mcp',
    label: `scan@${process.execPath}`,
    message: 'MCP Evidence Check timed out after 50ms',
  });
  assert.deepEqual(phases.map((phase) => phase.phase), ['scope-resolution', 'evidence-check']);
});
