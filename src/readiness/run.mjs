import { resolve } from 'node:path';
import { evidenceCheckLabel, publicEvidenceCheck } from '../evidence/index.mjs';
import {
  generateVeritasReport,
  resolveVeritasPaths,
  resolveReportInputs,
  resolveEvidenceCheckCommands,
} from '../report/index.mjs';
import { runEvidenceCheckPlan } from './evidence-check-runner.mjs';
import { finalizeReadinessArtifacts, hasReadinessOutcomeInputs } from './feedback-artifacts.mjs';
import { resolveActor } from '../util/actor.mjs';

export { hasReadinessOutcomeInputs };

function workflowTimeoutError(phase, cause) {
  const error = new Error(`Merge Readiness workflow timed out before ${phase}`);
  error.code = 'VERITAS_READINESS_WORKFLOW_TIMEOUT';
  error.phase = phase;
  error.reason = 'timeout';
  if (cause) error.cause = cause;
  return error;
}

function remainingWorkflowTimeout(deadline, phase) {
  if (!deadline) return undefined;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw workflowTimeoutError(phase);
  return remaining;
}

function assertWorkflowDeadline(deadline, phase) {
  remainingWorkflowTimeout(deadline, phase);
}

function isProcessTimeout(error) {
  return error?.code === 'ETIMEDOUT' || error?.killed === true;
}

function safeEvidenceCheckForResult(evidenceCheck) {
  return publicEvidenceCheck(evidenceCheck);
}

function safeEvidenceCheckPlanForResult(evidenceCheckPlan) {
  return {
    ...evidenceCheckPlan,
    evidenceChecks: (evidenceCheckPlan.evidenceChecks ?? []).map(safeEvidenceCheckForResult),
  };
}

function safeReportResultForResult(reportResult) {
  return {
    ...reportResult,
    config: reportResult.config
      ? {
          ...reportResult.config,
          evidence: reportResult.config.evidence
            ? {
                ...reportResult.config.evidence,
                evidenceChecks: (reportResult.config.evidence.evidenceChecks ?? []).map(safeEvidenceCheckForResult),
              }
            : reportResult.config.evidence,
        }
      : reportResult.config,
  };
}

export async function runMergeReadiness(
  rawOptions = {},
  defaults = {},
  explicitFiles = [],
  runtime = {},
) {
  const options = { ...rawOptions };
  if (options.skipEvidenceCheck === true && options.evidenceCheckCommand) {
    // An explicit command is a required check for this run, so asking to skip
    // evidence checks while supplying one is contradictory. Refuse before any
    // scope resolution or execution.
    throw new Error(
      'veritas readiness: --evidence-check-command cannot be combined with --skip-evidence-check; the explicit command is a required check for the run',
    );
  }
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const startedAt = runtime.startedAt ?? new Date().toISOString();
  const workflowDeadline = runtime.workflowTimeoutMs > 0
    ? Date.now() + runtime.workflowTimeoutMs
    : null;
  // One actor for the whole run: the work-area-boundary rule, the readiness authority trace, and
  // run history all use it. --actor beats an embedder's runtime.actor default, which beats
  // VERITAS_ACTOR, so a caller's explicit actor is never overridden by an embedding host.
  const resolvedActor = resolveActor(options.actor, runtime.actor);
  const actor = resolvedActor ?? 'unknown';
  const workingTree = options.workingTree || (!options.changedFrom && !options.changedTo);
  runtime.onReadinessPhase?.({ phase: 'scope-resolution' });
  const { repoMapPath, repoStandardsPath } = resolveVeritasPaths(
    { ...options, rootDir },
    { ...defaults, rootDir },
  );
  let reportInputs;
  try {
    reportInputs = resolveReportInputs(
      explicitFiles,
      { ...options, workingTree },
      rootDir,
      { gitTimeoutMs: remainingWorkflowTimeout(workflowDeadline, 'scope-resolution') },
    );
  } catch (error) {
    if (isProcessTimeout(error)) throw workflowTimeoutError('scope-resolution', error);
    throw error;
  }
  assertWorkflowDeadline(workflowDeadline, 'scope-resolution');
  const evidenceCheckPlan = resolveEvidenceCheckCommands({
    repoMapPath,
    repoStandardsPath,
    files: reportInputs.files,
    classificationScope: reportInputs.classificationScope,
    rootDir,
    explicitEvidenceCheckCommand: options.evidenceCheckCommand,
  });
  const evidenceChecks = evidenceCheckPlan.evidenceChecks ?? [];
  const evidenceCheckLabels = evidenceChecks.map((evidenceCheck) => evidenceCheckLabel(evidenceCheck));
  const evidenceCheckExecutionSkipped = options.skipEvidenceCheck === true || runtime.runEvidenceChecks === false;
  if (!evidenceCheckExecutionSkipped && evidenceChecks.length === 0) {
    throw new Error(
      'veritas readiness requires an evidenceCheck command or configured evidenceCheck',
    );
  }

  let evidenceCheckFailure = null;
  let evidenceCheckResults = [];
  if (!evidenceCheckExecutionSkipped) {
    const result = await runEvidenceCheckPlan({
      evidenceChecks,
      rootDir,
      runtime,
      evidenceCheckTimeoutMs: options.evidenceCheckTimeoutMs,
      requiredEvidenceCheckIds: evidenceCheckPlan.requiredEvidenceCheckIds,
    });
    evidenceCheckFailure = result.evidenceCheckFailure;
    evidenceCheckResults = result.evidenceCheckResults;
  }
  const allRequiredEvidencePassed = evidenceCheckPlan.requiredEvidenceCheckIds.every((id) => (
    evidenceCheckResults.find((result) => result.id === id)?.passed === true
  ));

  assertWorkflowDeadline(workflowDeadline, 'report');
  runtime.onReadinessPhase?.({ phase: 'report' });
  const reportResult = await generateVeritasReport(
    {
      ...options,
      rootDir,
      actor: resolvedActor,
      evidenceCheckResults,
      evidenceCheckFailure,
      evidenceCheckPlan,
      evidenceCheckExecutionSkipped,
      workingTree,
      baselineCiFastStatus:
        evidenceCheckExecutionSkipped
          ? undefined
          : allRequiredEvidencePassed
            ? (options.baselineCiFastStatus ?? (evidenceCheckFailure ? 'failed' : 'success'))
            : 'failed',
      explicitEvidenceCheckCommand: options.evidenceCheckCommand,
      includeAttestationGate: runtime.includeAttestationGate ?? true,
    },
    { ...defaults, rootDir },
    explicitFiles,
    { reportInputs },
  );
  if (reportResult.record.uncovered_path_result === 'fail') {
    throw new Error(
      'veritas readiness encountered changed files outside configured work areas and the uncovered-path policy is fail',
    );
  }

  assertWorkflowDeadline(workflowDeadline, 'finalization');
  runtime.onReadinessPhase?.({ phase: 'finalization' });
  const {
    finishedAt,
    currentStatus,
    standardsFeedbackOptions,
    draftResult,
    standardsFeedbackResult,
  } = finalizeReadinessArtifacts({
    rootDir,
    options,
    defaults,
    runtime,
    actor,
    startedAt,
    reportResult,
    evidenceCheckFailure,
  });
  assertWorkflowDeadline(workflowDeadline, 'complete');

  const result = {
    rootDir,
    startedAt,
    finishedAt,
    actor,
    options: standardsFeedbackOptions,
    evidenceCheckPlan: safeEvidenceCheckPlanForResult(evidenceCheckPlan),
    evidenceChecks: evidenceChecks.map(safeEvidenceCheckForResult),
    evidenceCheckLabels,
    evidenceCheckFailure,
    evidenceCheckResults,
    evidenceCheckExecutionSkipped,
    reportResult: safeReportResultForResult(reportResult),
    draftResult,
    standardsFeedbackResult,
    currentStatus,
  };
  runtime.onReadinessPhase?.({ phase: 'complete', currentStatus });
  return result;
}
