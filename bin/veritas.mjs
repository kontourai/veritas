#!/usr/bin/env node
import {
  runApplyCiSnippetCli,
  runApplyCodexHookCli,
  runApplyGitHookCli,
  runApplyRuntimeHookCli,
  runApplyPackageScriptsCli,
  runEvalDraftCli,
  runEvalRecordCli,
  runVeritasReportCli,
  runInitCli,
  runPrintCiSnippetCli,
  runPrintCodexHookCli,
  runPrintGitHookCli,
  runPrintRuntimeHookCli,
  runPrintPackageScriptsCli,
  runRuntimeStatusCli,
  runShadowRunCli,
} from '../src/index.mjs';

const MAIN_USAGE = `Usage:
  veritas init [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--force]
  veritas report [--root <path>] [--adapter <path>] [--policy-pack <path>] [--working-tree | --staged | --unstaged | --untracked | --changed-from <ref> --changed-to <ref>] [--run-id <id>] [file ...]
  veritas shadow run [--root <path>] [--adapter <path>] [--policy-pack <path>] [--team-profile <path>] [--proof-command <cmd>] [--skip-proof]
  veritas runtime status [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
  veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  veritas eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false> --reviewer-confidence <scale-entry|unknown> --time-to-green-minutes <number> --override-count <number>
  veritas eval record --draft <path> [--team-profile <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false>
  veritas print package-scripts [--root <path>] [--proof-lane <cmd>]
  veritas print ci-snippet [--root <path>] [--proof-lane <cmd>]
  veritas print git-hook [--root <path>] [--hook post-commit]
  veritas print runtime-hook [--root <path>]
  veritas print codex-hook [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
  veritas apply package-scripts [--root <path>] [--proof-lane <cmd>] [--force]
  veritas apply ci-snippet [--root <path>] [--output <path>] [--proof-lane <cmd>] [--force]
  veritas apply git-hook [--root <path>] [--hook post-commit] [--output <path>] [--configure-git] [--force]
  veritas apply runtime-hook [--root <path>] [--output <path>] [--force]
  veritas apply codex-hook [--root <path>] [--output <path>] [--target-hooks-file <path> | --codex-home <path>] [--force]
`;

const REPORT_USAGE = `Usage:
  veritas report [--root <path>] [--adapter <path>] [--policy-pack <path>] [--working-tree | --staged | --unstaged | --untracked | --changed-from <ref> --changed-to <ref>] [--run-id <id>] [file ...]
`;

const PRINT_USAGE = `Usage:
  veritas print package-scripts [--root <path>] [--proof-lane <cmd>]
  veritas print ci-snippet [--root <path>] [--proof-lane <cmd>]
  veritas print git-hook [--root <path>] [--hook post-commit]
  veritas print runtime-hook [--root <path>]
  veritas print codex-hook [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
`;

const APPLY_USAGE = `Usage:
  veritas apply package-scripts [--root <path>] [--proof-lane <cmd>] [--force]
  veritas apply ci-snippet [--root <path>] [--output <path>] [--proof-lane <cmd>] [--force]
  veritas apply git-hook [--root <path>] [--hook post-commit] [--output <path>] [--configure-git] [--force]
  veritas apply runtime-hook [--root <path>] [--output <path>] [--force]
  veritas apply codex-hook [--root <path>] [--output <path>] [--target-hooks-file <path> | --codex-home <path>] [--force]
`;

const EVAL_USAGE = `Usage:
  veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
    [--reviewer-confidence <scale-entry|unknown>]
    [--time-to-green-minutes <number>]
    [--override-count <number>]
    [--false-positive-rule <rule-id>]
    [--missed-issue <text>]
    [--note <text>]
  veritas eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  veritas eval record --draft <path> [--team-profile <path>] [--output <path>] [--force]
    --accepted-without-major-rewrite <true|false>
    --required-followup <true|false>
    --reviewer-confidence <scale-entry|unknown>
    --time-to-green-minutes <number>
    --override-count <number>
    [--false-positive-rule <rule-id>]
    [--missed-issue <text>]
    [--note <text>]
`;

const SHADOW_USAGE = `Usage:
  veritas shadow run [--root <path>] [--adapter <path>] [--policy-pack <path>] [--team-profile <path>]
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
`;

const RUNTIME_USAGE = `Usage:
  veritas runtime status [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
`;

function isHelpToken(token) {
  return token === '--help' || token === '-h' || token === 'help';
}

function writeStdout(text) {
  process.stdout.write(text);
}

function writeStderr(text) {
  process.stderr.write(text);
}

function selectScopedUsage(kind, fallback, scoped = {}) {
  return scoped[kind] ?? fallback;
}

const [subcommand, ...args] = process.argv.slice(2);
const cwd = process.cwd();

if (!subcommand || isHelpToken(subcommand)) {
  writeStdout(MAIN_USAGE);
} else if (subcommand === 'init') {
  if (args.some(isHelpToken)) {
    writeStdout('Usage:\n  veritas init [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--force]\n');
  } else {
    runInitCli(args, { rootDir: cwd });
  }
} else if (subcommand === 'report') {
  if (args.some(isHelpToken)) {
    writeStdout(REPORT_USAGE);
  } else {
    runVeritasReportCli(args, {
      rootDir: cwd,
    });
  }
} else if (subcommand === 'print') {
  const [kind, ...printArgs] = args;
  if (!kind || isHelpToken(kind) || printArgs.some(isHelpToken)) {
    writeStdout(
      selectScopedUsage(kind, PRINT_USAGE, {
        'package-scripts':
          'Usage:\n  veritas print package-scripts [--root <path>] [--proof-lane <cmd>]\n',
        'ci-snippet':
          'Usage:\n  veritas print ci-snippet [--root <path>] [--proof-lane <cmd>]\n',
        'git-hook':
          'Usage:\n  veritas print git-hook [--root <path>] [--hook post-commit]\n',
        'runtime-hook':
          'Usage:\n  veritas print runtime-hook [--root <path>]\n',
        'codex-hook':
          'Usage:\n  veritas print codex-hook [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]\n',
      }),
    );
  } else if (kind === 'package-scripts') {
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
    writeStderr(PRINT_USAGE);
    process.exitCode = 1;
  }
} else if (subcommand === 'apply') {
  const [kind, ...applyArgs] = args;
  if (!kind || isHelpToken(kind) || applyArgs.some(isHelpToken)) {
    writeStdout(
      selectScopedUsage(kind, APPLY_USAGE, {
        'package-scripts':
          'Usage:\n  veritas apply package-scripts [--root <path>] [--proof-lane <cmd>] [--force]\n',
        'ci-snippet':
          'Usage:\n  veritas apply ci-snippet [--root <path>] [--output <path>] [--proof-lane <cmd>] [--force]\n',
        'git-hook':
          'Usage:\n  veritas apply git-hook [--root <path>] [--hook post-commit] [--output <path>] [--configure-git] [--force]\n',
        'runtime-hook':
          'Usage:\n  veritas apply runtime-hook [--root <path>] [--output <path>] [--force]\n',
        'codex-hook':
          'Usage:\n  veritas apply codex-hook [--root <path>] [--output <path>] [--target-hooks-file <path> | --codex-home <path>] [--force]\n',
      }),
    );
  } else if (kind === 'package-scripts') {
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
    writeStderr(APPLY_USAGE);
    process.exitCode = 1;
  }
} else if (subcommand === 'eval') {
  const [kind, ...evalArgs] = args;
  if (!kind || isHelpToken(kind) || evalArgs.some(isHelpToken)) {
    writeStdout(
      selectScopedUsage(kind, EVAL_USAGE, {
        draft:
          'Usage:\n  veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]\n    [--reviewer-confidence <scale-entry|unknown>]\n    [--time-to-green-minutes <number>]\n    [--override-count <number>]\n    [--false-positive-rule <rule-id>]\n    [--missed-issue <text>]\n    [--note <text>]\n',
        record:
          'Usage:\n  veritas eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force]\n  veritas eval record --draft <path> [--team-profile <path>] [--output <path>] [--force]\n    --accepted-without-major-rewrite <true|false>\n    --required-followup <true|false>\n    --reviewer-confidence <scale-entry|unknown>\n    --time-to-green-minutes <number>\n    --override-count <number>\n    [--false-positive-rule <rule-id>]\n    [--missed-issue <text>]\n    [--note <text>]\n',
      }),
    );
  } else if (kind === 'record') {
    runEvalRecordCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'draft') {
    runEvalDraftCli(evalArgs, { rootDir: cwd });
  } else {
    writeStderr(EVAL_USAGE);
    process.exitCode = 1;
  }
} else if (subcommand === 'shadow') {
  const [kind, ...shadowArgs] = args;
  if (!kind || isHelpToken(kind) || shadowArgs.some(isHelpToken)) {
    writeStdout(
      selectScopedUsage(kind, SHADOW_USAGE, {
        run: SHADOW_USAGE,
      }),
    );
  } else if (kind === 'run') {
    runShadowRunCli(shadowArgs, { rootDir: cwd });
  } else {
    writeStderr(SHADOW_USAGE);
    process.exitCode = 1;
  }
} else if (subcommand === 'runtime') {
  const [kind, ...runtimeArgs] = args;
  if (!kind || isHelpToken(kind) || runtimeArgs.some(isHelpToken)) {
    writeStdout(
      selectScopedUsage(kind, RUNTIME_USAGE, {
        status: RUNTIME_USAGE,
      }),
    );
  } else if (kind === 'status') {
    runRuntimeStatusCli(runtimeArgs, { rootDir: cwd });
  } else {
    writeStderr(RUNTIME_USAGE);
    process.exitCode = 1;
  }
} else {
  writeStderr(MAIN_USAGE);
  process.exitCode = 1;
}
