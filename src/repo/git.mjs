import { execFileSync } from 'node:child_process';

export function gitReadOptions(rootDir, timeoutMs = 5000) {
  return {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.max(1, Math.floor(timeoutMs)) : 5000,
  };
}

export function resolveCommitRef(ref, rootDir, timeoutMs) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
      gitReadOptions(rootDir, timeoutMs)).trim();
  } catch (error) {
    throw new Error(`Cannot resolve Git revision ${JSON.stringify(ref)} to a commit: ${error.message}`, { cause: error });
  }
}
