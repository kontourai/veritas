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
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
} from './suggestions.mjs';
import { mergeStopHookConfig } from './config-merge.mjs';
import { assertWritableHookPath } from './write-safety.mjs';

export { applyCiSnippet, applyPackageScripts } from './project-setup.mjs';
export { applyGitHook, setupRepoHooks } from './git-hooks.mjs';
export {
  applyClaudeCodePostSessionHook,
  applyClaudeCodePreToolUseHook,
} from './claude-code.mjs';

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
