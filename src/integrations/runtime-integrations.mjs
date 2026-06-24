import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineRuntimeIntegration } from './contract.mjs';
import {
  applyCodexHook,
  inspectCodexHookTarget,
} from './codex-hooks.mjs';
import {
  applyClaudeCodePostSessionHook,
  applyClaudeCodePreToolUseHook,
  applyGitHook,
  applyRuntimeHook,
  applyStopHook,
  buildClaudeCodeSessionLogCaptureCommand,
} from '../hooks.mjs';
import { shellQuote } from '../shell.mjs';

export {
  applyCodexHook,
  buildCodexSessionLogCaptureCommand,
  buildSuggestedCodexHookConfig,
  inspectCodexHookTarget,
} from './codex-hooks.mjs';

const REPO_HOOKS_SETUP_COMMAND = 'npm exec -- veritas setup repo-hooks';
const REPO_HOOKS_REPAIR_COMMAND = 'npm exec -- veritas setup repo-hooks --force';

function manualUninstallResult() {
  return {
    removed: false,
    capabilityState: 'manual',
    reason: 'Uninstall is intentionally manual for now.',
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
      setupCommand: REPO_HOOKS_SETUP_COMMAND,
      repairCommand: REPO_HOOKS_REPAIR_COMMAND,
    },
    prePushHook: {
      path: '.githooks/pre-push',
      exists: existsSync(prePushHookPath),
      executable: isExecutable(prePushHookPath),
      configuredHooksPath,
      configured: configuredHooksPath === '.githooks',
      setupCommand: REPO_HOOKS_SETUP_COMMAND,
      repairCommand: REPO_HOOKS_REPAIR_COMMAND,
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

  const pushNextCommand = (command) => {
    if (!status.nextCommands.includes(command)) status.nextCommands.push(command);
  };

  if (!status.gitHook.exists || !status.gitHook.configured) {
    pushNextCommand(REPO_HOOKS_SETUP_COMMAND);
  } else if (!status.gitHook.executable) {
    pushNextCommand(REPO_HOOKS_REPAIR_COMMAND);
  }
  if (!status.prePushHook.exists || !status.prePushHook.configured) {
    pushNextCommand(REPO_HOOKS_SETUP_COMMAND);
  } else if (!status.prePushHook.executable) {
    pushNextCommand(REPO_HOOKS_REPAIR_COMMAND);
  }
  if (!status.runtimeHook.exists) {
    pushNextCommand('npm exec -- veritas integrations codex install');
  } else if (!status.runtimeHook.executable) {
    pushNextCommand('npm exec -- veritas integrations codex install --force');
  }
  if (!status.codexArtifact.exists) {
    pushNextCommand('npm exec -- veritas integrations codex install');
  }
  if (!codexTarget.checked) {
    pushNextCommand(
      'npm exec -- veritas integrations codex status --codex-home /path/to/.codex',
    );
  } else if (options.codexHome && !codexTarget.integrationInstalled) {
    pushNextCommand(
      `npm exec -- veritas integrations codex install --codex-home ${shellQuote(options.codexHome)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  } else if (options.targetHooksFile && !codexTarget.integrationInstalled) {
    pushNextCommand(
      `npm exec -- veritas integrations codex install --target-hooks-file ${shellQuote(options.targetHooksFile)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  }

  return status;
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
      return manualUninstallResult();
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
      return manualUninstallResult();
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
      return manualUninstallResult();
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
