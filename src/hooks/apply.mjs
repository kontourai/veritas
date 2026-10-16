import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadJson } from '../load.mjs';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import {
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
} from './suggestions.mjs';
import { mergeStopHookConfig } from './config-merge.mjs';
import { assertReplaceableFile, assertWritableHookPath, writeGeneratedFile } from './write-safety.mjs';

export { applyCiSnippet, applyPackageScripts } from './project-setup.mjs';
export { applyGitHook, installRepoHook, setupRepoHooks } from './git-hooks.mjs';
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

  const hookBody = buildSuggestedRuntimeHook();
  assertReplaceableFile({ resolvedPath: resolvedOutputPath, relativePath: relativeOutputPath, content: hookBody, force });
  writeGeneratedFile({ resolvedPath: resolvedOutputPath, content: hookBody, executable: true });

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

  assertReplaceableFile({ resolvedPath: resolvedOutputPath, relativePath: relativeOutputPath, content: suggestion.hookBody, force });

  // Read and merge the tool config before writing anything, so a malformed config leaves no
  // half-installed hook behind.
  let toolConfigWrite = null;
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
    toolConfigWrite = {
      resolvedPath: resolvedToolConfigPath,
      content: `${JSON.stringify(mergeStopHookConfig(existingConfig, suggestion.toolConfig), null, 2)}\n`,
    };
  }

  writeGeneratedFile({ resolvedPath: resolvedOutputPath, content: suggestion.hookBody, executable: true });
  let configuredToolConfigPath = null;
  if (toolConfigWrite) {
    writeGeneratedFile(toolConfigWrite);
    configuredToolConfigPath = relativeRepoPath(rootDir, toolConfigWrite.resolvedPath);
  }

  return {
    rootDir,
    tool,
    outputPath: relativeOutputPath,
    toolConfigPath: suggestion.toolConfigPath ?? null,
    configuredToolConfigPath,
  };
}
