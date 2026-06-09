import { lstatSync } from 'node:fs';
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
