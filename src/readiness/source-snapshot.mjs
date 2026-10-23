import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { assertWithinDir } from '../paths.mjs';

// Private execution guard: these digests may include secrets and never enter reports.
export function captureSourceSnapshot(rootDir, timeoutMs, extraPaths = []) {
  const git = (...args) => execFileSync('git', args, {
    cwd: rootDir, encoding: 'utf8', windowsHide: true,
    timeout: timeoutMs ?? 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const explicitPaths = new Set(extraPaths.map((path) => relative(rootDir, resolve(rootDir, path)).replaceAll('\\', '/')));
  const paths = [...new Set([...git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
    .split('\0').filter(Boolean), ...explicitPaths])].sort();
  const entries = new Map();
  for (const path of paths) {
    if (path.startsWith('.kontourai/veritas/') && !explicitPaths.has(path)) continue;
    const absolute = resolve(rootDir, path);
    let stat;
    try { stat = lstatSync(absolute); } catch (error) {
      if (error.code === 'ENOENT') { entries.set(path, 'missing'); continue; }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      entries.set(path, `link:${readlinkSync(absolute)}`);
      continue;
    }
    assertWithinDir(absolute, rootDir, 'Source snapshot paths must stay inside the repository');
    if (!stat.isFile()) throw new Error(`Source snapshot cannot verify non-file input: ${path}`);
    entries.set(path, `${stat.mode}:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`);
  }
  return { head: git('rev-parse', 'HEAD').trim(), index: git('ls-files', '--stage', '-z'), entries, extraPaths };
}

export function assertSourceSnapshotUnchanged(before, rootDir, timeoutMs) {
  const after = captureSourceSnapshot(rootDir, timeoutMs, before.extraPaths);
  const paths = new Set([...before.entries.keys(), ...after.entries.keys()]);
  const changed = [...paths].filter((path) => before.entries.get(path) !== after.entries.get(path));
  if (before.head !== after.head || before.index !== after.index || changed.length) {
    const error = new Error('Repository inputs changed during readiness; evidence is invalid. Restore or finish edits, then rerun readiness.');
    error.code = 'VERITAS_SOURCE_CHANGED';
    // Do not expose hashes or file contents, including low-entropy secret inputs.
    error.changedPaths = changed;
    throw error;
  }
}
