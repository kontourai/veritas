import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { loadJson } from '../load.mjs';
import {
  parseArgs,
  parseCoverageArgs,
  parseInitArgs,
  parseAttestArgs,
  parsePrintArgs,
  parseApplyArgs,
  parseSetupArgs,
  parsePreToolUseArgs,
  parseStandardsFeedbackArgs,
  parseMarkerStandardsFeedbackArgs,
  parseMarkerSuiteStandardsFeedbackArgs,
  parseReadinessArgs,
  parseTokens,
} from '../args.mjs';
import { assertWithinDir } from '../paths.mjs';
import {
  inferBootstrapRepoInsights,
  writeBootstrapStarterKit,
  buildSuggestedPackageScripts,
  buildSuggestedCiSnippet,
} from '../bootstrap.mjs';
import {
  buildInitRecommendation,
  applyInitRecommendation,
} from '../bootstrap/recommendation.mjs';
import { shellQuote, runEvidenceCheckCommand } from '../shell.mjs';
import {
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
  buildSuggestedClaudeCodePreToolUseHook,
  applyPackageScripts,
  applyCiSnippet,
  applyGitHook,
  setupRepoHooks,
  applyRuntimeHook,
  applyStopHook,
  applyClaudeCodePreToolUseHook,
  evaluatePreToolUse,
} from '../hooks.mjs';
import { applyGovernanceBlocks, buildGovernanceBlock } from '../governance.mjs';
import { buildReadinessCoverage } from '../evidence/index.mjs';
import {
  generateVeritasReport,
  buildFeedbackSummary,
  feedbackHasFailures,
  resolveVeritasPaths,
  resolveReportInputs,
  resolveEvidenceCheckCommands,
} from '../report.mjs';
import {
  generateStandardsFeedbackDraft,
  generateStandardsFeedbackRecord,
  generateStandardsFeedbackSummary,
} from '../standards-feedback/records.mjs';
import {
  generateMarkerBenchmarkComparison,
  generateMarkerBenchmarkSuiteReport,
} from '../standards-feedback/marker-benchmark.mjs';
import { observeSessionLogStandardsFeedback } from '../integrations/session-logs.mjs';
import {
  applyCodexHook,
  buildSuggestedCodexHookConfig,
  inspectCodexHookTarget,
  inspectRuntimeIntegrationStatus,
  runtimeIntegrationFor,
} from '../integrations/runtime-integrations.mjs';
import { observeFilesystemStandardsFeedback } from '../standards-feedback/filesystem-observer.mjs';
import { runReadinessCheckCli } from './readiness-check.mjs';
import { runClaimCli } from './claims.mjs';
import {
  createAttestation,
  inspectAttestationStatus,
  writePendingAttestationMarker,
} from '../attestations.mjs';
import {
  applyRecommendation,
  generateAndWriteRecommendations,
  listRecommendations,
  loadRecommendation,
} from '../recommendations.mjs';

function hasReadinessOutcomeInputs(options) {
  return (
    typeof options.acceptedWithoutMajorRewrite === 'boolean' &&
    typeof options.requiredFollowup === 'boolean' &&
    typeof options.timeToGreenMinutes === 'number' &&
    !Number.isNaN(options.timeToGreenMinutes)
  );
}

function normalizeOutputFormat(format, defaultFormat) {
  const resolvedFormat = format ?? defaultFormat;
  if (!['json', 'feedback'].includes(resolvedFormat)) {
    throw new Error('--format must be json or feedback');
  }
  return resolvedFormat;
}

function handleSurfaceValidationCliError(error) {
  if (error?.exitCode !== 2) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
  return null;
}

export async function runVeritasReportCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseArgs(argv);
  if (options.trend) {
    const summary = generateStandardsFeedbackSummary(options, defaults);
    const worst = (summary.ruleTrend ?? []).slice(0, 3);
    process.stdout.write(summary.markdownSummary);
    if (worst.length > 0) {
      process.stdout.write(
        `Worst 3 rules:\n${worst
          .map((rule) => `- ${rule.rule_id}: ${Math.round((rule.pass_rate ?? 0) * 100)}% ${rule.sparkline}, MTTR ${rule.mttr_runs ?? 'n/a'} run(s)`)
          .join('\n')}\n`,
      );
    }
    return;
  }
  const format = normalizeOutputFormat(options.format, 'json');
  let result;
  try {
    result = await generateVeritasReport(options, defaults, explicitFiles);
  } catch (error) {
    result = handleSurfaceValidationCliError(error);
  }
  if (!result) return;

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: result.record,
        reportArtifactPath: result.artifactPath,
      }),
    );
    if (feedbackHasFailures(result.record)) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

function formatReadinessCoverageHuman(record) {
  const coverage = record.readiness_coverage ?? buildReadinessCoverage({
    evidenceChecks: [],
    evidenceInventoryResults: [],
  });
  const lines = [
    'Veritas Readiness Coverage',
    '',
    `Evidence Checks: ${coverage.selected_evidence_check_count}/${coverage.evidence_check_count} selected`,
    `Evidence inventories: ${coverage.evidence_inventory_count} total`,
    `Required: ${coverage.required_inventory_count}`,
    `Candidate: ${coverage.candidate_inventory_count}`,
    `Advisory: ${coverage.advisory_inventory_count}`,
    `Move to test: ${coverage.move_to_test_inventory_count}`,
    `Retiring: ${coverage.retire_inventory_count}`,
    `Upstream candidates: ${coverage.upstream_candidate_count}`,
    '',
    coverage.recommendation,
  ];

  if (coverage.unknown_catch_evidence_inventory_ids?.length > 0) {
    lines.push(`Unknown catch evidence: ${coverage.unknown_catch_evidence_inventory_ids.join(', ')}`);
  }
  if (coverage.missing_review_trigger_inventory_ids?.length > 0) {
    lines.push(`Missing review triggers: ${coverage.missing_review_trigger_inventory_ids.join(', ')}`);
  }
  if (coverage.stale_inventory_ids?.length > 0) {
    lines.push(`Stale or retiring inventories: ${coverage.stale_inventory_ids.join(', ')}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function runReadinessCoverageCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseCoverageArgs(argv);
  const format = options.format ?? 'human';
  if (!['human', 'feedback', 'json'].includes(format)) {
    throw new Error('--format must be human, feedback, or json');
  }
  const result = await generateVeritasReport(
    {
      ...options,
      runId: options.runId ?? `coverage-${Date.now()}`,
    },
    defaults,
    explicitFiles,
  );

  if (format === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          artifactPath: result.artifactPath,
          readiness_coverage: result.record.readiness_coverage,
          evidence_inventory_results: result.record.evidence_inventory_results,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: result.record,
        reportArtifactPath: result.artifactPath,
      }),
    );
    return;
  }

  process.stdout.write(formatReadinessCoverageHuman(result.record));
}

export function runInitCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseInitArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const projectName = options.projectName ?? defaults.projectName ?? basename(rootDir);
  if (options.explore && options.apply) {
    throw new Error('veritas init cannot combine --explore and --apply');
  }
  if (options.apply && !options.planPath) {
    throw new Error('veritas init --apply requires --plan <path>');
  }
  if (options.answersPath && !options.guided) {
    throw new Error('veritas init --answers requires --guided');
  }
  if (options.template && (options.explore || options.guided || options.apply)) {
    throw new Error('veritas init --template is only supported on the direct init path');
  }

  if (options.explore || options.guided) {
    const answers = options.answersPath ? loadJson(resolve(rootDir, options.answersPath), 'init answers') : undefined;
    const recommendation = buildInitRecommendation({
      rootDir,
      projectName,
      evidenceCheck: options.evidenceCheck ?? defaults.evidenceCheck,
      answers,
      mode: options.guided ? 'guided' : 'explore',
    });
    if (options.outputPath) {
      const outputPath = resolve(rootDir, options.outputPath);
      const allowedDir = resolve(rootDir, '.veritas/init-plans');
      assertWithinDir(outputPath, allowedDir, 'init --output must stay inside .veritas/init-plans/');
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(recommendation, null, 2)}\n`, 'utf8');
      recommendation.output_path = relative(rootDir, outputPath).replaceAll('\\', '/');
    }
    process.stdout.write(`${JSON.stringify(recommendation, null, 2)}\n`);
    return;
  }

  if (options.apply) {
    const planPath = resolve(rootDir, options.planPath);
    const recommendation = loadJson(planPath, 'init recommendation');
    const result = applyInitRecommendation({
      rootDir,
      recommendation,
      force: options.force ?? false,
    });
    process.stderr.write(
      `Next Steps\n\nSuggested CODEOWNERS block for protected standards (not written automatically):\n\n${result.codeownersBlock}\n\n`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const result = writeBootstrapStarterKit({
    rootDir,
    projectName,
    evidenceCheck: options.evidenceCheck ?? defaults.evidenceCheck,
    template: options.template,
    force: options.force ?? false,
  });
  if (options.nonInteractive) {
    result.attestation = writePendingAttestationMarker(rootDir, {
      reason: 'veritas init ran in non-interactive mode.',
    });
  } else {
    result.attestation = {
      status: 'not-recorded',
      suggestedCommand: `veritas attest bootstrap --actor <authority-id> --approval-ref <approval-reference> --non-interactive --root ${rootDir}`,
    };
  }

  process.stderr.write(
    `Next Steps\n\nSuggested CODEOWNERS block for protected standards (not written automatically):\n\n${result.codeownersBlock}\n\n`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runAttestCli(kind, argv = process.argv.slice(2), defaults = {}) {
  const options = parseAttestArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (kind === 'status') {
    process.stdout.write(`${JSON.stringify(inspectAttestationStatus(rootDir), null, 2)}\n`);
    return;
  }
  if (!['bootstrap', 'policy-change'].includes(kind)) {
    throw new Error(`Unsupported attest command: ${kind}`);
  }
  const result = createAttestation({
    rootDir,
    kind,
    actor: options.actor,
    displayName: options.displayName,
    notes: options.message ?? '',
    approvalRef: options.approvalRef,
    validUntilDays: options.validUntilDays,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runPrintPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const evidenceCheck = options.evidenceCheck ?? repoInsights.evidenceCheck;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        evidenceCheck,
        repoInsights,
        scripts: buildSuggestedPackageScripts({
          evidenceCheck,
          baseRef: repoInsights.baseRef,
        }),
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const evidenceCheck = options.evidenceCheck ?? repoInsights.evidenceCheck;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        evidenceCheck,
        repoInsights,
        ciSnippet: buildSuggestedCiSnippet({
          evidenceCheck,
          baseRef: repoInsights.baseRef,
        }),
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const hook = options.hook ?? 'post-commit';

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        hook,
        hookBody: buildSuggestedGitHook({ hook }),
        suggestedHooksPath: '.githooks',
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        outputPath: '.veritas/hooks/agent-runtime.sh',
        hookBody: buildSuggestedRuntimeHook(),
        defaultInvocation: '.veritas/hooks/agent-runtime.sh',
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintStopHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const tool = options.tool ?? 'generic';
  const suggestion = buildSuggestedStopHook({ tool });

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        ...suggestion,
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintClaudeCodePreToolUseHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        ...buildSuggestedClaudeCodePreToolUseHook(),
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintGovernanceBlockCli() {
  process.stdout.write(`${buildGovernanceBlock()}\n`);
}

export function runPrintCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const targetStatus = inspectCodexHookTarget(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });
  const suggestedApplyCommand = options.codexHome
    ? `npm exec -- veritas apply codex-hook --codex-home ${shellQuote(options.codexHome)}`
    : options.targetHooksFile
      ? `npm exec -- veritas apply codex-hook --target-hooks-file ${shellQuote(options.targetHooksFile)}`
      : null;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        outputPath: '.veritas/runtime/codex-hooks.json',
        targetHooksFile: options.targetHooksFile ?? null,
        codexHome: options.codexHome ?? null,
        targetStatus,
        suggestedApplyCommand,
        hookConfig: buildSuggestedCodexHookConfig(),
      },
      null,
      2,
    )}\n`,
  );
}

export function runRuntimeStatusCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const status = inspectRuntimeIntegrationStatus(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        ...status,
      },
      null,
      2,
    )}\n`,
  );
}

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

export function runClaudeCodePreToolUseCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePreToolUseArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const stdinText = readFileSync(0, 'utf8');
  const result = evaluatePreToolUse({
    rootDir,
    filePath: options.filePath,
    actor: options.actor,
    stdinText,
  });
  process.stdout.write(`${JSON.stringify({ decision: result.decision, reason: result.reason }, null, 2)}\n`);
  if (result.decision === 'block') {
    process.exitCode = 2;
  }
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

export function runStandardsFeedbackRecordCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const result = generateStandardsFeedbackRecord(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        historyPath: result.historyPath,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runStandardsFeedbackSummaryCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const result = generateStandardsFeedbackSummary(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(result.markdownSummary);
}

export function runStandardsFeedbackRecommendCli(argv = process.argv.slice(2), defaults = {}) {
  const { options } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--repo-standards': { type: 'string', key: 'repoStandardsPath' },
    '--repo-map': { type: 'string', key: 'repoMapPath' },
    '--force': { type: 'flag', key: 'force' },
    '--dry-run': { type: 'flag', key: 'dryRun' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = generateAndWriteRecommendations({
    ...options,
    rootDir,
    write: !options.dryRun,
  });
  process.stdout.write(`${JSON.stringify({
    recommendations: result.recommendations,
    written: result.written,
  }, null, 2)}\n`);
}

export function runRecommendationCli(kind, argv = process.argv.slice(2), defaults = {}) {
  const { options, rest } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--status': { type: 'string', key: 'status' },
    '--actor': { type: 'string', key: 'actor' },
    '--accept': { type: 'flag', key: 'accept' },
    '--reject': { type: 'flag', key: 'reject' },
    '--message': { type: 'string', key: 'message' },
    '--approval-ref': { type: 'string', key: 'approvalRef' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (kind === 'list') {
    process.stdout.write(`${JSON.stringify({
      recommendations: listRecommendations({ rootDir, status: options.status ?? 'proposed' }),
    }, null, 2)}\n`);
    return;
  }
  const id = rest[0];
  if (!id) throw new Error(`veritas recommendation ${kind} requires <id>`);
  if (kind === 'show') {
    process.stdout.write(`${JSON.stringify(loadRecommendation(rootDir, id), null, 2)}\n`);
    return;
  }
  if (kind === 'decide') {
    process.stdout.write(`${JSON.stringify(applyRecommendation({
      rootDir,
      id,
      actor: options.actor,
      accept: options.accept ?? false,
      reject: options.reject ?? false,
      message: options.message ?? '',
      approvalRef: options.approvalRef,
    }), null, 2)}\n`);
    return;
  }
  throw new Error(`Unsupported recommendation command: ${kind}`);
}

export function runStandardsFeedbackMarkerCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerStandardsFeedbackArgs(argv);
  const result = generateMarkerBenchmarkComparison(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runStandardsFeedbackMarkerSuiteCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerSuiteStandardsFeedbackArgs(argv);
  const result = generateMarkerBenchmarkSuiteReport(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runStandardsFeedbackDraftCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const result = generateStandardsFeedbackDraft(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        suggestedRecordCommand: result.suggestedRecordCommand,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runStandardsFeedbackObserveCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result =
    options.tool === 'none' || !options.sessionLogPath
      ? observeFilesystemStandardsFeedback({
          evidencePath: options.evidencePath,
          rootDir,
          outputPath: options.outputPath,
          churnThreshold: options.rewriteThreshold ?? 0.3,
        })
      : observeSessionLogStandardsFeedback({
          sessionLogPath: options.sessionLogPath,
          evidencePath: options.evidencePath,
          rootDir,
          outputPath: options.outputPath,
          tool: options.tool ?? 'auto',
          churnThreshold: options.rewriteThreshold ?? 0.3,
          verbose: options.verbose ?? false,
        });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        ...(result.reader ? { reader: result.reader } : {}),
        ...(result.heuristics ? { heuristics: result.heuristics } : {}),
        ...result.draft,
      },
      null,
      2,
    )}\n`,
  );
}

export function runIntegrationsCli(tool, action, argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const integration = runtimeIntegrationFor(tool, rootDir, options);
  let result;
  if (action === 'status') {
    result = integration.status();
  } else if (action === 'install') {
    result = {
      preToolUse: integration.installPreToolUseHook(options),
      stop: integration.installStopHook(options),
      postSession: integration.installPostSessionHook(options),
    };
  } else if (action === 'uninstall') {
    result = integration.uninstall(options);
  } else {
    throw new Error(`Unsupported integrations action: ${action}`);
  }
  process.stdout.write(`${JSON.stringify({ tool, action, rootDir, ...result }, null, 2)}\n`);
}


export { runReadinessCheckCli };
export { runClaimCli };
