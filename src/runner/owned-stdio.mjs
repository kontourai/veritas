import { existsSync } from 'node:fs';
import { win32 as winPath } from 'node:path';
import crossSpawn from 'cross-spawn';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { deserializeMessage, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

const GRACE_MS = 2_000;
export const DEFAULT_MCP_STDIO_MAX_BUFFER_BYTES = 1_048_576;

/**
 * Resolves Windows command shims before spawning an owned MCP child. The
 * injected inputs make the platform behavior unit-testable on non-Windows
 * hosts; cross-spawn remains the final compatibility layer for PATH/PATHEXT
 * cases this small pre-resolution cannot observe.
 */
export function resolveOwnedStdioCommand(command, {
  platform = process.platform,
  pathValue = process.env.PATH ?? '',
  exists = existsSync,
} = {}) {
  if (platform !== 'win32' || winPath.extname(command)) return command;

  const commandPath = winPath.isAbsolute(command) || command.includes('\\') || command.includes('/');
  const candidates = commandPath
    ? [`${command}.cmd`]
    : pathValue.split(';').filter(Boolean).map((directory) => winPath.join(directory, `${command}.cmd`));
  return candidates.find((candidate) => exists(candidate)) ?? command;
}

/**
 * MCP stdio transport that owns its child process and bounds untrusted stdout.
 * On platforms without process-group signalling, termination falls back to the
 * direct child process.
 */
export class OwnedStdioClientTransport {
  #buffer = Buffer.alloc(0);
  #maxBufferBytes;
  #process = null;
  #closing = false;
  #settled = false;
  #overflowed = false;
  #failure = null;
  #failureWaiters = new Set();
  #escalationTimer = null;

  constructor(server, { maxBufferBytes = DEFAULT_MCP_STDIO_MAX_BUFFER_BYTES } = {}) {
    if (!Number.isSafeInteger(maxBufferBytes) || maxBufferBytes <= 0) {
      throw new TypeError('maxBufferBytes must be a positive integer');
    }
    this.server = server;
    this.#maxBufferBytes = maxBufferBytes;
    this.onclose = undefined;
    this.onerror = undefined;
    this.onmessage = undefined;
  }

  async start() {
    if (this.#process) throw new Error('OwnedStdioClientTransport already started');
    await new Promise((resolve, reject) => {
      const command = resolveOwnedStdioCommand(this.server.command);
      const child = this.#process = crossSpawn(command, this.server.args ?? [], {
        // Match the MCP SDK's deliberately small inherited environment. The
        // parent process commonly carries provider credentials unrelated to
        // this server; only declared server.env may add to the safe baseline.
        env: { ...getDefaultEnvironment(), ...this.server.env },
        cwd: this.server.cwd,
        detached: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.off('error', reject);
        resolve();
      });
      child.on('error', (error) => this.onerror?.(error));
      child.stdout?.on('data', (chunk) => this.#onData(chunk));
      child.stderr?.resume();
      child.stdout?.on('error', (error) => this.onerror?.(error));
      child.stdin?.on('error', (error) => this.onerror?.(error));
      child.on('exit', () => {
        if (!this.#closing || this.#settled) return;
        // The leader just exited, so any surviving member is still in the
        // freshly-owned group. Escalate now; do not leave a delayed PID timer.
        this.#clearEscalation();
        this.#signalGroup('SIGKILL');
      });
      child.on('close', () => this.#settle());
    });
  }

  #onData(chunk) {
    // Check before concatenation so a hostile single chunk cannot transiently
    // allocate an unbounded aggregate. The one cap limits both an incomplete
    // frame and all buffered frames awaiting parse.
    if (this.#overflowed || chunk.length > this.#maxBufferBytes - this.#buffer.length) {
      this.#failBufferLimit();
      return;
    }
    this.#buffer = this.#buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.#buffer, chunk]);
    while (true) {
      try {
        const boundary = this.#buffer.indexOf('\n');
        if (boundary === -1) return;
        const line = this.#buffer.toString('utf8', 0, boundary).replace(/\r$/, '');
        this.#buffer = this.#buffer.subarray(boundary + 1);
        const message = deserializeMessage(line);
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }

  #failBufferLimit() {
    if (this.#overflowed) return;
    this.#overflowed = true;
    const error = new Error(`MCP stdio stdout exceeded ${this.#maxBufferBytes} byte buffer limit`);
    error.code = 'MCP_STDIO_BUFFER_LIMIT';
    this.#failure = error;
    for (const reject of this.#failureWaiters) reject(error);
    this.#failureWaiters.clear();
    this.onerror?.(error);
    void this.close();
  }

  get failure() {
    return this.#failure;
  }

  /**
   * Rejects as soon as a terminal transport failure is known. The MCP SDK
   * reports transport errors to callbacks but does not reject its pending
   * initialize request, so callers that own the connection must also observe
   * this signal to avoid waiting for their request deadline.
   */
  waitForFailure() {
    if (this.#failure) {
      return { promise: Promise.reject(this.#failure), cancel: () => {} };
    }
    let reject;
    const promise = new Promise((_resolve, rejectFailure) => {
      reject = rejectFailure;
      this.#failureWaiters.add(reject);
    });
    return {
      promise,
      cancel: () => this.#failureWaiters.delete(reject),
    };
  }

  #signalGroup(signalName) {
    const child = this.#process;
    if (!child?.pid || this.#settled) return;
    try {
      process.kill(-child.pid, signalName);
    } catch {
      try { child.kill(signalName); } catch { /* already gone */ }
    }
  }

  #clearEscalation() {
    if (this.#escalationTimer) clearTimeout(this.#escalationTimer);
    this.#escalationTimer = null;
  }

  #settle() {
    if (this.#settled) return;
    this.#settled = true;
    this.#clearEscalation();
    this.#process = null;
    this.#buffer = Buffer.alloc(0);
    this.onclose?.();
  }

  async close() {
    const child = this.#process;
    if (!child || this.#settled) return;
    this.#closing = true;
    try { child.stdin?.end(); } catch { /* already gone */ }
    this.#signalGroup('SIGTERM');
    this.#escalationTimer = setTimeout(() => {
      this.#escalationTimer = null;
      this.#signalGroup('SIGKILL');
    }, GRACE_MS);
    this.#escalationTimer.unref?.();
  }

  async send(message) {
    const stdin = this.#process?.stdin;
    if (!stdin) throw new Error('Not connected');
    const serialized = serializeMessage(message);
    await new Promise((resolve, reject) => {
      if (stdin.write(serialized, (error) => error ? reject(error) : resolve())) return;
      stdin.once('drain', resolve);
      stdin.once('error', reject);
    });
  }
}
