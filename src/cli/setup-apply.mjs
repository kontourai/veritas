import { parseApplyArgs, parseSetupArgs } from '../args.mjs';
import { applyGovernanceBlocks } from '../governance.mjs';
import {
  applyPackageScripts,
  applyCiSnippet,
  applyGitHook,
  setupRepoHooks,
  applyRuntimeHook,
  applyStopHook,
  applyClaudeCodePreToolUseHook,
} from '../hooks.mjs';
import { applyCodexHook } from '../integrations/runtime-integrations.mjs';
import { resolveSetupCliContext, writeJson } from './setup-context.mjs';

function resolveApplyContext(argv, defaults) {
  return resolveSetupCliContext({ argv, defaults, parseArgs: parseApplyArgs, inferRepoInsights: true });
}

export function runApplyPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir, repoInsights, evidenceCheck } = resolveApplyContext(argv, defaults);
  const result = applyPackageScripts({
    rootDir,
    evidenceCheck,
    baseRef: repoInsights.baseRef,
    force: options.force ?? false,
  });

  writeJson({
    ...result,
    repoInsights,
  });
}

export function runApplyCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir, repoInsights, evidenceCheck } = resolveApplyContext(argv, defaults);
  const result = applyCiSnippet({
    rootDir,
    evidenceCheck,
    baseRef: repoInsights.baseRef,
    outputPath: options.outputPath ?? '.veritas/snippets/ci-snippet.yml',
    force: options.force ?? false,
  });

  writeJson({
    ...result,
    repoInsights,
  });
}

export function runApplyGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parseApplyArgs });
  const hook = options.hook ?? 'post-commit';
  const result = applyGitHook({
    rootDir,
    hook,
    outputPath: options.outputPath ?? `.githooks/${hook}`,
    force: options.force ?? false,
    configureGit: options.configureGit ?? false,
  });

  writeJson(result);
}

export function runSetupRepoHooksCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parseSetupArgs });
  const result = setupRepoHooks({
    rootDir,
    force: options.force ?? false,
  });

  writeJson(result);
}

export function runApplyRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parseApplyArgs });
  const result = applyRuntimeHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/hooks/agent-runtime.sh',
    force: options.force ?? false,
  });

  writeJson(result);
}

export function runApplyStopHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parseApplyArgs });
  const result = applyStopHook({
    rootDir,
    tool: options.tool ?? 'generic',
    outputPath: options.outputPath ?? '.veritas/hooks/stop.sh',
    force: options.force ?? false,
  });

  writeJson(result);
}

export function runApplyClaudeCodePreToolUseHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parseApplyArgs });
  const result = applyClaudeCodePreToolUseHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/hooks/pre-tool-use.sh',
    force: options.force ?? false,
  });

  writeJson(result);
}

export function runApplyGovernanceBlocksCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parseApplyArgs });
  const result = applyGovernanceBlocks({
    rootDir,
    force: options.force ?? false,
  });

  writeJson(result);
}

export function runApplyCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parseApplyArgs });
  const result = applyCodexHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/runtime/codex-hooks.json',
    force: options.force ?? false,
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  writeJson(result);
}
