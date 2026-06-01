import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import picomatch from 'picomatch';
import { assertWithinDir, normalizeRepoPath } from '../paths.mjs';

export function matchesPatterns(filePath, patterns) {
  let matched = false;

  for (const rawPattern of patterns) {
    if (typeof rawPattern !== 'string' || rawPattern.length === 0) {
      continue;
    }

    const negated = rawPattern.startsWith('!');
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    const patternMatched = pattern.endsWith('/')
      ? filePath.startsWith(pattern)
      : picomatch.scan(pattern).isGlob
        ? picomatch.isMatch(filePath, pattern, { dot: true })
        : filePath === pattern;

    if (patternMatched) {
      matched = !negated;
    }
  }

  return matched;
}

export function matchesPatternsForAnyFile(files, patterns) {
  return files.some((file) => matchesPatterns(file, patterns));
}

export function readAllTrackedFiles(rootDir) {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function matchedFilesForRule(rule, { rootDir, changedFiles = [] }) {
  const patterns = rule.match?.files;
  if (!Array.isArray(patterns)) return [];
  const candidates = changedFiles.length > 0 ? changedFiles : readAllTrackedFiles(rootDir);
  return candidates
    .map((file) => normalizeRepoPath(file, rootDir))
    .filter((file) => matchesPatterns(file, patterns));
}

export function readRepoTextFile(rootDir, filePath) {
  const resolvedPath = resolve(rootDir, filePath);
  assertWithinDir(resolvedPath, rootDir, 'policy rule file reads must stay inside the repository');
  return readFileSync(resolvedPath, 'utf8');
}

export function lineForMatch(content, index) {
  return content.slice(0, index).split('\n').length;
}
