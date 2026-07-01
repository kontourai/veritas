import { parsePrintArgs } from '../args.mjs';
import {
  buildSuggestedPackageScripts,
  buildSuggestedCiSnippet,
} from '../bootstrap.mjs';
import { buildGovernanceBlock } from '../governance.mjs';
import {
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
  buildSuggestedClaudeCodePreToolUseHook,
} from '../hooks.mjs';
import { shellQuote } from '../shell.mjs';
import {
  buildSuggestedCodexHookConfig,
  inspectCodexHookTarget,
  inspectRuntimeIntegrationStatus,
} from '../integrations/runtime-integrations.mjs';
import { resolveSetupCliContext, writeJson } from './setup-context.mjs';

function resolvePrintContext(argv, defaults) {
  return resolveSetupCliContext({ argv, defaults, parseArgs: parsePrintArgs, inferRepoInsights: true });
}

export function runPrintPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const { rootDir, repoInsights, evidenceCheck } = resolvePrintContext(argv, defaults);

  writeJson({
    rootDir,
    evidenceCheck,
    repoInsights,
    scripts: buildSuggestedPackageScripts({
      evidenceCheck,
      baseRef: repoInsights.baseRef,
    }),
  });
}

export function runPrintCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const { rootDir, repoInsights, evidenceCheck } = resolvePrintContext(argv, defaults);

  writeJson({
    rootDir,
    evidenceCheck,
    repoInsights,
    ciSnippet: buildSuggestedCiSnippet({
      evidenceCheck,
      baseRef: repoInsights.baseRef,
    }),
  });
}

export function runPrintGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parsePrintArgs });
  const hook = options.hook ?? 'post-commit';

  writeJson({
    rootDir,
    hook,
    hookBody: buildSuggestedGitHook({ hook }),
    suggestedHooksPath: '.githooks',
  });
}

export function runPrintRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parsePrintArgs });

  writeJson({
    rootDir,
    outputPath: '.veritas/hooks/agent-runtime.sh',
    hookBody: buildSuggestedRuntimeHook(),
    defaultInvocation: '.veritas/hooks/agent-runtime.sh',
  });
}

export function runPrintStopHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parsePrintArgs });
  const tool = options.tool ?? 'generic';
  const suggestion = buildSuggestedStopHook({ tool });

  writeJson({
    rootDir,
    ...suggestion,
  });
}

export function runPrintClaudeCodePreToolUseHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parsePrintArgs });
  writeJson({
    rootDir,
    ...buildSuggestedClaudeCodePreToolUseHook(),
  });
}

export function runPrintGovernanceBlockCli() {
  process.stdout.write(`${buildGovernanceBlock()}\n`);
}

export function runPrintCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parsePrintArgs });
  const targetStatus = inspectCodexHookTarget(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });
  const suggestedApplyCommand = options.codexHome
    ? `npm exec -- veritas apply codex-hook --codex-home ${shellQuote(options.codexHome)}`
    : options.targetHooksFile
      ? `npm exec -- veritas apply codex-hook --target-hooks-file ${shellQuote(options.targetHooksFile)}`
      : null;

  writeJson({
    rootDir,
    outputPath: '.veritas/runtime/codex-hooks.json',
    targetHooksFile: options.targetHooksFile ?? null,
    codexHome: options.codexHome ?? null,
    targetStatus,
    suggestedApplyCommand,
    hookConfig: buildSuggestedCodexHookConfig(),
  });
}

export function runRuntimeStatusCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rootDir } = resolveSetupCliContext({ argv, defaults, parseArgs: parsePrintArgs });
  const status = inspectRuntimeIntegrationStatus(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  writeJson({
    rootDir,
    ...status,
  });
}
