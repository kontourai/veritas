import { resolve } from 'node:path';
import { parseApplyArgs, parseSetupArgs } from '../args.mjs';
import { inferBootstrapRepoInsights } from '../bootstrap.mjs';
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

export function runApplyPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const evidenceCheck = options.evidenceCheck ?? repoInsights.evidenceCheck;
  const result = applyPackageScripts({
    rootDir,
    evidenceCheck,
    baseRef: repoInsights.baseRef,
    force: options.force ?? false,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        repoInsights,
      },
      null,
      2,
    )}\n`,
  );
}

export function runApplyCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const evidenceCheck = options.evidenceCheck ?? repoInsights.evidenceCheck;
  const result = applyCiSnippet({
    rootDir,
    evidenceCheck,
    baseRef: repoInsights.baseRef,
    outputPath: options.outputPath ?? '.veritas/snippets/ci-snippet.yml',
    force: options.force ?? false,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        repoInsights,
      },
      null,
      2,
    )}\n`,
  );
}

export function runApplyGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const hook = options.hook ?? 'post-commit';
  const result = applyGitHook({
    rootDir,
    hook,
    outputPath: options.outputPath ?? `.githooks/${hook}`,
    force: options.force ?? false,
    configureGit: options.configureGit ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runSetupRepoHooksCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseSetupArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = setupRepoHooks({
    rootDir,
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyRuntimeHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/hooks/agent-runtime.sh',
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyStopHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyStopHook({
    rootDir,
    tool: options.tool ?? 'generic',
    outputPath: options.outputPath ?? '.veritas/hooks/stop.sh',
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyClaudeCodePreToolUseHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyClaudeCodePreToolUseHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/hooks/pre-tool-use.sh',
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyGovernanceBlocksCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyGovernanceBlocks({
    rootDir,
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyCodexHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/runtime/codex-hooks.json',
    force: options.force ?? false,
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
