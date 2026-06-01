import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runBash, createMcpServerPool } from '../src/runner/index.mjs';

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

test('McpServerPool deduplicates server processes and closes cleanly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'veritas-mcp-runner-'));
  const countPath = join(dir, 'count.txt');
  const serverPath = join(dir, 'server.mjs');
  const sdkRoot = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  writeFileSync(countPath, '0');
  writeFileSync(serverPath, `
import { readFileSync, writeFileSync } from 'node:fs';
import { Server } from '${pathToFileURL(join(sdkRoot, 'server/index.js')).href}';
import { StdioServerTransport } from '${pathToFileURL(join(sdkRoot, 'server/stdio.js')).href}';
import { CallToolRequestSchema, ListToolsRequestSchema } from '${pathToFileURL(join(sdkRoot, 'types.js')).href}';

const countPath = process.argv[2];
writeFileSync(countPath, String(Number(readFileSync(countPath, 'utf8')) + 1));

const server = new Server({ name: 'veritas-runner-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'scan', description: 'test scan', inputSchema: { type: 'object' } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: JSON.stringify(request.params.arguments ?? {}) }],
  isError: false,
}));

await server.connect(new StdioServerTransport());
`);

  const pool = createMcpServerPool();
  try {
    const server = { command: process.execPath, args: [serverPath, countPath] };
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
