import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineRuntimeAdapter } from './contract.mjs';
import {
  applyClaudeCodePostSessionHook,
  applyClaudeCodePreToolUseHook,
  applyCodexHook,
  applyStopHook,
  inspectRuntimeAdapterStatus,
} from '../hooks.mjs';

// TODO: replace placeholder uninstall results with adapter-specific removal behavior
// or remove uninstall from the public integration action set before stabilizing it.

export function CodexRuntimeAdapter(rootDir, options = {}) {
  return defineRuntimeAdapter({
    name: 'codex',
    installPreToolUseHook() {
      return { installed: false, reason: 'Codex PreToolUse hook is not part of the current adapter.' };
    },
    installStopHook() {
      return applyCodexHook({ rootDir, force: options.force ?? false, targetHooksFile: options.targetHooksFile, codexHome: options.codexHome });
    },
    installPostSessionHook() {
      return applyCodexHook({ rootDir, force: options.force ?? false, targetHooksFile: options.targetHooksFile, codexHome: options.codexHome });
    },
    uninstall() {
      return { removed: false, reason: 'Uninstall is intentionally manual for now.' };
    },
    status() {
      return inspectRuntimeAdapterStatus(rootDir, options);
    },
  });
}

export function ClaudeCodeRuntimeAdapter(rootDir, options = {}) {
  return defineRuntimeAdapter({
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
      return {
        preToolUseHook: existsSync(resolve(rootDir, '.veritas/hooks/pre-tool-use.sh')),
        stopHook: existsSync(resolve(rootDir, '.veritas/hooks/stop.sh')),
        settings: existsSync(resolve(rootDir, '.claude/settings.json')),
      };
    },
  });
}

export function GenericStopRuntimeAdapter(name, rootDir, options = {}) {
  return defineRuntimeAdapter({
    name,
    installPreToolUseHook() {
      return { installed: false, reason: `${name} only supports generic stop-hook wiring today.` };
    },
    installStopHook() {
      return applyStopHook({ rootDir, tool: name === 'cursor' ? 'cursor' : 'generic', force: options.force ?? false });
    },
    installPostSessionHook() {
      return { installed: false, reason: `${name} has no transcript reader yet.` };
    },
    uninstall() {
      return { removed: false, reason: 'Uninstall is intentionally manual for now.' };
    },
    status() {
      return {
        stopHook: existsSync(resolve(rootDir, '.veritas/hooks/stop.sh')),
        transcriptReader: null,
      };
    },
  });
}

export function runtimeAdapterFor(tool, rootDir, options = {}) {
  if (tool === 'codex') return CodexRuntimeAdapter(rootDir, options);
  if (tool === 'claude-code') return ClaudeCodeRuntimeAdapter(rootDir, options);
  if (tool === 'cursor' || tool === 'copilot') return GenericStopRuntimeAdapter(tool, rootDir, options);
  throw new Error(`Unsupported integration tool: ${tool}`);
}
