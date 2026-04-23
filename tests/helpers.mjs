import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

export const frameworkRootDir = fileURLToPath(new URL('..', import.meta.url));

export function readJsonFromAbsolute(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeTempJson(rootDir, relativePath, value) {
  const path = join(rootDir, relativePath);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export function writeTempAdapter(rootDir, adapter) {
  const adapterPath = join(rootDir, '.veritas-repo.adapter.json');
  writeFileSync(adapterPath, `${JSON.stringify(adapter, null, 2)}\n`);
  return adapterPath;
}

export function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

export function initCommittedRepo(prefix) {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Veritas Tests'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  execFileSync('git', ['config', 'user.email', 'tests@example.com'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  commitAll(rootDir, 'Initial commit');
  return rootDir;
}

export function commitAll(rootDir, message) {
  execFileSync('git', ['add', '.'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', message], { cwd: rootDir, encoding: 'utf8' });
}

export function installLocalVeritasBin(rootDir) {
  const binDir = join(rootDir, 'node_modules/.bin');
  mkdirp(binDir);
  const wrapperPath = join(binDir, 'veritas');
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec node ${JSON.stringify(join(frameworkRootDir, 'bin/veritas.mjs'))} "$@"\n`,
    'utf8',
  );
  chmodSync(wrapperPath, 0o755);
}
