import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadJson } from '../load.mjs';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import {
  buildSuggestedClaudeCodePostSessionHook,
  buildSuggestedClaudeCodePreToolUseHook,
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
} from './suggestions.mjs';

export { applyCiSnippet, applyPackageScripts } from './project-setup.mjs';

function isSymlinkPath(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertWritableHookPath({ rootDir, resolvedOutputPath, messagePrefix }) {
  const hooksDir = resolve(rootDir, '.veritas/hooks');
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);
  if (isSymlinkPath(hooksDir)) {
    throw new Error(`${messagePrefix} refuses to write through a symlinked .veritas/hooks directory`);
  }
  if (isSymlinkPath(dirname(resolvedOutputPath))) {
    throw new Error(`${messagePrefix} refuses to write through a symlinked hook directory`);
  }
  if (isSymlinkPath(resolvedOutputPath)) {
    throw new Error(`${messagePrefix} refuses to write through a symlinked hook file: ${relativeOutputPath}`);
  }
  return relativeOutputPath;
}

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

export function applyRuntimeHook({
  rootDir,
  outputPath = '.veritas/hooks/agent-runtime.sh',
  force = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/hooks'),
    'apply runtime-hook only supports writing inside .veritas/hooks/',
  );
  const relativeOutputPath = assertWritableHookPath({
    rootDir,
    resolvedOutputPath,
    messagePrefix: 'apply runtime-hook',
  });

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, buildSuggestedRuntimeHook(), 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  return {
    rootDir,
    outputPath: relativeOutputPath,
  };
}

function mergeHookArrays(existingHooks = [], veritasHooks = []) {
  const veritasCommands = new Set(
    veritasHooks
      .map((hook) => hook?.command)
      .filter((command) => typeof command === 'string'),
  );
  const preservedHooks = existingHooks.filter(
    (hook) => !veritasCommands.has(hook?.command),
  );
  return [...preservedHooks, ...veritasHooks];
}

function mergeStopHookConfig(existingConfig = {}, suggestedConfig = {}) {
  const mergedHooks = { ...(existingConfig.hooks ?? {}) };
  for (const [hookName, suggestedEntries] of Object.entries(suggestedConfig.hooks ?? {})) {
    const currentEntries = Array.isArray(mergedHooks[hookName])
      ? mergedHooks[hookName]
      : [];
    if (hookName === 'Stop') {
      const suggestedCommand = suggestedEntries[0]?.hooks?.[0]?.command;
      mergedHooks[hookName] = [
        ...currentEntries
          .map((entry) => {
            const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
            const remainingHooks = hooks.filter(
              (hook) => hook?.command !== suggestedCommand,
            );
            return remainingHooks.length === 0
              ? null
              : { ...entry, hooks: remainingHooks };
          })
          .filter(Boolean),
        ...suggestedEntries,
      ];
      continue;
    }
    if (hookName === 'stop') {
      mergedHooks[hookName] = mergeHookArrays(currentEntries, suggestedEntries);
      continue;
    }
    mergedHooks[hookName] = suggestedEntries;
  }

  return {
    ...existingConfig,
    hooks: mergedHooks,
  };
}

export function applyStopHook({
  rootDir,
  tool = 'generic',
  outputPath = '.veritas/hooks/stop.sh',
  force = false,
}) {
  const suggestion = buildSuggestedStopHook({ tool });
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/hooks'),
    'apply stop-hook only supports writing inside .veritas/hooks/',
  );
  const relativeOutputPath = assertWritableHookPath({
    rootDir,
    resolvedOutputPath,
    messagePrefix: 'apply stop-hook',
  });

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, suggestion.hookBody, 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  let configuredToolConfigPath = null;
  if (suggestion.toolConfigPath) {
    const resolvedToolConfigPath = resolve(rootDir, suggestion.toolConfigPath);
    assertWithinDir(
      resolvedToolConfigPath,
      rootDir,
      'apply stop-hook tool config must stay inside the repository',
    );
    const existingConfig = existsSync(resolvedToolConfigPath)
      ? loadJson(resolvedToolConfigPath, `${tool} stop-hook config`)
      : {};
    const mergedConfig = mergeStopHookConfig(existingConfig, suggestion.toolConfig);
    mkdirSync(dirname(resolvedToolConfigPath), { recursive: true });
    writeFileSync(resolvedToolConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
    configuredToolConfigPath = relativeRepoPath(rootDir, resolvedToolConfigPath);
  }

  return {
    rootDir,
    tool,
    outputPath: relativeOutputPath,
    toolConfigPath: suggestion.toolConfigPath ?? null,
    configuredToolConfigPath,
  };
}

export function applyClaudeCodePreToolUseHook({
  rootDir,
  outputPath = '.veritas/hooks/pre-tool-use.sh',
  force = false,
}) {
  const suggestion = buildSuggestedClaudeCodePreToolUseHook();
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/hooks'),
    'apply claude-code-pre-tool-use-hook only supports writing inside .veritas/hooks/',
  );
  const relativeOutputPath = assertWritableHookPath({
    rootDir,
    resolvedOutputPath,
    messagePrefix: 'apply claude-code-pre-tool-use-hook',
  });

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, suggestion.hookBody, 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  const resolvedToolConfigPath = resolve(rootDir, suggestion.toolConfigPath);
  assertWithinDir(
    resolvedToolConfigPath,
    rootDir,
    'apply claude-code pre-tool-use hook config must stay inside the repository',
  );
  const existingConfig = existsSync(resolvedToolConfigPath)
    ? loadJson(resolvedToolConfigPath, 'claude-code pre-tool-use hook config')
    : {};
  const mergedConfig = mergeStopHookConfig(existingConfig, suggestion.toolConfig);
  mkdirSync(dirname(resolvedToolConfigPath), { recursive: true });
  writeFileSync(resolvedToolConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');

  return {
    rootDir,
    outputPath: relativeOutputPath,
    configuredToolConfigPath: relativeRepoPath(rootDir, resolvedToolConfigPath),
  };
}

export function applyClaudeCodePostSessionHook({ rootDir } = {}) {
  const suggestion = buildSuggestedClaudeCodePostSessionHook();
  const resolvedToolConfigPath = resolve(rootDir, suggestion.toolConfigPath);
  assertWithinDir(
    resolvedToolConfigPath,
    rootDir,
    'apply claude-code post-session hook config must stay inside the repository',
  );
  const existingConfig = existsSync(resolvedToolConfigPath)
    ? loadJson(resolvedToolConfigPath, 'claude-code post-session hook config')
    : {};
  const mergedConfig = mergeStopHookConfig(existingConfig, suggestion.toolConfig);
  mkdirSync(dirname(resolvedToolConfigPath), { recursive: true });
  writeFileSync(resolvedToolConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
  return {
    rootDir,
    configuredToolConfigPath: relativeRepoPath(rootDir, resolvedToolConfigPath),
  };
}
