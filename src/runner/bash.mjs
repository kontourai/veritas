import { spawn } from 'node:child_process';

export function runBash(command, { cwd, env, timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env, ...env },
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

    function kill() {
      if (killed) return;
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
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
        passed: exitCode === 0,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}
