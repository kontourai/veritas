import { spawn } from 'node:child_process';

export function runBash(command, { cwd, env, timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
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
    let killed = false;
    let timedOut = false;

    function sendSignal(signalName) {
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
      setTimeout(() => {
        sendSignal('SIGKILL');
      }, 2000).unref?.();
    }

    if (timeoutMs) {
      timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    }

    const onAbort = () => { if (timer) { clearTimeout(timer); timer = null; } kill(); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(error);
    });

    child.on('close', (code, sig) => {
      if (timer) clearTimeout(timer);
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
