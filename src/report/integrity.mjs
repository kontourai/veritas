import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { assertWithinDir, normalizeRepoPath, relativeRepoPath } from '../paths.mjs';
import { resolveGitHead, stagedDiffSha256 } from '../shell.mjs';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function resolveSourceRef({ explicitSourceRef, rootDir, sourceKind = 'explicit-files' } = {}) {
  if (explicitSourceRef) return explicitSourceRef;
  const head = rootDir ? resolveGitHead(rootDir) : null;
  if (head && sourceKind !== 'working-tree') return head;
  const hash = rootDir ? stagedDiffSha256(rootDir) : sha256Hex('');
  return `working-tree:${hash}`;
}

function sha256Ref(value) {
  return `sha256:${sha256Hex(value)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fileIntegrityRef(rootDir, repoPath) {
  const path = normalizeRepoPath(repoPath, rootDir);
  const absolutePath = resolve(rootDir, path);
  try {
    assertWithinDir(absolutePath, rootDir, `Cannot hash file outside repo: ${repoPath}`);
    if (!existsSync(absolutePath)) return { path, status: 'missing' };
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return { path, status: stat.isDirectory() ? 'directory' : 'non-file' };
    return {
      path,
      hash: sha256Ref(readFileSync(absolutePath)),
      sizeBytes: stat.size,
    };
  } catch (error) {
    return {
      path,
      status: 'unreadable',
      error: error.message,
    };
  }
}

function configIntegrityRef({ name, value, path, rootDir }) {
  const ref = { name };
  if (path && rootDir) ref.path = relativeRepoPath(rootDir, path);
  try {
    if (path && existsSync(path)) {
      ref.hash = sha256Ref(readFileSync(path));
      return ref;
    }
  } catch (error) {
    ref.status = 'unreadable';
    ref.error = error.message;
  }
  ref.hash = sha256Ref(stableStringify(value ?? null));
  return ref;
}

export function buildEvidenceIntegrity({
  rootDir,
  normalizedFiles,
  sourceRef,
  sourceKind,
  sourceScope,
  config,
  repoStandards,
  options,
}) {
  const sources = options.integritySources ?? {};
  return {
    sourceRef,
    sourceKind,
    sourceScope,
    fileRefs: rootDir
      ? normalizedFiles.map((file) => fileIntegrityRef(rootDir, file))
      : normalizedFiles.map((file) => ({ path: file, status: 'not-hashed' })),
    configRefs: {
      repoMap: configIntegrityRef({
        name: config.name ?? config.repoMap?.name ?? 'repo-map',
        value: config,
        path: sources.repoMapPath,
        rootDir,
      }),
      repoStandards: configIntegrityRef({
        name: repoStandards.name ?? 'repo-standards',
        value: repoStandards,
        path: sources.repoStandardsPath,
        rootDir,
      }),
      ...(sources.authoritySettingsPath ? {
        authoritySettings: configIntegrityRef({
          name: 'authority-settings',
          value: null,
          path: sources.authoritySettingsPath,
          rootDir,
        }),
      } : {}),
    },
  };
}
