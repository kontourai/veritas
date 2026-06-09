import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { buildSuggestedGitHook } from './suggestions.mjs';
import { isSymlinkPath } from './write-safety.mjs';

export function applyGitHook({
  rootDir,
  hook = 'post-commit',
  outputPath = `.githooks/${hook}`,
  force = false,
  configureGit = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const hooksDir = resolve(rootDir, '.githooks');
  assertWithinDir(
    resolvedOutputPath,
    hooksDir,
    'apply git-hook only supports writing inside .githooks/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (isSymlinkPath(hooksDir)) {
    throw new Error('apply git-hook refuses to write through a symlinked .githooks directory');
  }
  if (isSymlinkPath(dirname(resolvedOutputPath))) {
    throw new Error('apply git-hook refuses to write through a symlinked hook directory');
  }
  if (isSymlinkPath(resolvedOutputPath)) {
    throw new Error(`apply git-hook refuses to write through a symlinked hook file: ${relativeOutputPath}`);
  }

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }
  if (configureGit && basename(relativeOutputPath) !== hook) {
    throw new Error(
      `apply git-hook with --configure-git requires the output filename to match ${hook}`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, buildSuggestedGitHook({ hook }), 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  let configuredHooksPath = null;
  if (configureGit) {
    configuredHooksPath = dirname(relativeOutputPath);
    execFileSync('git', ['config', 'core.hooksPath', configuredHooksPath], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    });
  }

  return {
    rootDir,
    hook,
    outputPath: relativeOutputPath,
    configuredHooksPath,
  };
}

function installRepoHook({ rootDir, hook, force }) {
  const outputPath = `.githooks/${hook}`;
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const hooksDir = resolve(rootDir, '.githooks');
  const expectedBody = buildSuggestedGitHook({ hook });

  if (!existsSync(resolvedOutputPath) || force) {
    return applyGitHook({
      rootDir,
      hook,
      outputPath,
      force,
      configureGit: true,
    });
  }

  if (isSymlinkPath(hooksDir)) {
    throw new Error('setup repo-hooks refuses to write through a symlinked .githooks directory');
  }
  if (isSymlinkPath(dirname(resolvedOutputPath))) {
    throw new Error('setup repo-hooks refuses to write through a symlinked hook directory');
  }
  if (isSymlinkPath(resolvedOutputPath)) {
    throw new Error(`apply git-hook refuses to write through a symlinked hook file: ${outputPath}`);
  }

  const currentBody = readFileSync(resolvedOutputPath, 'utf8');
  if (currentBody !== expectedBody) {
    throw new Error(
      `Refusing to overwrite existing file: ${outputPath} (use --force to replace it)`,
    );
  }

  chmodSync(resolvedOutputPath, 0o755);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  });

  return {
    rootDir,
    hook,
    outputPath,
    configuredHooksPath: '.githooks',
  };
}

export function setupRepoHooks({ rootDir, force = false } = {}) {
  const hooks = [
    installRepoHook({ rootDir, hook: 'post-commit', force }),
    installRepoHook({ rootDir, hook: 'pre-push', force }),
  ];

  return {
    rootDir,
    hooks,
    configuredHooksPath: '.githooks',
    setupCommand: 'npm exec -- veritas setup repo-hooks',
  };
}
