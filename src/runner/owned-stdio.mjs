import { spawn } from 'node:child_process';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

const GRACE_MS = 2_000;

/**
 * POSIX-only MCP stdio transport that owns the complete server process group.
 * The SDK transport is retained on Windows, where negative PID signalling is
 * unavailable and the native child termination behavior remains compatible.
 */
export class OwnedStdioClientTransport {
  #readBuffer = new ReadBuffer();
  #process = null;
  #closing = false;
  #settled = false;
  #escalationTimer = null;

  constructor(server) {
    this.server = server;
    this.onclose = undefined;
    this.onerror = undefined;
    this.onmessage = undefined;
  }

  async start() {
    if (this.#process) throw new Error('OwnedStdioClientTransport already started');
    await new Promise((resolve, reject) => {
      const child = this.#process = spawn(this.server.command, this.server.args ?? [], {
        env: { ...process.env, ...this.server.env },
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
    this.#readBuffer.append(chunk);
    while (true) {
      try {
        const message = this.#readBuffer.readMessage();
        if (message === null) return;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
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
    this.#readBuffer.clear();
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
