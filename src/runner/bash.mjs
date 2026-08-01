import { spawn } from 'node:child_process';

export function runBash(command, { cwd, env, timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Bash command aborted');
      error.name = 'AbortError';
      reject(error);
      return;
    }

    const startedAt = Date.now();
    const child = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env, ...env },
      // On POSIX, give the command its own process group so a timeout also
      // reaches shell/npm/make descendants that inherit stdout or stderr.
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    let timer = null;
    let escalationTimer = null;
    let killed = false;
    let timedOut = false;
    let settled = false;

    function sendSignal(signalName) {
      if (settled) return;
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signalName);
          return;
        } catch {
          // The process group can already be gone; fall back to the shell.
        }
      }
      try { child.kill(signalName); } catch { /* already gone */ }
    }

    function kill() {
      if (killed) return;
      killed = true;
      sendSignal('SIGTERM');
      escalationTimer = setTimeout(() => {
        sendSignal('SIGKILL');
      }, 2000).unref?.();
    }

    if (timeoutMs) {
      timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    }

    const onAbort = () => { if (timer) { clearTimeout(timer); timer = null; } kill(); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.on('exit', () => {
      if (!killed || settled || process.platform === 'win32') return;
      // The shell can exit while a redirected descendant still owns no stdio
      // handles, so `close` can arrive before the grace timer. Kill the known
      // group while the leader PID is still fresh instead of retaining a late
      // negative-PID timer that could target a recycled process group.
      if (escalationTimer) {
        clearTimeout(escalationTimer);
        escalationTimer = null;
      }
      sendSignal('SIGKILL');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(error);
    });

    child.on('close', (code, sig) => {
      if (settled) return;
      // Mark completion before clearing the escalation. This prevents a late
      // timer from signalling a recycled POSIX process group after close.
      settled = true;
      if (timer) clearTimeout(timer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        const error = new Error('Bash command aborted');
        error.name = 'AbortError';
        reject(error);
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const exitCode = code ?? null;
      resolve({
        exitCode,
        signal: sig ?? null,
        passed: exitCode === 0 && !timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}
