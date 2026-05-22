import { resolve } from 'node:path';
import { parseReadinessArgs } from '../args.mjs';
import { runBash, createMcpServerPool } from '../runner/index.mjs';
import { evidenceCheckLabel } from '../evidence/index.mjs';
import {
  generateVeritasReport,
  buildFeedbackSummary,
  feedbackHasFailures,
  resolveVeritasPaths,
  resolveReportInputs,
  resolveEvidenceCheckCommands,
} from '../report.mjs';
import { generateEvalDraft, generateEvalRecord } from '../eval/records.mjs';
import { appendRunHistory, deriveTimeToGreenFromRunHistory } from '../eval/run-history.mjs';

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

export async function runReadinessCheckCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseReadinessArgs(argv);
  const format = normalizeOutputFormat(options.format, 'feedback');
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const startedAt = new Date().toISOString();
  const actor = process.env.VERITAS_ACTOR ?? 'unknown';
  const { adapterPath } = resolveVeritasPaths(
    { ...options, rootDir },
    { ...defaults, rootDir },
  );
  const reportInputs = resolveReportInputs(
    [],
    {
      ...options,
      workingTree:
        options.workingTree || (!options.changedFrom && !options.changedTo),
    },
    rootDir,
  );
  const evidenceCheckPlan = resolveEvidenceCheckCommands({
    adapterPath,
    files: reportInputs.files,
    rootDir,
    explicitEvidenceCheckCommand: options.evidenceCheckCommand,
  });
  const evidenceChecks = evidenceCheckPlan.evidenceChecks ?? [];
  const evidenceCheckLabels = evidenceChecks.map((evidenceCheck) => evidenceCheckLabel(evidenceCheck));
  if (!options.skipEvidenceCheck && evidenceChecks.length === 0) {
    throw new Error(
      'veritas readiness requires an evidenceCheck command or configured evidenceCheck',
    );
  }

  let evidenceCheckFailure = null;
  const evidenceCheckResults = [];
  if (!options.skipEvidenceCheck) {
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const pool = createMcpServerPool({ signal: controller.signal });
    try {
      for (const evidenceCheck of evidenceChecks) {
        const runner = evidenceCheck.runner ?? 'bash';
        const label = evidenceCheckLabel(evidenceCheck);
        try {
          const result = runner === 'mcp'
            ? await pool.call(evidenceCheck.server, evidenceCheck.tool, evidenceCheck.input ?? {}, { signal: controller.signal })
            : await runBash(evidenceCheck.command, { cwd: rootDir, signal: controller.signal });
          const evidenceCheckResult = {
            id: evidenceCheck.id,
            runner,
            label,
            passed: runner === 'mcp' ? !result.isError : result.passed,
            exitCode: runner === 'bash' ? result.exitCode ?? null : null,
            signal: runner === 'bash' ? result.signal ?? null : null,
            stdout: runner === 'bash' ? result.stdout ?? '' : '',
            stderr: runner === 'bash' ? result.stderr ?? '' : '',
            content: runner === 'mcp' ? result.content ?? [] : [],
            isError: runner === 'mcp' ? result.isError ?? false : false,
            durationMs: result.durationMs ?? 0,
          };
          evidenceCheckResults.push(evidenceCheckResult);
          if (format !== 'feedback' && runner === 'bash') {
            if (evidenceCheckResult.stdout) process.stdout.write(evidenceCheckResult.stdout);
            if (evidenceCheckResult.stderr) process.stderr.write(evidenceCheckResult.stderr);
          }
          if (!evidenceCheckResult.passed) {
            const status = runner === 'mcp'
              ? 'MCP tool returned an error'
              : (evidenceCheckResult.exitCode ?? evidenceCheckResult.signal ?? 'unknown status');
            evidenceCheckFailure = {
              id: evidenceCheck.id,
              runner,
              label,
              message: runner === 'mcp' ? status : `Evidence Check command exited with ${status}`,
              ...(runner === 'bash' ? {
                stdout: evidenceCheckResult.stdout,
                stderr: evidenceCheckResult.stderr,
                exitCode: evidenceCheckResult.exitCode,
              } : {
                content: evidenceCheckResult.content,
                isError: evidenceCheckResult.isError,
              }),
            };
            break;
          }
        } catch (error) {
          evidenceCheckFailure = {
            id: evidenceCheck.id,
            runner,
            label,
            message: error.message,
          };
          break;
        }
      }
    } finally {
      await pool.close();
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  }

  let reportResult;
  try {
    reportResult = await generateVeritasReport(
      {
        ...options,
        rootDir,
        evidenceCheckResults,
        workingTree:
          options.workingTree || (!options.changedFrom && !options.changedTo),
        baselineCiFastStatus:
          options.baselineCiFastStatus ??
          (options.skipEvidenceCheck ? undefined : evidenceCheckFailure ? 'failed' : 'success'),
        explicitEvidenceCheckCommand: options.evidenceCheckCommand,
        includeAttestationGate: true,
      },
      { ...defaults, rootDir },
    );
  } catch (error) {
    reportResult = handleSurfaceValidationCliError(error);
  }
  if (!reportResult) return;
  if (reportResult.record.uncovered_path_result === 'fail') {
    throw new Error(
      'veritas readiness encountered changed files outside configured work areas and the uncovered-path policy is fail',
    );
  }
  const currentStatus = feedbackHasFailures(reportResult.record, evidenceCheckFailure) ? 'fail' : 'pass';
  const finishedAt = new Date().toISOString();
  const historyTimeToGreen = deriveTimeToGreenFromRunHistory(rootDir, {
    actor,
    currentStatus,
    finishedAt,
  });
  appendRunHistory(rootDir, {
    run_id: reportResult.record.run_id,
    started_at: startedAt,
    finished_at: finishedAt,
    status: currentStatus,
    actor,
  });
  const evalOptions = {
    ...options,
    timeToGreenMinutes: options.timeToGreenMinutes ?? historyTimeToGreen ?? undefined,
  };
  const draftResult = generateEvalDraft(
    {
      ...evalOptions,
      rootDir,
      evidencePath: reportResult.artifactPath,
      force: evalOptions.force ?? false,
    },
    { ...defaults, rootDir },
  );

  if (!hasReadinessOutcomeInputs(evalOptions)) {
    if (format === 'feedback') {
      process.stdout.write(
        buildFeedbackSummary({
          record: reportResult.record,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          evidenceCheckLabels: options.skipEvidenceCheck ? [] : evidenceCheckLabels,
          evidenceCheckRan: !options.skipEvidenceCheck,
          evidenceCheckFailure,
        }),
      );
      if (feedbackHasFailures(reportResult.record, evidenceCheckFailure)) {
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'report-and-draft',
          evidenceCheckLabels: options.skipEvidenceCheck ? [] : evidenceCheckLabels,
          evidenceCheckResolutionSource: evidenceCheckPlan.resolutionSource,
          evidenceCheckRan: !options.skipEvidenceCheck,
          evidenceCheckFailure,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          suggestedEvalCommand: draftResult.suggestedRecordCommand,
          message:
            'Evidence Check, report, and eval draft completed. The final judgment fields still need confirmation.',
        },
        null,
        2,
      )}\n`,
    );
    if (feedbackHasFailures(reportResult.record, evidenceCheckFailure)) {
      process.exitCode = 1;
    }
    return;
  }

  const evalResult = generateEvalRecord(
    {
      ...options,
      ...evalOptions,
      rootDir,
      draftPath: draftResult.artifactPath,
      force: evalOptions.force ?? false,
    },
    { ...defaults, rootDir },
  );

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: reportResult.record,
        reportArtifactPath: reportResult.artifactPath,
        draftArtifactPath: draftResult.artifactPath,
        evalArtifactPath: evalResult.artifactPath,
        evidenceCheckLabels: options.skipEvidenceCheck ? [] : evidenceCheckLabels,
        evidenceCheckRan: !options.skipEvidenceCheck,
        evidenceCheckFailure,
      }),
    );
    if (feedbackHasFailures(reportResult.record, evidenceCheckFailure)) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
        {
          mode: 'report-draft-and-eval',
          evidenceCheckLabels: options.skipEvidenceCheck ? [] : evidenceCheckLabels,
          evidenceCheckResolutionSource: evidenceCheckPlan.resolutionSource,
          evidenceCheckRan: !options.skipEvidenceCheck,
          evidenceCheckFailure,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          evalArtifactPath: evalResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          evalMode: evalResult.record.mode,
        },
      null,
      2,
    )}\n`,
  );
  if (feedbackHasFailures(reportResult.record, evidenceCheckFailure)) {
    process.exitCode = 1;
  }
}
