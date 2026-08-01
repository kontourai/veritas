import { resolve } from 'node:path';
import { evidenceCheckLabel } from '../evidence/index.mjs';
import {
  generateVeritasReport,
  resolveVeritasPaths,
  resolveReportInputs,
  resolveEvidenceCheckCommands,
} from '../report/index.mjs';
import { runEvidenceCheckPlan } from './evidence-check-runner.mjs';
import { finalizeReadinessArtifacts, hasReadinessOutcomeInputs } from './feedback-artifacts.mjs';

export { hasReadinessOutcomeInputs };

function assertWorkflowDeadline(deadline, phase) {
  if (!deadline || Date.now() < deadline) return;
  const error = new Error(`Merge Readiness workflow timed out before ${phase}`);
  error.code = 'VERITAS_READINESS_WORKFLOW_TIMEOUT';
  error.phase = phase;
  throw error;
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
  const workflowDeadline = runtime.workflowTimeoutMs > 0
    ? Date.now() + runtime.workflowTimeoutMs
    : null;
  const actor = runtime.actor ?? process.env.VERITAS_ACTOR ?? 'unknown';
  const workingTree = options.workingTree || (!options.changedFrom && !options.changedTo);
  runtime.onReadinessPhase?.({ phase: 'scope-resolution' });
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
  if (!options.skipEvidenceCheck) {
    const result = await runEvidenceCheckPlan({
      evidenceChecks,
      rootDir,
      runtime,
      evidenceCheckTimeoutMs: options.evidenceCheckTimeoutMs,
    });
    evidenceCheckFailure = result.evidenceCheckFailure;
    evidenceCheckResults = result.evidenceCheckResults;
  }

  assertWorkflowDeadline(workflowDeadline, 'report');
  runtime.onReadinessPhase?.({ phase: 'report' });
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
  runtime.onReadinessPhase?.({ phase: 'complete', currentStatus });
  return result;
}
