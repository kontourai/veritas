import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { OwnedStdioClientTransport } from './owned-stdio.mjs';

function serverKey(serverDef) {
  return createHash('sha256')
    .update(JSON.stringify({ command: serverDef.command, args: serverDef.args ?? [], env: serverDef.env ?? {} }))
    .digest('hex');
}

function abortError() {
  const error = new Error('MCP tool call aborted');
  error.name = 'AbortError';
  return error;
}

function timeoutError(timeoutMs) {
  return McpError.fromError(ErrorCode.RequestTimeout, 'MCP evidence check timed out', { timeout: timeoutMs });
}

function remainingTimeout(deadline) {
  if (!deadline) return undefined;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError(0);
  return remaining;
}

function transportFor(serverDef, { maxBufferBytes } = {}) {
  const options = {
    command: serverDef.command,
    args: serverDef.args ?? [],
    env: serverDef.env,
    stderr: 'ignore',
  };
  return new OwnedStdioClientTransport(options, { maxBufferBytes });
}

class McpServerPool {
  #connections = new Map();
  #signal;
  #maxBufferBytes;
  #closed = false;

  constructor({ signal, maxBufferBytes } = {}) {
    this.#signal = signal ?? null;
    this.#maxBufferBytes = maxBufferBytes;
  }

  async #getOrConnect(serverDef, { signal, deadline } = {}) {
    const key = serverKey(serverDef);
    if (!this.#connections.has(key)) {
      const connection = { client: null, transport: null, closed: false };
      connection.promise = this.#connect(serverDef, connection, { signal, deadline }).catch((error) => {
        this.#connections.delete(key);
        throw error;
      });
      this.#connections.set(key, connection);
    }
    return this.#connections.get(key).promise;
  }

  async #connect(serverDef, connection, { signal, deadline } = {}) {
    const transport = connection.transport = transportFor(serverDef, {
      maxBufferBytes: this.#maxBufferBytes,
    });
    const client = new Client({ name: 'veritas-runner', version: '1.0.0' });
    try {
      const timeoutMs = remainingTimeout(deadline);
      await client.connect(transport, {
        ...(signal ? { signal } : {}),
        ...(timeoutMs ? { timeout: timeoutMs, maxTotalTimeout: timeoutMs } : {}),
      });
      connection.client = client;
      if (this.#closed || connection.closed) {
        void client.close().catch(() => {});
        throw new Error('MCP server pool closed during connection');
      }
      return { client };
    } catch (error) {
      // StdioClientTransport.close() is itself bounded, but can wait several
      // seconds for a hostile child. Begin closure without extending the
      // evidence-check deadline or making pool.close wait for it.
      void transport.close().catch(() => {});
      throw transport.failure ?? error;
    }
  }

  async call(serverDef, toolName, input, { signal, timeoutMs } = {}) {
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;
    const deadlineSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
    const baseSignal =
      this.#signal && signal
        ? AbortSignal.any([this.#signal, signal])
        : (this.#signal ?? signal ?? null);
    const callSignal = baseSignal && deadlineSignal
      ? AbortSignal.any([baseSignal, deadlineSignal])
      : (baseSignal ?? deadlineSignal);
    if (callSignal?.aborted) throw abortError();

    const startedAt = Date.now();
    const { client } = await this.#getOrConnect(serverDef, { signal: callSignal, deadline });
    const remainingMs = remainingTimeout(deadline);
    const result = await client.callTool(
      { name: toolName, arguments: input ?? {} },
      undefined,
      {
        ...(callSignal ? { signal: callSignal } : {}),
        ...(remainingMs ? { timeout: remainingMs, maxTotalTimeout: remainingMs } : {}),
      },
    );
    return {
      content: result.content,
      isError: result.isError ?? false,
      durationMs: Date.now() - startedAt,
    };
  }

  async close() {
    this.#closed = true;
    const pending = [...this.#connections.values()];
    this.#connections.clear();
    for (const connection of pending) {
      connection.closed = true;
      if (connection.client) {
        void connection.client.close().catch(() => {});
      } else if (connection.transport) {
        void connection.transport.close().catch(() => {});
      }
      // A connection that finishes after close() must still release its
      // transport, but close() itself deliberately never waits on it.
      void connection.promise.then(({ client }) => client.close()).catch(() => {});
    }
  }
}

export function createMcpServerPool(options) {
  return new McpServerPool(options);
}

async function runMcp(serverDef, toolName, input, options) {
  const pool = new McpServerPool(options);
  try {
    return await pool.call(serverDef, toolName, input, options);
  } finally {
    await pool.close();
  }
}
