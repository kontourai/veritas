import {
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadJson } from '../load.mjs';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { buildSuggestedCiSnippet, buildSuggestedPackageScripts } from '../bootstrap.mjs';

function isSymlinkPath(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertNotSymlinkPath(path, message) {
  if (isSymlinkPath(path)) throw new Error(message);
}

export function applyPackageScripts({
  rootDir,
  evidenceCheck = 'npm test',
  baseRef = '<base-ref>',
  force = false,
}) {
  const packageJsonPath = resolve(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('apply package-scripts requires package.json at the repo root');
  }
  assertNotSymlinkPath(
    packageJsonPath,
    'apply package-scripts refuses to write through a symlinked package.json',
  );

  const packageJson = loadJson(packageJsonPath, 'package.json');
  const nextScripts = buildSuggestedPackageScripts({ evidenceCheck, baseRef });
  const currentScripts = packageJson.scripts ?? {};

  for (const [key, value] of Object.entries(nextScripts)) {
    if (!force && key in currentScripts && currentScripts[key] !== value) {
      throw new Error(
        `Refusing to overwrite existing script ${key}; rerun with --force if you want to replace it`,
      );
    }
  }

  packageJson.scripts = { ...currentScripts, ...nextScripts };
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  return {
    rootDir,
    packageJsonPath: relativeRepoPath(rootDir, packageJsonPath),
    evidenceCheck,
    baseRef,
    appliedScripts: Object.keys(nextScripts),
  };
}

export function applyCiSnippet({
  rootDir,
  evidenceCheck = 'npm test',
  baseRef = '<base-ref>',
  outputPath = '.veritas/snippets/ci-snippet.yml',
  force = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const snippetsDir = resolve(rootDir, '.veritas/snippets');
  assertWithinDir(
    resolvedOutputPath,
    snippetsDir,
    'apply ci-snippet only supports writing inside .veritas/snippets/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);
  assertNotSymlinkPath(
    snippetsDir,
    'apply ci-snippet refuses to write through a symlinked .veritas/snippets directory',
  );
  assertNotSymlinkPath(
    dirname(resolvedOutputPath),
    'apply ci-snippet refuses to write through a symlinked snippet directory',
  );
  assertNotSymlinkPath(
    resolvedOutputPath,
    `apply ci-snippet refuses to write through a symlinked snippet file: ${relativeOutputPath}`,
  );

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${outputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(snippetsDir, { recursive: true });
  writeFileSync(
    resolvedOutputPath,
    buildSuggestedCiSnippet({ evidenceCheck, baseRef }),
    'utf8',
  );

  return {
    rootDir,
    outputPath: relativeOutputPath,
    evidenceCheck,
    baseRef,
  };
}
