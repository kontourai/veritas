import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadJson } from '../load.mjs';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import {
  buildSuggestedClaudeCodePostSessionHook,
  buildSuggestedClaudeCodePreToolUseHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
} from './suggestions.mjs';
import { assertWritableHookPath } from './write-safety.mjs';

export { applyCiSnippet, applyPackageScripts } from './project-setup.mjs';
export { applyGitHook, setupRepoHooks } from './git-hooks.mjs';

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
