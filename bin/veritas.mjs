#!/usr/bin/env node
import {
  runStandardsFeedbackDraftCli,
  runStandardsFeedbackObserveCli,
  runStandardsFeedbackMarkerCli,
  runStandardsFeedbackMarkerSuiteCli,
  runStandardsFeedbackRecommendCli,
  runStandardsFeedbackRecordCli,
  runStandardsFeedbackSummaryCli,
  runRecommendationCli,
  runReadinessCoverageCli,
  runInitCli,
  runReadinessCheckCli,
  runExplainCli,
  runBoundariesCheckCli,
  runAttestCli,
  runIntegrationsCli,
  runSetupRepoHooksCli,
  runClaudeCodePreToolUseCli,
  runPrintClaudeCodePreToolUseHookCli,
  runApplyClaudeCodePreToolUseHookCli,
  runClaimCli,
} from '../src/index.mjs';
import { readFileSync } from 'node:fs';

const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

const MAIN_USAGE = `Usage:
  veritas init [--root <path>] [--project-name <name>] [--evidence-check <cmd>] [--template <name>] [--force]
  veritas readiness [--check evidence|boundaries|coverage] [--root <path>] [--working-tree] [--actor <id>] [--format feedback|json|trust-bundle]
  veritas explain <ruleId|workArea|filePath> [--file <path>] [--work-area <id>] [--root <path>]
  veritas attest bootstrap --actor <id> --approval-ref <ref> [--root <path>] [--non-interactive] [--valid-until-days <days>]
  veritas attest policy-change --actor <id> --approval-ref <ref> --message <text> [--root <path>] [--valid-until-days <days>]
  veritas attest recommendation <id> --accept|--reject --actor <id> [--approval-ref <ref>] [--message <text>] [--root <path>]
  veritas attest status [--root <path>]
  veritas claim init|list|add|edit|remove|scaffold|validate [--root <path>]
  veritas setup repo-hooks [--root <path>] [--force]
  veritas plugin list [--root <path>]
  veritas feedback draft --evidence <path> [--authority-settings <path>] [--output <path>] [--force]
  veritas feedback observe [--session-log <path>] [--tool auto|codex|claude-code|none] [--evidence <path>] [--output <path>]
  veritas feedback record --evidence <path> [--authority-settings <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false> --reviewer-confidence <scale-entry|unknown> --time-to-green-minutes <number> --exception-count <number>
  veritas feedback record --draft <path> [--authority-settings <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false>
  veritas feedback marker --scenario <path> --without-veritas-session-log <path> --with-veritas-session-log <path>
  veritas feedback marker-suite --suite <path>
  veritas feedback recommend [--root <path>] [--force] [--dry-run]
  veritas feedback summary [--root <path>]
  veritas recommendation list|show <id>|decide <id> [--accept|--reject] [--actor <id>] [--approval-ref <ref>] [--message <text>]
  veritas integrations codex|claude-code|cursor|copilot install|status|uninstall [--root <path>] [--force]
`;

const RUN_USAGE = `Usage:
  veritas readiness [--check evidence|boundaries|coverage] [--root <path>] [--working-tree] [--format feedback|json|trust-bundle]
  veritas readiness --check boundaries --actor <id> [--diff <ref>] [--root <path>] [--repo-map <path>]
`;

const FEEDBACK_USAGE = `Usage:
  veritas feedback draft --evidence <path> [--authority-settings <path>] [--output <path>] [--force]
  veritas feedback observe --session-log <path> [--evidence <path>] [--output <path>]
    [--reviewer-confidence <scale-entry|unknown>]
    [--time-to-green-minutes <number>]
    [--exception-count <number>]
    [--false-positive-rule <rule-id>]
    [--missed-issue <text>]
    [--note <text>]
  veritas feedback record --evidence <path> [--authority-settings <path>] [--output <path>] [--force]
  veritas feedback record --draft <path> [--authority-settings <path>] [--output <path>] [--force]
    --accepted-without-major-rewrite <true|false>
    --required-followup <true|false>
    --reviewer-confidence <scale-entry|unknown>
    --time-to-green-minutes <number>
    --exception-count <number>
    [--false-positive-rule <rule-id>]
    [--missed-issue <text>]
    [--note <text>]
  veritas feedback marker --scenario <path>
    --without-veritas-session-log <path>
    --with-veritas-session-log <path>
  veritas feedback marker-suite --suite <path>
  veritas feedback recommend [--root <path>] [--force] [--dry-run]
  veritas feedback summary [--root <path>]
`;

const PROPOSAL_USAGE = `Usage:
  veritas recommendation list [--root <path>] [--status proposed|accepted|rejected|all]
  veritas recommendation show <id> [--root <path>]
  veritas recommendation decide <id> --accept|--reject --actor <id> [--approval-ref <ref>] [--message <text>] [--root <path>]
`;

const ATTEST_USAGE = `Usage:
  veritas attest bootstrap --actor <id> --approval-ref <ref> [--root <path>] [--non-interactive] [--valid-until-days <days>]
  veritas attest policy-change --actor <id> --approval-ref <ref> --message <text> [--root <path>] [--valid-until-days <days>]
  veritas attest recommendation <id> --accept|--reject --actor <id> [--approval-ref <ref>] [--message <text>] [--root <path>]
  veritas attest status [--root <path>]
`;

const CLAIM_USAGE = `Usage:
  veritas claim init [--repo-name <name>] [--dry-run] [--force]
  veritas claim list
  veritas claim add --type <type> --facet <facet> --subject-type <type> --subject-id <id> --field <field> [--id <id>] [--impact low|medium|high|critical] [--policy-id <id>] [--metadata '{"key":"value"}']
  veritas claim edit --claim-id <id> [--type <type>] [--facet <facet>] [--subject-type <type>] [--subject-id <id>] [--field <field>] [--impact low|medium|high|critical] [--policy-id <id>] [--metadata '{"key":"value"}']
  veritas claim remove --claim-id <id>
  veritas claim scaffold --plugin <name>
  veritas claim validate
`;

const SETUP_USAGE = `Usage:
  veritas setup repo-hooks [--root <path>] [--force]
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

process.on('uncaughtException', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});

if (subcommand === '--version' || subcommand === '-v') {
  writeStdout(`${PACKAGE_VERSION}\n`);
} else if (!subcommand || isHelpToken(subcommand)) {
  writeStdout(MAIN_USAGE);
} else if (subcommand === 'init') {
  if (args.some(isHelpToken)) {
    writeStdout('Usage:\n  veritas init [--root <path>] [--project-name <name>] [--evidence-check <cmd>] [--template <name>] [--force] [--non-interactive]\n');
  } else {
    runInitCli(args, { rootDir: cwd });
  }
} else if (subcommand === 'attest') {
  const [kind, ...attestArgs] = args;
  if (!kind || isHelpToken(kind) || attestArgs.some(isHelpToken)) {
    writeStdout(ATTEST_USAGE);
  } else if (kind === 'recommendation') {
    runRecommendationCli('decide', attestArgs, { rootDir: cwd });
  } else if (['bootstrap', 'policy-change', 'status'].includes(kind)) {
    runAttestCli(kind, attestArgs, { rootDir: cwd });
  } else {
    writeStderr(ATTEST_USAGE);
    process.exitCode = 1;
  }
} else if (subcommand === 'claim') {
  if (args.some(isHelpToken)) {
    writeStdout(CLAIM_USAGE);
  } else {
    await runClaimCli(args, { rootDir: cwd });
  }
} else if (subcommand === 'setup') {
  const [kind, ...setupArgs] = args;
  if (!kind || isHelpToken(kind) || setupArgs.some(isHelpToken)) {
    writeStdout(SETUP_USAGE);
  } else if (kind === 'repo-hooks') {
    runSetupRepoHooksCli(setupArgs, { rootDir: cwd });
  } else {
    writeStderr(SETUP_USAGE);
    process.exitCode = 1;
  }
} else if (subcommand === 'plugin') {
  if (args.some(isHelpToken)) {
    writeStdout('Usage:\n  veritas plugin list [--root <path>]\n');
  } else {
    const { runPluginCli } = await import('../src/cli/plugins.mjs');
    await runPluginCli(args, { rootDir: cwd });
  }
} else if (subcommand === 'readiness') {
  if (args.some(isHelpToken)) {
    writeStdout(RUN_USAGE);
  } else {
    const checkIndex = args.indexOf('--check');
    const check = checkIndex >= 0 ? args[checkIndex + 1] : 'evidence';
    const forwarded = checkIndex >= 0
      ? args.filter((_, index) => index !== checkIndex && index !== checkIndex + 1)
      : args;
    if (check === 'boundaries') {
      runBoundariesCheckCli(forwarded, { rootDir: cwd });
    } else if (check === 'coverage') {
      await runReadinessCoverageCli(forwarded, { rootDir: cwd });
    } else if (check === 'evidence') {
      await runReadinessCheckCli(forwarded, { rootDir: cwd });
    } else {
      writeStderr(RUN_USAGE);
      process.exitCode = 1;
    }
  }
} else if (subcommand === 'feedback') {
  const [kind, ...feedbackArgs] = args;
  if (!kind || isHelpToken(kind) || feedbackArgs.some(isHelpToken)) {
    writeStdout(
      selectScopedUsage(kind, FEEDBACK_USAGE, {
        draft:
          'Usage:\n  veritas feedback draft --evidence <path> [--authority-settings <path>] [--output <path>] [--force]\n    [--reviewer-confidence <scale-entry|unknown>]\n    [--time-to-green-minutes <number>]\n    [--exception-count <number>]\n    [--false-positive-rule <rule-id>]\n    [--missed-issue <text>]\n    [--note <text>]\n',
        observe:
          'Usage:\n  veritas feedback observe [--session-log <path>] [--tool auto|codex|claude-code|none] [--evidence <path>] [--output <path>] [--rewrite-threshold <ratio>] [--verbose]\n',
        record:
          'Usage:\n  veritas feedback record --evidence <path> [--authority-settings <path>] [--output <path>] [--force]\n  veritas feedback record --draft <path> [--authority-settings <path>] [--output <path>] [--force]\n    --accepted-without-major-rewrite <true|false>\n    --required-followup <true|false>\n    --reviewer-confidence <scale-entry|unknown>\n    --time-to-green-minutes <number>\n    --exception-count <number>\n    [--false-positive-rule <rule-id>]\n    [--missed-issue <text>]\n    [--note <text>]\n',
        marker:
          'Usage:\n  veritas feedback marker --scenario <path>\n    --without-veritas-session-log <path>\n    --with-veritas-session-log <path>\n',
        'marker-suite':
          'Usage:\n  veritas feedback marker-suite --suite <path>\n',
        recommend:
          'Usage:\n  veritas feedback recommend [--root <path>] [--force] [--dry-run]\n',
        summary:
          'Usage:\n  veritas feedback summary [--root <path>]\n',
      }),
    );
  } else if (kind === 'record') {
    runStandardsFeedbackRecordCli(feedbackArgs, { rootDir: cwd });
  } else if (kind === 'draft') {
    runStandardsFeedbackDraftCli(feedbackArgs, { rootDir: cwd });
  } else if (kind === 'observe') {
    runStandardsFeedbackObserveCli(feedbackArgs, { rootDir: cwd });
  } else if (kind === 'marker') {
    runStandardsFeedbackMarkerCli(feedbackArgs, { rootDir: cwd });
  } else if (kind === 'marker-suite') {
    runStandardsFeedbackMarkerSuiteCli(feedbackArgs, { rootDir: cwd });
  } else if (kind === 'recommend') {
    runStandardsFeedbackRecommendCli(feedbackArgs, { rootDir: cwd });
  } else if (kind === 'summary') {
    runStandardsFeedbackSummaryCli(feedbackArgs, { rootDir: cwd });
  } else {
    writeStderr(FEEDBACK_USAGE);
    process.exitCode = 1;
  }
} else if (subcommand === 'recommendation') {
  const [kind, ...recommendationArgs] = args;
  if (!kind || isHelpToken(kind) || recommendationArgs.some(isHelpToken) || !['list', 'show', 'decide'].includes(kind)) {
    writeStdout(PROPOSAL_USAGE);
  } else {
    runRecommendationCli(kind, recommendationArgs, { rootDir: cwd });
  }
} else if (subcommand === 'explain') {
  if (args.some(isHelpToken)) {
    writeStdout('Usage:\n  veritas explain <ruleId|workArea|filePath> [--file <path>] [--work-area <id>] [--root <path>] [--repo-map <path>] [--repo-standards <path>]\n');
  } else {
    runExplainCli(args, { rootDir: cwd });
  }
} else if (subcommand === 'integrations') {
  const [tool, action, ...integrationArgs] = args;
  if (!tool || !action || integrationArgs.some(isHelpToken) || !['codex', 'claude-code', 'cursor', 'copilot'].includes(tool) || !['install', 'status', 'uninstall'].includes(action)) {
    writeStdout('Usage:\n  veritas integrations codex|claude-code|cursor|copilot install|status|uninstall [--root <path>] [--force]\n');
  } else {
    runIntegrationsCli(tool, action, integrationArgs, { rootDir: cwd });
  }
} else if (subcommand === 'hooks') {
  // The Claude Code PreToolUse hook surface (docs/reference/cli.md "hooks claude-code"):
  // `pre-tool-use` is the runtime evaluator the installed hook shells into
  // (`veritas hooks claude-code pre-tool-use "$@"`, src/hooks/suggestions.mjs — veritas#119);
  // `print`/`apply` render and install that hook.
  const [runtime, action, ...hookArgs] = args;
  const HOOK_USAGE = 'Usage:\n  veritas hooks claude-code print [--root <path>]\n  veritas hooks claude-code apply [--root <path>] [--output <path>] [--force]\n  veritas hooks claude-code pre-tool-use [--file <path>] [--actor <id>] [--root <path>]\n';
  if (runtime !== 'claude-code') {
    writeStderr(HOOK_USAGE);
    process.exitCode = 1;
  } else if (action === 'pre-tool-use') {
    runClaudeCodePreToolUseCli(hookArgs, { rootDir: cwd });
  } else if (action === 'print') {
    runPrintClaudeCodePreToolUseHookCli(hookArgs, { rootDir: cwd });
  } else if (action === 'apply') {
    runApplyClaudeCodePreToolUseHookCli(hookArgs, { rootDir: cwd });
  } else {
    writeStderr(HOOK_USAGE);
    process.exitCode = 1;
  }
} else {
  writeStderr(MAIN_USAGE);
  process.exitCode = 1;
}
