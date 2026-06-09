import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { loadJson } from '../load.mjs';
import {
  parseArgs,
  parseCoverageArgs,
  parseInitArgs,
  parseAttestArgs,
} from '../args.mjs';
import { assertWithinDir } from '../paths.mjs';
import {
  writeBootstrapStarterKit,
} from '../bootstrap.mjs';
import {
  buildInitRecommendation,
  applyInitRecommendation,
} from '../bootstrap/recommendation.mjs';
import { runEvidenceCheckCommand } from '../shell.mjs';
import { buildReadinessCoverage } from '../evidence/index.mjs';
import {
  generateVeritasReport,
  buildFeedbackSummary,
  feedbackHasFailures,
} from '../report/index.mjs';
import {
  generateStandardsFeedbackSummary,
} from '../standards-feedback/records.mjs';
import { runReadinessCheckCli } from './readiness-check.mjs';
import { runClaimCli } from './claims.mjs';
import {
  createAttestation,
  inspectAttestationStatus,
  writePendingAttestationMarker,
} from '../attestations.mjs';
export {
  runPrintPackageScriptsCli,
  runPrintCiSnippetCli,
  runPrintGitHookCli,
  runPrintRuntimeHookCli,
  runPrintStopHookCli,
  runPrintClaudeCodePreToolUseHookCli,
  runPrintGovernanceBlockCli,
  runPrintCodexHookCli,
  runRuntimeStatusCli,
  runApplyPackageScriptsCli,
  runApplyCiSnippetCli,
  runApplyGitHookCli,
  runSetupRepoHooksCli,
  runApplyRuntimeHookCli,
  runApplyStopHookCli,
  runApplyClaudeCodePreToolUseHookCli,
  runClaudeCodePreToolUseCli,
  runApplyGovernanceBlocksCli,
  runApplyCodexHookCli,
  runIntegrationsCli,
} from './setup.mjs';
export {
  runRecommendationCli,
  runStandardsFeedbackDraftCli,
  runStandardsFeedbackMarkerCli,
  runStandardsFeedbackMarkerSuiteCli,
  runStandardsFeedbackObserveCli,
  runStandardsFeedbackRecommendCli,
  runStandardsFeedbackRecordCli,
  runStandardsFeedbackSummaryCli,
} from './standards-feedback.mjs';

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

export { runReadinessCheckCli };
export { runClaimCli };
