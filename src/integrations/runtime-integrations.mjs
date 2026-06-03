import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { defineRuntimeIntegration } from './contract.mjs';
import {
  applyClaudeCodePostSessionHook,
  applyClaudeCodePreToolUseHook,
  applyGitHook,
  applyRuntimeHook,
  applyStopHook,
  buildClaudeCodeSessionLogCaptureCommand,
} from '../hooks.mjs';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { shellQuote } from '../shell.mjs';

// TODO: replace placeholder uninstall results with integration-specific removal behavior
// or remove uninstall from the public integration action set before stabilizing it.

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

function isExecutable(path) {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function readGitConfigValue(rootDir, key) {
  try {
    return execFileSync('git', ['config', '--local', '--get', key], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hookFileStatus(rootDir, relativePath) {
  const path = resolve(rootDir, relativePath);
  return {
    path: relativePath,
    exists: existsSync(path),
    executable: isExecutable(path),
  };
}

function hookConfigHasCommand(config, hookName, command) {
  const entries = Array.isArray(config?.hooks?.[hookName]) ? config.hooks[hookName] : [];
  return entries.some((entry) => {
    if (entry?.command === command) return true;
    const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
    return hooks.some((hook) => hook?.command === command);
  });
}

function inspectClaudeCodeRuntimeIntegrationStatus(rootDir) {
  const settingsPath = resolve(rootDir, '.claude/settings.json');
  const settings = readJsonIfPresent(settingsPath);
  return {
    preToolUseHook: hookFileStatus(rootDir, '.veritas/hooks/pre-tool-use.sh'),
    stopHook: hookFileStatus(rootDir, '.veritas/hooks/stop.sh'),
    settings: {
      path: '.claude/settings.json',
      exists: settings !== null,
      preToolUseConfigured: hookConfigHasCommand(settings, 'PreToolUse', '.veritas/hooks/pre-tool-use.sh'),
      stopConfigured: hookConfigHasCommand(settings, 'Stop', '.veritas/hooks/stop.sh'),
      postSessionConfigured: hookConfigHasCommand(
        settings,
        'PostSession',
        buildClaudeCodeSessionLogCaptureCommand(),
      ),
    },
  };
}

function inspectGenericStopRuntimeIntegrationStatus(name, rootDir) {
  const toolConfigPath = name === 'cursor' ? '.cursor/hooks.json' : null;
  const toolConfig = toolConfigPath ? readJsonIfPresent(resolve(rootDir, toolConfigPath)) : null;
  return {
    stopHook: hookFileStatus(rootDir, '.veritas/hooks/stop.sh'),
    toolConfig: toolConfigPath
      ? {
          path: toolConfigPath,
          exists: toolConfig !== null,
          stopConfigured: hookConfigHasCommand(toolConfig, 'stop', '.veritas/hooks/stop.sh'),
        }
      : null,
    sessionLogReader: null,
  };
}

export function inspectRuntimeIntegrationStatus(rootDir, options = {}) {
  const postCommitHookPath = resolve(rootDir, '.githooks/post-commit');
  const prePushHookPath = resolve(rootDir, '.githooks/pre-push');
  const runtimeHookPath = resolve(rootDir, '.veritas/hooks/agent-runtime.sh');
  const codexArtifactPath = resolve(rootDir, '.veritas/runtime/codex-hooks.json');
  const configuredHooksPath = readGitConfigValue(rootDir, 'core.hooksPath');
  const codexTarget = inspectCodexHookTarget(rootDir, options);

  const status = {
    gitHook: {
      path: '.githooks/post-commit',
      exists: existsSync(postCommitHookPath),
      executable: isExecutable(postCommitHookPath),
      configuredHooksPath,
      configured: configuredHooksPath === '.githooks',
    },
    prePushHook: {
      path: '.githooks/pre-push',
      exists: existsSync(prePushHookPath),
      executable: isExecutable(prePushHookPath),
      configuredHooksPath,
      configured: configuredHooksPath === '.githooks',
    },
    runtimeHook: {
      path: '.veritas/hooks/agent-runtime.sh',
      exists: existsSync(runtimeHookPath),
      executable: isExecutable(runtimeHookPath),
    },
    codexArtifact: {
      path: '.veritas/runtime/codex-hooks.json',
      exists: existsSync(codexArtifactPath),
    },
    codexTarget,
    nextCommands: [],
  };

  if (!status.gitHook.exists || !status.gitHook.configured) {
    status.nextCommands.push(
      `npm exec -- veritas integrations codex install${status.gitHook.exists ? ' --force' : ''}`,
    );
  } else if (!status.gitHook.executable) {
    status.nextCommands.push('npm exec -- veritas integrations codex install --force');
  }
  if (!status.prePushHook.exists || !status.prePushHook.configured) {
    status.nextCommands.push(
      `npm exec -- veritas apply git-hook --hook pre-push --configure-git${status.prePushHook.exists ? ' --force' : ''}`,
    );
  } else if (!status.prePushHook.executable) {
    status.nextCommands.push('npm exec -- veritas apply git-hook --hook pre-push --configure-git --force');
  }
  if (!status.runtimeHook.exists) {
    status.nextCommands.push('npm exec -- veritas integrations codex install');
  } else if (!status.runtimeHook.executable) {
    status.nextCommands.push('npm exec -- veritas integrations codex install --force');
  }
  if (!status.codexArtifact.exists) {
    status.nextCommands.push('npm exec -- veritas integrations codex install');
  }
  if (!codexTarget.checked) {
    status.nextCommands.push(
      'npm exec -- veritas integrations codex status --codex-home /path/to/.codex',
    );
  } else if (options.codexHome && !codexTarget.integrationInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas integrations codex install --codex-home ${shellQuote(options.codexHome)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  } else if (options.targetHooksFile && !codexTarget.integrationInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas integrations codex install --target-hooks-file ${shellQuote(options.targetHooksFile)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  }

  return status;
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

export function CodexRuntimeIntegration(rootDir, options = {}) {
  return defineRuntimeIntegration({
    name: 'codex',
    installPreToolUseHook() {
      return { installed: false, reason: 'Codex PreToolUse hook is not part of the current integration.' };
    },
    installStopHook() {
      const gitHook = applyGitHook({
        rootDir,
        hook: 'post-commit',
        force: options.force ?? false,
        configureGit: true,
      });
      const prePushHook = applyGitHook({
        rootDir,
        hook: 'pre-push',
        force: options.force ?? false,
        configureGit: true,
      });
      const runtimeHook = applyRuntimeHook({
        rootDir,
        force: options.force ?? false,
      });
      const codexHooks = applyCodexHook({
        rootDir,
        force: options.force ?? false,
        targetHooksFile: options.targetHooksFile,
        codexHome: options.codexHome,
      });
      return { gitHook, prePushHook, runtimeHook, codexHooks };
    },
    installPostSessionHook() {
      return {
        installed: true,
        reason: 'Codex PostSession is included in the tracked codex hooks artifact.',
      };
    },
    uninstall() {
      return { removed: false, reason: 'Uninstall is intentionally manual for now.' };
    },
    status() {
      return inspectRuntimeIntegrationStatus(rootDir, options);
    },
  });
}

export function ClaudeCodeRuntimeIntegration(rootDir, options = {}) {
  return defineRuntimeIntegration({
    name: 'claude-code',
    installPreToolUseHook() {
      return applyClaudeCodePreToolUseHook({ rootDir, force: options.force ?? false });
    },
    installStopHook() {
      return applyStopHook({ rootDir, tool: 'claude-code', force: options.force ?? false });
    },
    installPostSessionHook() {
      return applyClaudeCodePostSessionHook({ rootDir });
    },
    uninstall() {
      return { removed: false, reason: 'Uninstall is intentionally manual for now.' };
    },
    status() {
      return inspectClaudeCodeRuntimeIntegrationStatus(rootDir);
    },
  });
}

export function GenericStopRuntimeIntegration(name, rootDir, options = {}) {
  return defineRuntimeIntegration({
    name,
    installPreToolUseHook() {
      return { installed: false, reason: `${name} only supports generic stop-hook wiring today.` };
    },
    installStopHook() {
      return applyStopHook({ rootDir, tool: name === 'cursor' ? 'cursor' : 'generic', force: options.force ?? false });
    },
    installPostSessionHook() {
      return { installed: false, reason: `${name} has no session log reader yet.` };
    },
    uninstall() {
      return { removed: false, reason: 'Uninstall is intentionally manual for now.' };
    },
    status() {
      return inspectGenericStopRuntimeIntegrationStatus(name, rootDir);
    },
  });
}

export function runtimeIntegrationFor(tool, rootDir, options = {}) {
  if (tool === 'codex') return CodexRuntimeIntegration(rootDir, options);
  if (tool === 'claude-code') return ClaudeCodeRuntimeIntegration(rootDir, options);
  if (tool === 'cursor' || tool === 'copilot') return GenericStopRuntimeIntegration(tool, rootDir, options);
  throw new Error(`Unsupported integration tool: ${tool}`);
}
