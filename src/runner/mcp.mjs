import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function serverKey(serverDef) {
  return createHash('sha256')
    .update(JSON.stringify({ command: serverDef.command, args: serverDef.args ?? [], env: serverDef.env ?? {} }))
    .digest('hex');
}

export class McpServerPool {
  #connections = new Map();
  #signal;

  constructor({ signal } = {}) {
    this.#signal = signal ?? null;
  }

  async #getOrConnect(serverDef) {
    const key = serverKey(serverDef);
    if (!this.#connections.has(key)) {
      const promise = this.#connect(serverDef).catch((error) => {
        this.#connections.delete(key);
        throw error;
      });
      this.#connections.set(key, promise);
    }
    return this.#connections.get(key);
  }

  async #connect(serverDef) {
    const transport = new StdioClientTransport({
      command: serverDef.command,
      args: serverDef.args ?? [],
      env: serverDef.env,
    });
    const client = new Client({ name: 'veritas-runner', version: '1.0.0' });
    await client.connect(transport);
    return { client };
  }

  async call(serverDef, toolName, input, { signal } = {}) {
    const callSignal =
      this.#signal && signal
        ? AbortSignal.any([this.#signal, signal])
        : (this.#signal ?? signal ?? null);

    const startedAt = Date.now();
    const { client } = await this.#getOrConnect(serverDef);
    const result = await client.callTool(
      { name: toolName, arguments: input ?? {} },
      undefined,
      callSignal ? { signal: callSignal } : undefined,
    );
    return {
      content: result.content,
      isError: result.isError ?? false,
      durationMs: Date.now() - startedAt,
    };
  }

  async close() {
    const pending = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.allSettled(
      pending.map(async (connPromise) => {
        try {
          const { client } = await connPromise;
          await client.close();
        } catch { /* ignore close errors */ }
      }),
    );
  }
}

export function createMcpServerPool(options) {
  return new McpServerPool(options);
}

export async function runMcp(serverDef, toolName, input, options) {
  const pool = new McpServerPool(options);
  try {
    return await pool.call(serverDef, toolName, input, options);
  } finally {
    await pool.close();
  }
}
