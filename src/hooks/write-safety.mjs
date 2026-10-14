import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';

export function isSymlinkPath(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function assertWritableHookPath({ rootDir, resolvedOutputPath, messagePrefix }) {
  const hooksDir = resolve(rootDir, '.veritas/hooks');
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);
  if (isSymlinkPath(hooksDir)) {
    throw new Error(`${messagePrefix} refuses to write through a symlinked .veritas/hooks directory`);
  }
  if (isSymlinkPath(dirname(resolvedOutputPath))) {
    throw new Error(`${messagePrefix} refuses to write through a symlinked hook directory`);
  }
  if (isSymlinkPath(resolvedOutputPath)) {
    throw new Error(`${messagePrefix} refuses to write through a symlinked hook file: ${relativeOutputPath}`);
  }
  return relativeOutputPath;
}

// Refuses an existing file that differs from what Veritas would write, unless forced. A file that
// already holds exactly that content is accepted, so rerunning an install, or retrying one that
// stopped on a malformed tool config, does not need --force.
export function assertReplaceableFile({ resolvedPath, relativePath, content, force }) {
  if (force || !existsSync(resolvedPath)) return;
  if (readFileSync(resolvedPath, 'utf8') === content) return;
  throw new Error(`Refusing to overwrite existing file: ${relativePath} (use --force to replace it)`);
}

export function writeGeneratedFile({ resolvedPath, content, executable = false }) {
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, content, 'utf8');
  if (executable) chmodSync(resolvedPath, 0o755);
}
