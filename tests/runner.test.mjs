import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runBash, createMcpServerPool } from '../src/runner/index.mjs';

function writeMcpTestServer(dir) {
  const serverPath = join(dir, 'server.mjs');
  const sdkRoot = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  writeFileSync(serverPath, `
import { readFileSync, writeFileSync } from 'node:fs';
import { Server } from '${pathToFileURL(join(sdkRoot, 'server/index.js')).href}';
import { StdioServerTransport } from '${pathToFileURL(join(sdkRoot, 'server/stdio.js')).href}';
import { CallToolRequestSchema, ListToolsRequestSchema } from '${pathToFileURL(join(sdkRoot, 'types.js')).href}';

const mode = process.argv[2];
const countPath = process.argv[3];
if (mode === 'connect-hang') {
  setInterval(() => {}, 1_000);
} else {
  if (countPath) writeFileSync(countPath, String(Number(readFileSync(countPath, 'utf8')) + 1));
  const server = new Server({ name: 'veritas-runner-test', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'scan', description: 'test scan', inputSchema: { type: 'object' } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (mode === 'tool-hang') return new Promise(() => {});
    return {
      content: [{ type: 'text', text: JSON.stringify(request.params.arguments ?? {}) }],
      isError: false,
    };
  });
  await server.connect(new StdioServerTransport());
}
`);
  return serverPath;
}

test('runBash captures successful commands', async () => {
  const result = await runBash('printf "ok"');

  assert.equal(result.passed, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.stderr, '');
  assert.equal(typeof result.durationMs, 'number');
});

test('runBash captures failing commands and stderr', async () => {
  const result = await runBash('printf "bad\\n" >&2; exit 7');

  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, 'bad\n');
});

test('runBash aborts an in-flight command', async () => {
  const controller = new AbortController();
  const promise = runBash('sleep 5', { signal: controller.signal });
  setTimeout(() => controller.abort(), 25);

  await assert.rejects(promise, { name: 'AbortError' });
});

test('runBash rejects a signal that was already aborted without spawning', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    runBash('exit 0', { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('McpServerPool deduplicates server processes and closes cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-mcp-runner-'));
  const countPath = join(dir, 'count.txt');
  const serverPath = writeMcpTestServer(dir);
  writeFileSync(countPath, '0');

  const pool = createMcpServerPool();
  try {
    const server = { command: process.execPath, args: [serverPath, 'normal', countPath] };
    const first = await pool.call(server, 'scan', { depth: 2 });
    const second = await pool.call(server, 'scan', { depth: 3 });

    assert.equal(first.isError, false);
    assert.equal(first.content[0].text, '{"depth":2}');
    assert.equal(second.content[0].text, '{"depth":3}');
    assert.equal(readFileSync(countPath, 'utf8'), '1');
  } finally {
    await pool.close();
  }
});

test('McpServerPool bounds a stalled MCP initialization and does not wait to close it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-mcp-connect-timeout-'));
  const serverPath = writeMcpTestServer(dir);
  const pool = createMcpServerPool();
  const startedAt = Date.now();
  try {
    await assert.rejects(
      pool.call(
        { command: process.execPath, args: [serverPath, 'connect-hang'] },
        'scan',
        {},
        { timeoutMs: 60 },
      ),
      (error) => error?.code === -32001,
    );
    assert.ok(Date.now() - startedAt < 500, 'MCP initialization must honor the evidence-check deadline');
  } finally {
    const closeStartedAt = Date.now();
    await pool.close();
    assert.ok(Date.now() - closeStartedAt < 500, 'pool.close must not wait for a timed-out MCP process');
  }
});

test('McpServerPool bounds a stalled MCP tool call and does not wait to close it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-mcp-tool-timeout-'));
  const serverPath = writeMcpTestServer(dir);
  const pool = createMcpServerPool();
  const startedAt = Date.now();
  try {
    await assert.rejects(
      pool.call(
        { command: process.execPath, args: [serverPath, 'tool-hang'] },
        'scan',
        {},
        { timeoutMs: 60 },
      ),
      (error) => error?.code === -32001,
    );
    assert.ok(Date.now() - startedAt < 500, 'MCP tool call must honor the evidence-check deadline');
  } finally {
    const closeStartedAt = Date.now();
    await pool.close();
    assert.ok(Date.now() - closeStartedAt < 500, 'pool.close must not wait for a timed-out MCP process');
  }
});

test('McpServerPool rejects a signal that was already aborted without starting a server', async () => {
  const controller = new AbortController();
  controller.abort();
  const pool = createMcpServerPool();
  try {
    await assert.rejects(
      pool.call(
        { command: 'this-command-must-not-run', args: [] },
        'scan',
        {},
        { signal: controller.signal },
      ),
      { name: 'AbortError' },
    );
  } finally {
    await pool.close();
  }
});

test('runBash kills a hanging command at timeoutMs and flags timedOut', async () => {
  const result = await runBash('sleep 30', { timeoutMs: 100 });

  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.notEqual(result.signal, null, 'killed via signal, not a clean exit');
});

test('runBash timeout terminates descendants that keep output pipes open', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-bash-descendant-'));
  const markerPath = join(dir, 'descendant-ran');
  const childScriptPath = join(dir, 'descendant.mjs');
  writeFileSync(
    childScriptPath,
    "import { writeFileSync } from 'node:fs'; setTimeout(() => writeFileSync(process.argv[2], 'ran'), 300);\n",
  );

  const startedAt = Date.now();
  const result = await runBash(
    `${JSON.stringify(process.execPath)} ${JSON.stringify(childScriptPath)} ${JSON.stringify(markerPath)} & wait`,
    { timeoutMs: 50 },
  );

  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - startedAt < 250, 'timeout must not wait for the descendant');
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(existsSync(markerPath), false, 'timed-out descendant must not continue after readiness returns');
});

test('runBash escalates to SIGKILL for a descendant that ignores SIGTERM', {
  skip: process.platform === 'win32' && 'Windows has no process-group SIGKILL escalation',
}, async () => {
  const startedAt = Date.now();
  const result = await runBash(
    "sh -c 'trap \"\" TERM; while :; do :; done' & wait",
    { timeoutMs: 250 },
  );

  assert.equal(result.passed, false);
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - startedAt >= 1_800, 'the resistant descendant must survive until SIGKILL escalation');
  assert.ok(Date.now() - startedAt < 4_000, 'SIGKILL escalation must terminate the descendant promptly');
});

test('runBash leaves timedOut false for a command that finishes in time', async () => {
  const result = await runBash('printf "ok"', { timeoutMs: 5000 });

  assert.equal(result.passed, true);
  assert.equal(result.timedOut, false);
});
