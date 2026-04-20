#!/usr/bin/env node
import {
  runApplyCiSnippetCli,
  runApplyCodexHookCli,
  runApplyGitHookCli,
  runApplyRuntimeHookCli,
  runApplyPackageScriptsCli,
  runEvalDraftCli,
  runEvalRecordCli,
  runGuidanceReportCli,
  runInitCli,
  runPrintCiSnippetCli,
  runPrintCodexHookCli,
  runPrintGitHookCli,
  runPrintRuntimeHookCli,
  runPrintPackageScriptsCli,
  runShadowRunCli,
} from '../src/index.mjs';

const [subcommand, ...args] = process.argv.slice(2);
const cwd = process.cwd();

if (subcommand === 'init') {
  runInitCli(args, { rootDir: cwd });
} else if (subcommand === 'report') {
  runGuidanceReportCli(args, {
    rootDir: cwd,
  });
} else if (subcommand === 'print') {
  const [kind, ...printArgs] = args;
  if (kind === 'package-scripts') {
    runPrintPackageScriptsCli(printArgs, { rootDir: cwd });
  } else if (kind === 'ci-snippet') {
    runPrintCiSnippetCli(printArgs, { rootDir: cwd });
  } else if (kind === 'git-hook') {
    runPrintGitHookCli(printArgs, { rootDir: cwd });
  } else if (kind === 'runtime-hook') {
    runPrintRuntimeHookCli(printArgs, { rootDir: cwd });
  } else if (kind === 'codex-hook') {
    runPrintCodexHookCli(printArgs, { rootDir: cwd });
  } else {
    process.stderr.write(`Usage:
  ai-guidance print package-scripts [--root <path>] [--proof-lane <cmd>]
  ai-guidance print ci-snippet [--root <path>] [--proof-lane <cmd>]
  ai-guidance print git-hook [--root <path>] [--hook post-commit]
  ai-guidance print runtime-hook [--root <path>]
  ai-guidance print codex-hook [--root <path>] [--target-hooks-file <path>]
`);
    process.exitCode = 1;
  }
} else if (subcommand === 'apply') {
  const [kind, ...applyArgs] = args;
  if (kind === 'package-scripts') {
    runApplyPackageScriptsCli(applyArgs, { rootDir: cwd });
  } else if (kind === 'ci-snippet') {
    runApplyCiSnippetCli(applyArgs, { rootDir: cwd });
  } else if (kind === 'git-hook') {
    runApplyGitHookCli(applyArgs, { rootDir: cwd });
  } else if (kind === 'runtime-hook') {
    runApplyRuntimeHookCli(applyArgs, { rootDir: cwd });
  } else if (kind === 'codex-hook') {
    runApplyCodexHookCli(applyArgs, { rootDir: cwd });
  } else {
    process.stderr.write(`Usage:
  ai-guidance apply package-scripts [--root <path>] [--proof-lane <cmd>] [--force]
  ai-guidance apply ci-snippet [--root <path>] [--output <path>] [--proof-lane <cmd>] [--force]
  ai-guidance apply git-hook [--root <path>] [--hook post-commit] [--output <path>] [--configure-git] [--force]
  ai-guidance apply runtime-hook [--root <path>] [--output <path>] [--force]
  ai-guidance apply codex-hook [--root <path>] [--output <path>] [--target-hooks-file <path>] [--force]
`);
    process.exitCode = 1;
  }
} else if (subcommand === 'eval') {
  const [kind, ...evalArgs] = args;
  if (kind === 'record') {
    runEvalRecordCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'draft') {
    runEvalDraftCli(evalArgs, { rootDir: cwd });
  } else {
    process.stderr.write(`Usage:
  ai-guidance eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
    [--reviewer-confidence <scale-entry|unknown>]
    [--time-to-green-minutes <number>]
    [--override-count <number>]
    [--false-positive-rule <rule-id>]
    [--missed-issue <text>]
    [--note <text>]
  ai-guidance eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  ai-guidance eval record --draft <path> [--team-profile <path>] [--output <path>] [--force]
    --accepted-without-major-rewrite <true|false>
    --required-followup <true|false>
    --reviewer-confidence <scale-entry|unknown>
    --time-to-green-minutes <number>
    --override-count <number>
    [--false-positive-rule <rule-id>]
    [--missed-issue <text>]
    [--note <text>]
`);
    process.exitCode = 1;
  }
} else if (subcommand === 'shadow') {
  const [kind, ...shadowArgs] = args;
  if (kind === 'run') {
    runShadowRunCli(shadowArgs, { rootDir: cwd });
  } else {
    process.stderr.write(`Usage:
  ai-guidance shadow run [--root <path>] [--adapter <path>] [--policy-pack <path>] [--team-profile <path>]
    [--proof-command <cmd>] [--skip-proof]
    [--working-tree | --changed-from <ref> --changed-to <ref>]
    [--run-id <id>]
    [--reviewer-confidence <scale-entry|unknown>]
    [--time-to-green-minutes <number>]
    [--override-count <number>]
    [--false-positive-rule <rule-id>]
    [--missed-issue <text>]
    [--note <text>]
    [--accepted-without-major-rewrite <true|false>]
    [--required-followup <true|false>]
    [--force]
`);
    process.exitCode = 1;
  }
} else {
  process.stderr.write(`Usage:
  ai-guidance init [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--force]
  ai-guidance report [--adapter <path>] [--policy-pack <path>] [--working-tree | --staged | --unstaged | --untracked | --changed-from <ref> --changed-to <ref>] [file ...]
  ai-guidance shadow run [--root <path>] [--adapter <path>] [--policy-pack <path>] [--team-profile <path>] [--proof-command <cmd>] [--skip-proof]
  ai-guidance eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  ai-guidance eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false> --reviewer-confidence <scale-entry|unknown> --time-to-green-minutes <number> --override-count <number>
  ai-guidance eval record --draft <path> [--team-profile <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false>
  ai-guidance print package-scripts [--root <path>] [--proof-lane <cmd>]
  ai-guidance print ci-snippet [--root <path>] [--proof-lane <cmd>]
  ai-guidance print git-hook [--root <path>] [--hook post-commit]
  ai-guidance print runtime-hook [--root <path>]
  ai-guidance print codex-hook [--root <path>] [--target-hooks-file <path>]
  ai-guidance apply package-scripts [--root <path>] [--proof-lane <cmd>] [--force]
  ai-guidance apply ci-snippet [--root <path>] [--output <path>] [--proof-lane <cmd>] [--force]
  ai-guidance apply git-hook [--root <path>] [--hook post-commit] [--output <path>] [--configure-git] [--force]
  ai-guidance apply runtime-hook [--root <path>] [--output <path>] [--force]
  ai-guidance apply codex-hook [--root <path>] [--output <path>] [--target-hooks-file <path>] [--force]
`);
  process.exitCode = 1;
}
