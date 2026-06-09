import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashFile(path) {
  return `sha256:${sha256Hex(readFileSync(path))}`;
}

export function resolveProtectedStandardsPaths(rootDir, options = {}) {
  return {
    repoStandardsPath: resolve(rootDir, options.repoStandardsPath ?? '.veritas/repo-standards/default.repo-standards.json'),
    repoMapPath: resolve(rootDir, options.repoMapPath ?? '.veritas/repo-map.json'),
    authoritySettingsPath: resolve(rootDir, options.authoritySettingsPath ?? '.veritas/authority/default.authority-settings.json'),
  };
}

export function hashProtectedStandards(rootDir, options = {}) {
  const paths = resolveProtectedStandardsPaths(rootDir, options);
  return {
    repoStandardsHash: hashFile(paths.repoStandardsPath),
    repoMapHash: hashFile(paths.repoMapPath),
    authoritySettingsHash: hashFile(paths.authoritySettingsPath),
    paths: {
      repoStandardsPath: relativeRepoPath(rootDir, paths.repoStandardsPath),
      repoMapPath: relativeRepoPath(rootDir, paths.repoMapPath),
      authoritySettingsPath: relativeRepoPath(rootDir, paths.authoritySettingsPath),
    },
  };
}
