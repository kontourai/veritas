#!/usr/bin/env node
import {
  runEvalDraftCli,
  runEvalObserveCli,
  runEvalMarkerCli,
  runEvalMarkerSuiteCli,
  runEvalRecommendCli,
  runEvalRecordCli,
  runEvalSummaryCli,
  runRecommendationCli,
  runReadinessCoverageCli,
  runInitCli,
  runReadinessCheckCli,
  runExplainCli,
  runBoundariesCheckCli,
  runAttestCli,
  runIntegrationsCli,
  runClaimCli,
} from '../src/index.mjs';

const MAIN_USAGE = `Usage:
  veritas init [--root <path>] [--project-name <name>] [--evidence-check <cmd>] [--template <name>] [--force]
  veritas readiness [--check evidence|boundaries|coverage] [--root <path>] [--working-tree] [--actor <id>]
  veritas explain <ruleId|workArea|filePath> [--file <path>] [--work-area <id>] [--root <path>]
  veritas attest bootstrap --actor <id> [--root <path>] [--non-interactive] [--valid-until-days <days>]
  veritas attest policy-change --actor <id> --message <text> [--root <path>] [--valid-until-days <days>]
  veritas attest recommendation <id> --accept|--reject --actor <id> [--message <text>] [--root <path>]
  veritas attest status [--root <path>]
  veritas claim init|list|add|edit|remove|scaffold|validate [--root <path>]
  veritas plugin list [--root <path>]
  veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  veritas eval observe [--transcript <path>] [--tool auto|codex|claude-code|none] [--evidence <path>] [--output <path>]
  veritas eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false> --reviewer-confidence <scale-entry|unknown> --time-to-green-minutes <number> --override-count <number>
  veritas eval record --draft <path> [--team-profile <path>] [--output <path>] [--force] --accepted-without-major-rewrite <true|false> --required-followup <true|false>
  veritas eval marker --scenario <path> --without-veritas-transcript <path> --with-veritas-transcript <path>
  veritas eval marker-suite --suite <path>
  veritas eval recommend [--root <path>] [--force] [--dry-run]
  veritas eval summary [--root <path>]
  veritas recommendation list|show <id>|decide <id> [--accept|--reject] [--actor <id>] [--message <text>]
  veritas integrations codex|claude-code|cursor|copilot install|status|uninstall [--root <path>] [--force]
`;

const RUN_USAGE = `Usage:
  veritas readiness [--check evidence|boundaries|coverage] [--root <path>] [--working-tree]
  veritas readiness --check boundaries --actor <id> [--diff <ref>] [--root <path>] [--adapter <path>]
`;

const EVAL_USAGE = `Usage:
  veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  veritas eval observe --transcript <path> [--evidence <path>] [--output <path>]
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
  veritas eval marker --scenario <path>
    --without-veritas-transcript <path>
    --with-veritas-transcript <path>
  veritas eval marker-suite --suite <path>
  veritas eval recommend [--root <path>] [--force] [--dry-run]
  veritas eval summary [--root <path>]
`;

const PROPOSAL_USAGE = `Usage:
  veritas recommendation list [--root <path>] [--status proposed|accepted|rejected|all]
  veritas recommendation show <id> [--root <path>]
  veritas recommendation decide <id> --accept|--reject --actor <id> [--message <text>] [--root <path>]
`;

const ATTEST_USAGE = `Usage:
  veritas attest bootstrap --actor <id> [--root <path>] [--non-interactive] [--valid-until-days <days>]
  veritas attest policy-change --actor <id> --message <text> [--root <path>] [--valid-until-days <days>]
  veritas attest recommendation <id> --accept|--reject --actor <id> [--message <text>] [--root <path>]
  veritas attest status [--root <path>]
`;

const CLAIM_USAGE = `Usage:
  veritas claim init [--repo-name <name>] [--dry-run] [--force]
  veritas claim list
  veritas claim add --type <type> --surface <surface> --subject-type <type> --subject-id <id> --field <field> [--id <id>] [--impact low|medium|high|critical] [--policy-id <id>] [--metadata '{"key":"value"}']
  veritas claim edit --claim-id <id> [--type <type>] [--surface <surface>] [--subject-type <type>] [--subject-id <id>] [--field <field>] [--impact low|medium|high|critical] [--policy-id <id>] [--metadata '{"key":"value"}']
  veritas claim remove --claim-id <id>
  veritas claim scaffold --plugin <name>
  veritas claim validate
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

if (!subcommand || isHelpToken(subcommand)) {
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
} else if (subcommand === 'eval') {
  const [kind, ...evalArgs] = args;
  if (!kind || isHelpToken(kind) || evalArgs.some(isHelpToken)) {
    writeStdout(
      selectScopedUsage(kind, EVAL_USAGE, {
        draft:
          'Usage:\n  veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]\n    [--reviewer-confidence <scale-entry|unknown>]\n    [--time-to-green-minutes <number>]\n    [--override-count <number>]\n    [--false-positive-rule <rule-id>]\n    [--missed-issue <text>]\n    [--note <text>]\n',
        observe:
          'Usage:\n  veritas eval observe [--transcript <path>] [--tool auto|codex|claude-code|none] [--evidence <path>] [--output <path>] [--rewrite-threshold <ratio>] [--verbose]\n',
        record:
          'Usage:\n  veritas eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force]\n  veritas eval record --draft <path> [--team-profile <path>] [--output <path>] [--force]\n    --accepted-without-major-rewrite <true|false>\n    --required-followup <true|false>\n    --reviewer-confidence <scale-entry|unknown>\n    --time-to-green-minutes <number>\n    --override-count <number>\n    [--false-positive-rule <rule-id>]\n    [--missed-issue <text>]\n    [--note <text>]\n',
        marker:
          'Usage:\n  veritas eval marker --scenario <path>\n    --without-veritas-transcript <path>\n    --with-veritas-transcript <path>\n',
        'marker-suite':
          'Usage:\n  veritas eval marker-suite --suite <path>\n',
        recommend:
          'Usage:\n  veritas eval recommend [--root <path>] [--force] [--dry-run]\n',
        summary:
          'Usage:\n  veritas eval summary [--root <path>]\n',
      }),
    );
  } else if (kind === 'record') {
    runEvalRecordCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'draft') {
    runEvalDraftCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'observe') {
    runEvalObserveCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'marker') {
    runEvalMarkerCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'marker-suite') {
    runEvalMarkerSuiteCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'recommend') {
    runEvalRecommendCli(evalArgs, { rootDir: cwd });
  } else if (kind === 'summary') {
    runEvalSummaryCli(evalArgs, { rootDir: cwd });
  } else {
    writeStderr(EVAL_USAGE);
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
    writeStdout('Usage:\n  veritas explain <ruleId|workArea|filePath> [--file <path>] [--work-area <id>] [--root <path>] [--adapter <path>] [--repo-standards <path>]\n');
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
} else {
  writeStderr(MAIN_USAGE);
  process.exitCode = 1;
}
