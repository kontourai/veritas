import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { PREVIOUS_CODEX_HOOK_COMMANDS } from './codex-hook-history.mjs';
import { nearestInstalledVeritasCommand } from '../hooks/nearest-veritas.mjs';
import { windowsInstalledVeritasCommand } from '../hooks/windows-veritas.mjs';
import { assertReplaceableFile, writeGeneratedFile } from '../hooks/write-safety.mjs';

// No session-log capture handler. Earlier releases wrote one under PostSession, an event Codex does
// not have, so it never ran. Codex ends a session with SessionEnd, but its transcript is JSONL rollout
// records that the Codex session log reader does not read, and a SessionEnd hook may run for at most
// 3 seconds (https://learn.chatgpt.com/docs/hooks). A reinstall removes the earlier handler.
export function buildSuggestedCodexHookConfig() {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'apply_patch|Edit|Write',
          hooks: [
            {
              type: 'command',
              command: nearestInstalledVeritasCommand('hooks codex pre-tool-use'),
              commandWindows: windowsInstalledVeritasCommand('hooks codex pre-tool-use'),
              statusMessage: 'Loading Veritas guidance for edited files',
              timeout: 30,
            },
          ],
        },
      ],
      Stop: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: '.veritas/hooks/agent-runtime.sh',
              statusMessage: 'Running Veritas readiness automation',
              timeout: 60,
            },
          ],
        },
      ],
    },
  };
}

// Removes handlers Veritas wrote for this event, the current commands and the exact commands earlier
// releases wrote, then appends the current entries. Any other handler is kept as is.
function mergeHookEntries(existingEntries, integrationEntries, previousCommands = []) {
  const integrationCommands = new Set([
    ...integrationEntries.flatMap((entry) =>
      Array.isArray(entry?.hooks)
        ? entry.hooks.map((hook) => hook?.command).filter(Boolean)
        : [entry?.command].filter(Boolean),
    ),
    ...previousCommands,
  ]);
  const filteredEntries = existingEntries
    .map((entry) => {
      if (integrationCommands.has(entry?.command)) return null;
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const remainingHooks = hooks.filter((hook) => !integrationCommands.has(hook?.command));
      if (hooks.length > 0 && remainingHooks.length === 0) return null;
      if (hooks.length > 0) return { ...entry, hooks: remainingHooks };
      return entry;
    })
    .filter(Boolean);
  return [...filteredEntries, ...integrationEntries];
}

function mergeCodexHooksConfig(existingConfig, integrationConfig) {
  const merged = {
    ...existingConfig,
    hooks: { ...(existingConfig?.hooks ?? {}) },
  };
  // Events Veritas wrote to before and no longer writes to: remove only the recorded handlers, and
  // the event itself when nothing else is left in it.
  for (const [hookName, previousCommands] of Object.entries(PREVIOUS_CODEX_HOOK_COMMANDS)) {
    if (Object.hasOwn(integrationConfig?.hooks ?? {}, hookName)) continue;
    const currentEntries = Array.isArray(merged.hooks[hookName]) ? merged.hooks[hookName] : null;
    if (!currentEntries) continue;
    const remaining = mergeHookEntries(currentEntries, [], previousCommands);
    if (remaining.length === 0 && currentEntries.length > 0) delete merged.hooks[hookName];
    else merged.hooks[hookName] = remaining;
  }
  for (const hookName of Object.keys(integrationConfig?.hooks ?? {})) {
    const integrationEntries = Array.isArray(integrationConfig.hooks[hookName])
      ? integrationConfig.hooks[hookName]
      : [];
    const currentEntries = Array.isArray(merged.hooks[hookName]) ? merged.hooks[hookName] : [];
    merged.hooks[hookName] = mergeHookEntries(
      currentEntries,
      integrationEntries,
      Object.hasOwn(PREVIOUS_CODEX_HOOK_COMMANDS, hookName) ? PREVIOUS_CODEX_HOOK_COMMANDS[hookName] : [],
    );
  }
  return merged;
}

function resolveCodexHooksTarget(rootDir, options = {}) {
  if (options.targetHooksFile && options.codexHome) {
    throw new Error(
      'codex-hook accepts either --target-hooks-file or --codex-home, not both',
    );
  }

  if (options.targetHooksFile) return resolve(rootDir, options.targetHooksFile);
  if (options.codexHome) return resolve(rootDir, options.codexHome, 'hooks.json');
  return null;
}

function hookHandlers(config) {
  return Object.values(config?.hooks ?? {}).flatMap((entries) =>
    (Array.isArray(entries) ? entries : []).flatMap((entry) =>
      Array.isArray(entry?.hooks) ? entry.hooks : [entry],
    ),
  ).filter((hook) => typeof hook?.command === 'string' && hook.command.length > 0);
}

// Installed means every current handler is present with the same command and the same Windows
// override, so a handler written before commandWindows existed reads as needing a reinstall, and no
// handler an earlier release wrote is left, such as the PostSession handler Codex never runs.
function codexHookIntegrationInstalled(installedConfig) {
  const installed = hookHandlers(installedConfig);
  const previous = new Set(Object.values(PREVIOUS_CODEX_HOOK_COMMANDS).flat());
  return hookHandlers(buildSuggestedCodexHookConfig()).every((expected) => installed.some((hook) =>
    hook.command === expected.command && hook.commandWindows === expected.commandWindows))
    && !installed.some((hook) => previous.has(hook.command));
}

function formatTargetPath(rootDir, targetPath) {
  const relativeTargetPath = relativeRepoPath(rootDir, targetPath);
  return relativeTargetPath.startsWith('..')
    ? targetPath.replaceAll('\\', '/')
    : relativeTargetPath;
}

export function inspectCodexHookTarget(rootDir, options = {}) {
  const resolvedTargetPath = resolveCodexHooksTarget(rootDir, options);
  if (!resolvedTargetPath) {
    return {
      resolvedTargetPath: null,
      checked: false,
      targetExists: false,
      integrationInstalled: false,
    };
  }

  const targetExists = existsSync(resolvedTargetPath);
  let integrationInstalled = false;
  if (targetExists) {
    try {
      integrationInstalled = codexHookIntegrationInstalled(JSON.parse(readFileSync(resolvedTargetPath, 'utf8')));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      integrationInstalled = false;
    }
  }

  return {
    resolvedTargetPath: formatTargetPath(rootDir, resolvedTargetPath),
    checked: true,
    targetExists,
    integrationInstalled,
  };
}

export function applyCodexHook({
  rootDir,
  outputPath = '.veritas/runtime/codex-hooks.json',
  force = false,
  targetHooksFile,
  codexHome,
}) {
  resolveCodexHooksTarget(rootDir, { targetHooksFile, codexHome });
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/runtime'),
    'apply codex-hook only supports writing inside .veritas/runtime/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);
  const integrationConfig = buildSuggestedCodexHookConfig();
  const outputContent = `${JSON.stringify(integrationConfig, null, 2)}\n`;
  assertReplaceableFile({ resolvedPath: resolvedOutputPath, relativePath: relativeOutputPath, content: outputContent, force });

  // Read and merge the target hooks file before writing anything, so a malformed one leaves no
  // half-installed artifact behind, and say which file it was.
  const resolvedTargetPath = resolveCodexHooksTarget(rootDir, {
    targetHooksFile,
    codexHome,
  });
  let mergedTargetContent = null;
  if (resolvedTargetPath) {
    let existingConfig = {};
    if (existsSync(resolvedTargetPath)) {
      try {
        existingConfig = JSON.parse(readFileSync(resolvedTargetPath, 'utf8'));
      } catch (error) {
        throw new Error(
          `Failed to read the Codex hooks file at ${formatTargetPath(rootDir, resolvedTargetPath)}: ${error.message}`,
        );
      }
    }
    mergedTargetContent = `${JSON.stringify(mergeCodexHooksConfig(existingConfig, integrationConfig), null, 2)}\n`;
  }

  writeGeneratedFile({ resolvedPath: resolvedOutputPath, content: outputContent });
  let mergedTargetPath = null;
  if (resolvedTargetPath) {
    writeGeneratedFile({ resolvedPath: resolvedTargetPath, content: mergedTargetContent });
    mergedTargetPath = formatTargetPath(rootDir, resolvedTargetPath);
  }

  return {
    rootDir,
    outputPath: relativeOutputPath,
    mergedTargetPath,
  };
}
