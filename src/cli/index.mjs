import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { loadJson } from '../load.mjs';
import {
  parseArgs,
  parseBudgetArgs,
  parseInitArgs,
  parseAttestArgs,
  parsePrintArgs,
  parseApplyArgs,
  parsePreToolUseArgs,
  parseEvalArgs,
  parseMarkerEvalArgs,
  parseMarkerSuiteEvalArgs,
  parseShadowArgs,
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
import { shellQuote, runProofCommand } from '../shell.mjs';
import {
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
  buildSuggestedCodexHookConfig,
  buildSuggestedClaudeCodePreToolUseHook,
  inspectCodexHookTarget,
  applyPackageScripts,
  applyCiSnippet,
  applyGitHook,
  applyRuntimeHook,
  applyStopHook,
  inspectRuntimeAdapterStatus,
  applyCodexHook,
  applyClaudeCodePreToolUseHook,
  evaluatePreToolUse,
} from '../hooks.mjs';
import { applyGovernanceBlocks, buildGovernanceBlock } from '../governance.mjs';
import { buildVerificationBudget } from '../proof/index.mjs';
import {
  generateVeritasReport,
  buildFeedbackSummary,
  feedbackHasFailures,
  resolveVeritasPaths,
  resolveReportInputs,
  resolveProofCommands,
} from '../report.mjs';
import {
  generateEvalDraft,
  generateEvalRecord,
  generateEvalSummary,
} from '../eval/records.mjs';
import {
  generateMarkerBenchmarkComparison,
  generateMarkerBenchmarkSuiteReport,
} from '../eval/marker-benchmark.mjs';
import { observeTranscriptEval } from '../integrations/transcripts.mjs';
import { runtimeAdapterFor } from '../integrations/runtime-adapters.mjs';
import { observeFilesystemEval } from '../eval/filesystem-observer.mjs';
import { runShadowRunCli } from './shadow-run.mjs';
import { runClaimCli } from './claims.mjs';
import {
  createAttestation,
  inspectAttestationStatus,
  writePendingAttestationMarker,
} from '../attestations.mjs';
import {
  applyProposal,
  generateAndWriteProposals,
  listProposals,
  loadProposal,
} from '../proposals.mjs';

function hasShadowOutcomeInputs(options) {
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
    const summary = generateEvalSummary(options, defaults);
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

function formatVerificationBudgetHuman(record) {
  const budget = record.verification_budget ?? buildVerificationBudget({
    proofLanes: [],
    proofFamilyResults: [],
  });
  const lines = [
    'Veritas Verification Budget',
    '',
    `Proof lanes: ${budget.selected_proof_lane_count}/${budget.proof_lane_count} selected`,
    `Proof families: ${budget.proof_family_count} total`,
    `Required: ${budget.required_family_count}`,
    `Candidate: ${budget.candidate_family_count}`,
    `Advisory: ${budget.advisory_family_count}`,
    `Move to test: ${budget.move_to_test_family_count}`,
    `Retiring: ${budget.retire_family_count}`,
    `Upstream candidates: ${budget.upstream_candidate_count}`,
    '',
    budget.recommendation,
  ];

  if (budget.unknown_catch_evidence_family_ids?.length > 0) {
    lines.push(`Unknown catch evidence: ${budget.unknown_catch_evidence_family_ids.join(', ')}`);
  }
  if (budget.missing_review_trigger_family_ids?.length > 0) {
    lines.push(`Missing review triggers: ${budget.missing_review_trigger_family_ids.join(', ')}`);
  }
  if (budget.stale_family_ids?.length > 0) {
    lines.push(`Stale or retiring families: ${budget.stale_family_ids.join(', ')}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function runVerificationBudgetCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseBudgetArgs(argv);
  const format = options.format ?? 'human';
  if (!['human', 'feedback', 'json'].includes(format)) {
    throw new Error('--format must be human, feedback, or json');
  }
  const result = await generateVeritasReport(
    {
      ...options,
      runId: options.runId ?? `budget-${Date.now()}`,
    },
    defaults,
    explicitFiles,
  );

  if (format === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          artifactPath: result.artifactPath,
          verification_budget: result.record.verification_budget,
          proof_family_results: result.record.proof_family_results,
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

  process.stdout.write(formatVerificationBudgetHuman(result.record));
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
  if (options.pack && (options.explore || options.guided || options.apply)) {
    throw new Error('veritas init --pack is only supported on the direct init path');
  }

  if (options.explore || options.guided) {
    const answers = options.answersPath ? loadJson(resolve(rootDir, options.answersPath), 'init answers') : undefined;
    const recommendation = buildInitRecommendation({
      rootDir,
      projectName,
      proofLane: options.proofLane ?? defaults.proofLane,
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
      `Next Steps\n\nSuggested CODEOWNERS block (not written automatically):\n\n${result.codeownersBlock}\n\n`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const result = writeBootstrapStarterKit({
    rootDir,
    projectName,
    proofLane: options.proofLane ?? defaults.proofLane,
    pack: options.pack,
    force: options.force ?? false,
  });
  if (options.nonInteractive) {
    result.attestation = writePendingAttestationMarker(rootDir, {
      reason: 'veritas init ran in non-interactive mode.',
    });
  } else {
    result.attestation = {
      status: 'not-recorded',
      suggestedCommand: `veritas attest bootstrap --actor <human-id> --non-interactive --root ${rootDir}`,
    };
  }

  process.stderr.write(
    `Next Steps\n\nSuggested CODEOWNERS block (not written automatically):\n\n${result.codeownersBlock}\n\n`,
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
    validUntilDays: options.validUntilDays,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runPrintPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        proofLane,
        repoInsights,
        scripts: buildSuggestedPackageScripts({
          proofLane,
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
  const proofLane = options.proofLane ?? repoInsights.proofLane;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        proofLane,
        repoInsights,
        ciSnippet: buildSuggestedCiSnippet({
          proofLane,
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
  const status = inspectRuntimeAdapterStatus(rootDir, {
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
  const proofLane = options.proofLane ?? repoInsights.proofLane;
  const result = applyPackageScripts({
    rootDir,
    proofLane,
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
  const proofLane = options.proofLane ?? repoInsights.proofLane;
  const result = applyCiSnippet({
    rootDir,
    proofLane,
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

export function runEvalRecordCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalRecord(options, {
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

export function runEvalSummaryCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalSummary(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(result.markdownSummary);
}

export function runEvalProposeCli(argv = process.argv.slice(2), defaults = {}) {
  const { options } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--policy-pack': { type: 'string', key: 'policyPackPath' },
    '--adapter': { type: 'string', key: 'adapterPath' },
    '--force': { type: 'flag', key: 'force' },
    '--dry-run': { type: 'flag', key: 'dryRun' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = generateAndWriteProposals({
    ...options,
    rootDir,
    write: !options.dryRun,
  });
  process.stdout.write(`${JSON.stringify({
    proposals: result.proposals,
    written: result.written,
  }, null, 2)}\n`);
}

export function runProposalCli(kind, argv = process.argv.slice(2), defaults = {}) {
  const { options, rest } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--status': { type: 'string', key: 'status' },
    '--actor': { type: 'string', key: 'actor' },
    '--accept': { type: 'flag', key: 'accept' },
    '--reject': { type: 'flag', key: 'reject' },
    '--message': { type: 'string', key: 'message' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (kind === 'list') {
    process.stdout.write(`${JSON.stringify({
      proposals: listProposals({ rootDir, status: options.status ?? 'proposed' }),
    }, null, 2)}\n`);
    return;
  }
  const id = rest[0];
  if (!id) throw new Error(`veritas proposal ${kind} requires <id>`);
  if (kind === 'show') {
    process.stdout.write(`${JSON.stringify(loadProposal(rootDir, id), null, 2)}\n`);
    return;
  }
  if (kind === 'decide') {
    process.stdout.write(`${JSON.stringify(applyProposal({
      rootDir,
      id,
      actor: options.actor,
      accept: options.accept ?? false,
      reject: options.reject ?? false,
      message: options.message ?? '',
    }), null, 2)}\n`);
    return;
  }
  throw new Error(`Unsupported proposal command: ${kind}`);
}

export function runEvalMarkerCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerEvalArgs(argv);
  const result = generateMarkerBenchmarkComparison(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runEvalMarkerSuiteCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerSuiteEvalArgs(argv);
  const result = generateMarkerBenchmarkSuiteReport(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runEvalDraftCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalDraft(options, {
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

export function runEvalObserveCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result =
    options.tool === 'none' || !options.transcriptPath
      ? observeFilesystemEval({
          evidencePath: options.evidencePath,
          rootDir,
          outputPath: options.outputPath,
          churnThreshold: options.rewriteThreshold ?? 0.3,
        })
      : observeTranscriptEval({
          transcriptPath: options.transcriptPath,
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
  const adapter = runtimeAdapterFor(tool, rootDir, options);
  let result;
  if (action === 'status') {
    result = adapter.status();
  } else if (action === 'install') {
    result = {
      preToolUse: adapter.installPreToolUseHook(options),
      stop: adapter.installStopHook(options),
      postSession: adapter.installPostSessionHook(options),
    };
  } else if (action === 'uninstall') {
    result = adapter.uninstall(options);
  } else {
    throw new Error(`Unsupported integrations action: ${action}`);
  }
  process.stdout.write(`${JSON.stringify({ tool, action, rootDir, ...result }, null, 2)}\n`);
}


export { runShadowRunCli };
export { runClaimCli };
