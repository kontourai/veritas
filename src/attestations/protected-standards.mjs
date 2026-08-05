import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';
import { publicRepoMapPolicyIdentity } from '../evidence/public-config.mjs';

export const REPO_MAP_HASH_ALGORITHM = 'public-policy-v1';

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashFile(path) {
  return `sha256:${sha256Hex(readFileSync(path))}`;
}

function hashRepoMapPolicy(path) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  return `sha256:${sha256Hex(publicRepoMapPolicyIdentity(config))}`;
}

// Legacy attestations stored a raw file digest. This comparison deliberately
// returns only a boolean so the legacy digest never crosses an output boundary.
export function matchesLegacyRepoMapHash(rootDir, expectedHash, options = {}) {
  const { repoMapPath } = resolveProtectedStandardsPaths(rootDir, options);
  return expectedHash === hashFile(repoMapPath);
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
    // MCP server arguments, environment, and tool input are execution inputs,
    // not protected policy identity. Every exported Repo Map hash uses this
    // same recursively redacted public projection.
    repoMapHash: hashRepoMapPolicy(paths.repoMapPath),
    repoMapHashAlgorithm: REPO_MAP_HASH_ALGORITHM,
    authoritySettingsHash: hashFile(paths.authoritySettingsPath),
    paths: {
      repoStandardsPath: relativeRepoPath(rootDir, paths.repoStandardsPath),
      repoMapPath: relativeRepoPath(rootDir, paths.repoMapPath),
      authoritySettingsPath: relativeRepoPath(rootDir, paths.authoritySettingsPath),
    },
  };
}
