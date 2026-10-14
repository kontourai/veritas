import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';
import { publicRepoMapPolicyIdentity } from '../evidence/public-config.mjs';

export const REPO_MAP_HASH_ALGORITHM = 'public-policy-v1';

const PROTECTED_STANDARDS_FIELDS = [
  ['repoStandardsHash', 'repoStandardsPath'],
  ['repoMapHash', 'repoMapPath'],
  ['authoritySettingsHash', 'authoritySettingsPath'],
];

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

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

// The hashes read file content, and reading follows symbolic links. A
// protected file replaced by a link to a byte-identical copy elsewhere would
// keep its hash while the governing bytes moved outside the protected
// location. The entry itself is therefore checked without following links:
// no path component below the repo root may be a link (for a path configured
// outside the root, only the file itself is checked), and the file must be a
// regular file. Regular-file content hashes are unchanged, so existing
// attestations stay valid. A missing entry returns null here and keeps failing
// exactly as before when it is hashed.
function nonRegularEntry(rootDir, path) {
  const fromRoot = relative(rootDir, path);
  const insideRoot = fromRoot !== ''
    && fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
  const components = [];
  if (insideRoot) {
    let current = rootDir;
    for (const segment of fromRoot.split(sep)) {
      current = resolve(current, segment);
      components.push(current);
    }
  } else {
    components.push(path);
  }
  for (const component of components) {
    const stat = lstatOrNull(component);
    if (!stat) return null;
    if (stat.isSymbolicLink()) {
      return {
        entryType: component === path ? 'symbolic-link' : 'symbolic-link-parent',
        entryPath: relativeRepoPath(rootDir, component),
      };
    }
    if (component === path && !stat.isFile()) {
      return {
        entryType: stat.isDirectory() ? 'directory' : 'other',
        entryPath: relativeRepoPath(rootDir, component),
      };
    }
  }
  return null;
}

export function findNonRegularProtectedStandardsEntries(rootDir, options = {}) {
  const paths = resolveProtectedStandardsPaths(rootDir, options);
  return PROTECTED_STANDARDS_FIELDS.flatMap(([field, pathKey]) => {
    const entry = nonRegularEntry(rootDir, paths[pathKey]);
    return entry ? [{ field, path: relativeRepoPath(rootDir, paths[pathKey]), ...entry }] : [];
  });
}

export function describeNonRegularProtectedStandardsEntries(entries) {
  const described = entries
    .map((entry) => `${entry.path} (${entry.entryType}${entry.entryPath === entry.path ? '' : ` at ${entry.entryPath}`})`)
    .join(', ');
  return `Protected standards must be regular files at their protected paths, not symbolic links: ${described}.`;
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
  const nonRegular = findNonRegularProtectedStandardsEntries(rootDir, options);
  if (nonRegular.length > 0) {
    throw new Error(describeNonRegularProtectedStandardsEntries(nonRegular));
  }
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
