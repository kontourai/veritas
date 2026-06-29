import { resolve } from 'node:path';
import { runBash, createMcpServerPool } from '../runner/index.mjs';
import { evidenceCheckLabel } from '../evidence/index.mjs';
import {
  generateVeritasReport,
  feedbackHasFailures,
  resolveVeritasPaths,
  resolveReportInputs,
  resolveEvidenceCheckCommands,
} from '../report/index.mjs';
import { generateStandardsFeedbackDraft, generateStandardsFeedbackRecord } from '../standards-feedback/records.mjs';
import { appendRunHistory, deriveTimeToGreenFromRunHistory } from '../standards-feedback/run-history.mjs';

/**
 * Default per-evidence-check timeout (ms). Without it, a bash check waiting on
 * stdin/network hangs `veritas readiness` until manual SIGINT. Override per check
 * via `evidenceCheck.timeoutMs`, or globally via the `evidenceCheckTimeoutMs`
 * option. Generous so legitimately slow checks are not killed.
 */
export const DEFAULT_EVIDENCE_CHECK_TIMEOUT_MS = 10 * 60_000;

export function hasReadinessOutcomeInputs(options) {
  return (
    typeof options.acceptedWithoutMajorRewrite === 'boolean' &&
    typeof options.requiredFollowup === 'boolean' &&
    typeof options.timeToGreenMinutes === 'number' &&
    !Number.isNaN(options.timeToGreenMinutes)
  );
}

async function runEvidenceChecks({ evidenceChecks, rootDir, signal, onOutput, evidenceCheckTimeoutMs = DEFAULT_EVIDENCE_CHECK_TIMEOUT_MS }) {
  let evidenceCheckFailure = null;
  const evidenceCheckResults = [];
  const pool = createMcpServerPool({ signal });
  try {
    for (const evidenceCheck of evidenceChecks) {
      const runner = evidenceCheck.runner ?? 'bash';
      const label = evidenceCheckLabel(evidenceCheck);
      const checkTimeoutMs = evidenceCheck.timeoutMs ?? evidenceCheckTimeoutMs;
      try {
        const result = runner === 'mcp'
          ? await pool.call(evidenceCheck.server, evidenceCheck.tool, evidenceCheck.input ?? {}, { signal })
          : await runBash(evidenceCheck.command, { cwd: rootDir, signal, timeoutMs: checkTimeoutMs });
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
          timedOut: runner === 'bash' ? result.timedOut ?? false : false,
          durationMs: result.durationMs ?? 0,
        };
        evidenceCheckResults.push(evidenceCheckResult);
        onOutput?.(evidenceCheckResult);
        if (!evidenceCheckResult.passed) {
          const status = runner === 'mcp'
            ? 'MCP tool returned an error'
            : evidenceCheckResult.timedOut
              ? `timed out after ${checkTimeoutMs}ms`
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
  }
  return { evidenceCheckFailure, evidenceCheckResults };
}

export async function runMergeReadiness(
  rawOptions = {},
  defaults = {},
  explicitFiles = [],
  runtime = {},
) {
  const options = { ...rawOptions };
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const startedAt = runtime.startedAt ?? new Date().toISOString();
  const actor = runtime.actor ?? process.env.VERITAS_ACTOR ?? 'unknown';
  const workingTree = options.workingTree || (!options.changedFrom && !options.changedTo);
  const { repoMapPath } = resolveVeritasPaths(
    { ...options, rootDir },
    { ...defaults, rootDir },
  );
  const reportInputs = resolveReportInputs(
    explicitFiles,
    { ...options, workingTree },
    rootDir,
  );
  const evidenceCheckPlan = resolveEvidenceCheckCommands({
    repoMapPath,
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
  let evidenceCheckResults = [];
  if (!options.skipEvidenceCheck && runtime.runEvidenceChecks !== false) {
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
      const result = await runEvidenceChecks({
        evidenceChecks,
        rootDir,
        signal: controller.signal,
        onOutput: runtime.onEvidenceCheckOutput,
        evidenceCheckTimeoutMs: options.evidenceCheckTimeoutMs,
      });
      evidenceCheckFailure = result.evidenceCheckFailure;
      evidenceCheckResults = result.evidenceCheckResults;
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  }

  const reportResult = await generateVeritasReport(
    {
      ...options,
      rootDir,
      evidenceCheckResults,
      workingTree,
      baselineCiFastStatus:
        options.baselineCiFastStatus ??
        (options.skipEvidenceCheck ? undefined : evidenceCheckFailure ? 'failed' : 'success'),
      explicitEvidenceCheckCommand: options.evidenceCheckCommand,
      includeAttestationGate: runtime.includeAttestationGate ?? true,
    },
    { ...defaults, rootDir },
    explicitFiles,
  );
  if (reportResult.record.uncovered_path_result === 'fail') {
    throw new Error(
      'veritas readiness encountered changed files outside configured work areas and the uncovered-path policy is fail',
    );
  }

  const currentStatus = feedbackHasFailures(reportResult.record, evidenceCheckFailure) ? 'fail' : 'pass';
  const finishedAt = runtime.finishedAt ?? new Date().toISOString();
  const historyTimeToGreen = runtime.appendHistory === false
    ? null
    : deriveTimeToGreenFromRunHistory(rootDir, {
        actor,
        currentStatus,
        finishedAt,
      });
  if (runtime.appendHistory !== false) {
    appendRunHistory(rootDir, {
      run_id: reportResult.record.run_id,
      started_at: startedAt,
      finished_at: finishedAt,
      status: currentStatus,
      actor,
    });
  }

  const standardsFeedbackOptions = {
    ...options,
    timeToGreenMinutes: options.timeToGreenMinutes ?? historyTimeToGreen ?? undefined,
  };
  const draftResult = runtime.createDraft === false
    ? null
    : generateStandardsFeedbackDraft(
        {
          ...standardsFeedbackOptions,
          rootDir,
          evidencePath: reportResult.artifactPath,
          force: standardsFeedbackOptions.force ?? false,
          ...(runtime.draftOptions ?? {}),
        },
        { ...defaults, rootDir },
      );
  const standardsFeedbackResult = draftResult && hasReadinessOutcomeInputs(standardsFeedbackOptions)
    ? generateStandardsFeedbackRecord(
        {
          ...options,
          ...standardsFeedbackOptions,
          rootDir,
          draftPath: draftResult.artifactPath,
          force: standardsFeedbackOptions.force ?? false,
        },
        { ...defaults, rootDir },
      )
    : null;

  return {
    rootDir,
    startedAt,
    finishedAt,
    actor,
    options: standardsFeedbackOptions,
    evidenceCheckPlan,
    evidenceChecks,
    evidenceCheckLabels,
    evidenceCheckFailure,
    evidenceCheckResults,
    reportResult,
    draftResult,
    standardsFeedbackResult,
    currentStatus,
  };
}
