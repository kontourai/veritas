import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';

export function buildCodexSessionLogCaptureCommand() {
  return 'VERITAS_SESSION_LOG_PATH="${VERITAS_SESSION_LOG_PATH:-${CODEX_TRANSCRIPT_PATH:-}}"; if [ -z "$VERITAS_SESSION_LOG_PATH" ] && [ -n "$CODEX_SESSION_ID" ]; then VERITAS_SESSION_LOG_PATH="$HOME/.codex/sessions/$CODEX_SESSION_ID.json"; fi; if [ -n "$VERITAS_SESSION_LOG_PATH" ]; then npm exec -- veritas feedback observe --session-log "$VERITAS_SESSION_LOG_PATH"; fi';
}

export function buildSuggestedCodexHookConfig() {
  return {
    hooks: {
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
      PostSession: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: buildCodexSessionLogCaptureCommand(),
              statusMessage: 'Capturing Veritas standards feedback draft from Codex session log',
              timeout: 60,
            },
          ],
        },
      ],
    },
  };
}

function mergeHookEntries(existingEntries, integrationEntries) {
  const integrationCommands = new Set(
    integrationEntries.flatMap((entry) =>
      Array.isArray(entry?.hooks)
        ? entry.hooks.map((hook) => hook?.command).filter(Boolean)
        : [entry?.command].filter(Boolean),
    ),
  );
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
  for (const hookName of Object.keys(integrationConfig?.hooks ?? {})) {
    const integrationEntries = Array.isArray(integrationConfig.hooks[hookName])
      ? integrationConfig.hooks[hookName]
      : [];
    const currentEntries = Array.isArray(merged.hooks[hookName]) ? merged.hooks[hookName] : [];
    merged.hooks[hookName] = mergeHookEntries(currentEntries, integrationEntries);
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

function codexHookIntegrationCommands() {
  return Object.values(buildSuggestedCodexHookConfig().hooks).flatMap((entries) =>
    entries.flatMap((entry) =>
      Array.isArray(entry?.hooks)
        ? entry.hooks.map((hook) => hook?.command).filter(Boolean)
        : [entry?.command].filter(Boolean),
    ),
  );
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
      const parsed = JSON.parse(readFileSync(resolvedTargetPath, 'utf8'));
      const installedCommands = new Set(
        Object.values(parsed?.hooks ?? {}).flatMap((entries) =>
          (Array.isArray(entries) ? entries : []).flatMap((entry) =>
            Array.isArray(entry?.hooks)
              ? entry.hooks.map((hook) => hook?.command).filter(Boolean)
              : [entry?.command].filter(Boolean),
          ),
        ),
      );
      integrationInstalled = codexHookIntegrationCommands().every((command) => installedCommands.has(command));
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

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  const integrationConfig = buildSuggestedCodexHookConfig();
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, `${JSON.stringify(integrationConfig, null, 2)}\n`, 'utf8');

  let mergedTargetPath = null;
  const resolvedTargetPath = resolveCodexHooksTarget(rootDir, {
    targetHooksFile,
    codexHome,
  });
  if (resolvedTargetPath) {
    const existingConfig = existsSync(resolvedTargetPath)
      ? JSON.parse(readFileSync(resolvedTargetPath, 'utf8'))
      : {};
    const mergedConfig = mergeCodexHooksConfig(existingConfig, integrationConfig);
    mkdirSync(dirname(resolvedTargetPath), { recursive: true });
    writeFileSync(resolvedTargetPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
    mergedTargetPath = formatTargetPath(rootDir, resolvedTargetPath);
  }

  return {
    rootDir,
    outputPath: relativeOutputPath,
    mergedTargetPath,
  };
}
