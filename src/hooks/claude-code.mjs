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
  CLAUDE_CODE_SESSION_END_MARKER,
  buildSuggestedClaudeCodePostSessionHook,
  buildSuggestedClaudeCodePreToolUseHook,
} from './suggestions.mjs';
import { mergeStopHookConfig } from './config-merge.mjs';
import { PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS } from './claude-code-hook-history.mjs';
import { assertWritableHookPath } from './write-safety.mjs';

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

// Removes the handlers under one event that `isVeritas` identifies, and the event itself when nothing
// else is left in it. Every other handler is kept as it is.
function withoutVeritasHandlers(config, event, isVeritas) {
  const entries = config?.hooks?.[event];
  if (!Array.isArray(entries)) return config;
  const remaining = entries
    .map((entry) => {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const kept = hooks.filter((hook) => !isVeritas(hook?.command));
      if (hooks.length > 0 && kept.length === 0) return null;
      return kept.length === hooks.length ? entry : { ...entry, hooks: kept };
    })
    .filter(Boolean);
  const hooks = { ...config.hooks };
  if (remaining.length === 0 && entries.length > 0) delete hooks[event];
  else hooks[event] = remaining;
  return { ...config, hooks };
}

const PREVIOUS_POST_SESSION = new Set(PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS);
// The PostSession handlers earlier releases wrote, matched by exact command.
const isPreviousPostSessionHandler = (command) => PREVIOUS_POST_SESSION.has(command);
// A SessionEnd capture any Veritas wrote: its command ends with the marker.
const isVeritasSessionEndHandler = (command) => typeof command === 'string'
  && command.endsWith(` ${CLAUDE_CODE_SESSION_END_MARKER}`);

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
  const mergedConfig = mergeStopHookConfig(
    withoutVeritasHandlers(
      withoutVeritasHandlers(existingConfig, 'PostSession', isPreviousPostSessionHandler),
      'SessionEnd',
      isVeritasSessionEndHandler,
    ),
    suggestion.toolConfig,
  );
  mkdirSync(dirname(resolvedToolConfigPath), { recursive: true });
  writeFileSync(resolvedToolConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
  return {
    rootDir,
    configuredToolConfigPath: relativeRepoPath(rootDir, resolvedToolConfigPath),
  };
}
