import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
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

const PROTECTED_STANDARDS_ENTRIES = [
  { field: 'repoStandardsHash', pathKey: 'repoStandardsPath', hash: hashFile },
  // MCP server arguments, environment, and tool input are execution inputs,
  // not protected policy identity. Every exported Repo Map hash uses this
  // same recursively redacted public projection.
  { field: 'repoMapHash', pathKey: 'repoMapPath', hash: hashRepoMapPolicy },
  { field: 'authoritySettingsHash', pathKey: 'authoritySettingsPath', hash: hashFile },
];

function nonRegularEntryType(stat) {
  if (stat.isDirectory()) return 'directory';
  if (stat.isFIFO()) return 'fifo';
  if (stat.isSocket()) return 'socket';
  if (stat.isBlockDevice() || stat.isCharacterDevice()) return 'device';
  return 'other';
}

// The hashes read file content, and reading follows symbolic links. A
// protected file replaced by a link to a byte-identical copy elsewhere would
// keep its hash while the governing bytes moved outside the protected
// location. The entry itself is therefore checked without following links:
// no path component below the repo root may be a link (for a path configured
// outside the root, only the file itself is checked), and the file must be a
// regular file. An entry that cannot be inspected cannot be shown to be
// regular, so it is refused too. Regular-file content hashes are unchanged, so
// existing attestations stay valid. A missing entry returns null here and keeps
// failing exactly as before when it is hashed.
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
    const entryPath = relativeRepoPath(rootDir, component);
    let stat;
    try {
      stat = lstatSync(component);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
      return { entryType: 'uninspectable', entryPath, code: error?.code ?? 'unknown' };
    }
    if (stat.isSymbolicLink()) {
      return { entryType: component === path ? 'symbolic-link' : 'symbolic-link-parent', entryPath };
    }
    if (component === path && !stat.isFile()) {
      return { entryType: nonRegularEntryType(stat), entryPath };
    }
  }
  return null;
}

const ENTRY_TYPE_DESCRIPTIONS = {
  'symbolic-link': () => 'is a symbolic link',
  'symbolic-link-parent': (entry) => `is under a symbolic link at ${entry.entryPath}`,
  directory: () => 'is a directory',
  fifo: () => 'is a named pipe',
  socket: () => 'is a socket',
  device: () => 'is a device file',
  other: () => 'is not a regular file',
  uninspectable: (entry) => `could not be inspected (${entry.code} at ${entry.entryPath})`,
};

export function describeNonRegularProtectedStandardsEntries(entries) {
  const described = entries
    .map((entry) => `${entry.path} ${ENTRY_TYPE_DESCRIPTIONS[entry.entryType](entry)}`)
    .join('; ');
  return `Protected standards must be regular files at their protected paths: ${described}.`;
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

// Hashes each protected entry that is a regular file at its protected path.
// A non-regular entry has no attestable hash: its hash is null and it is
// listed in nonRegular. Errors from hashing a regular or missing entry
// propagate exactly as before.
export function inspectProtectedStandards(rootDir, options = {}) {
  const paths = resolveProtectedStandardsPaths(rootDir, options);
  const hashes = {};
  const nonRegular = [];
  for (const { field, pathKey, hash } of PROTECTED_STANDARDS_ENTRIES) {
    const entry = nonRegularEntry(rootDir, paths[pathKey]);
    if (entry) {
      hashes[field] = null;
      nonRegular.push({ field, path: relativeRepoPath(rootDir, paths[pathKey]), ...entry });
    } else {
      hashes[field] = hash(paths[pathKey]);
    }
  }
  return {
    hashes,
    nonRegular,
    paths: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, relativeRepoPath(rootDir, path)])),
  };
}

export function hashProtectedStandards(rootDir, options = {}) {
  const { hashes, nonRegular, paths } = inspectProtectedStandards(rootDir, options);
  if (nonRegular.length > 0) {
    throw new Error(describeNonRegularProtectedStandardsEntries(nonRegular));
  }
  return {
    repoStandardsHash: hashes.repoStandardsHash,
    repoMapHash: hashes.repoMapHash,
    repoMapHashAlgorithm: REPO_MAP_HASH_ALGORITHM,
    authoritySettingsHash: hashes.authoritySettingsHash,
    paths,
  };
}
