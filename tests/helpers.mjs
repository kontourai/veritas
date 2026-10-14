import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './temp-dir.mjs';

export function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

export function parseCliJson(output) {
  try {
    return JSON.parse(output);
  } catch {}

  for (let index = output.lastIndexOf('{'); index >= 0; index = output.lastIndexOf('{', index - 1)) {
    try {
      return JSON.parse(output.slice(index));
    } catch {}
  }

  throw new Error(`Unable to parse CLI JSON output:\n${output}`);
}

export const repoRootDir = fileURLToPath(new URL('..', import.meta.url));

const GIT_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
];

export function cleanGitEnv(env = process.env) {
  const nextEnv = { ...env };
  for (const key of GIT_ENV_KEYS) delete nextEnv[key];
  return nextEnv;
}

for (const key of GIT_ENV_KEYS) delete process.env[key];

export function execGitFixture(args, options = {}) {
  return execFileSync('git', args, {
    ...options,
    env: cleanGitEnv(options.env),
  });
}

export function readJsonFromAbsolute(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeTempJson(rootDir, relativePath, value) {
  const path = join(rootDir, relativePath);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export function writeTempRepoMap(rootDir, repoMap) {
  const repoMapPath = join(rootDir, '.veritas-repo-map.json');
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  return repoMapPath;
}

export function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

// `git commit` starts `git maintenance run --auto --detach`; from git 2.55 that repacks even a small
// repository (geometric strategy). The detached process outlives the commit, keeps writing into
// `.git` (objects/pack, info/refs), and races the removal of the fixture directory after the test.
// A fixture has no use for it, so any repository a test commits in turns it off.
export function disableGitAutoMaintenance(rootDir) {
  execGitFixture(['config', 'maintenance.auto', 'false'], { cwd: rootDir, encoding: 'utf8' });
  execGitFixture(['config', 'gc.auto', '0'], { cwd: rootDir, encoding: 'utf8' });
}

export function initCommittedRepo(t, prefix) {
  const rootDir = tempDir(t, prefix);
  execGitFixture(['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });
  disableGitAutoMaintenance(rootDir);
  execGitFixture(['config', 'user.name', 'Veritas Tests'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  execGitFixture(['config', 'user.email', 'tests@example.com'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  commitAll(rootDir, 'Initial commit');
  return rootDir;
}

export function commitAll(rootDir, message) {
  execGitFixture(['add', '.'], { cwd: rootDir, encoding: 'utf8' });
  execGitFixture(['commit', '-m', message], { cwd: rootDir, encoding: 'utf8' });
}

// Installs Veritas the way `npm link` or a pnpm workspace does: the package directory is a symlink
// to this checkout and node_modules/.bin/veritas links to its bin. Generated hooks run
// `npx --no @kontourai/veritas`, which needs the package in node_modules, not only a bin on PATH.
export function installLocalVeritasBin(rootDir) {
  const scopeDir = join(rootDir, 'node_modules/@kontourai');
  const binDir = join(rootDir, 'node_modules/.bin');
  mkdirp(scopeDir);
  mkdirp(binDir);
  symlinkSync(repoRootDir, join(scopeDir, 'veritas'), 'dir');
  symlinkSync('../@kontourai/veritas/bin/veritas.mjs', join(binDir, 'veritas'));
}
