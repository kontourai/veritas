import {
  feedbackHasFailures,
} from '../report/index.mjs';
import { generateStandardsFeedbackDraft, generateStandardsFeedbackRecord } from '../standards-feedback/records.mjs';
import { appendRunHistory, deriveTimeToGreenFromRunHistory } from '../standards-feedback/run-history.mjs';

export function hasReadinessOutcomeInputs(options) {
  return (
    typeof options.acceptedWithoutMajorRewrite === 'boolean' &&
    typeof options.requiredFollowup === 'boolean' &&
    typeof options.timeToGreenMinutes === 'number' &&
    !Number.isNaN(options.timeToGreenMinutes)
  );
}

function resolveStandardsFeedbackOptions({
  options,
  rootDir,
  actor,
  currentStatus,
  finishedAt,
  runtime,
}) {
  const historyTimeToGreen = runtime.appendHistory === false
    ? null
    : deriveTimeToGreenFromRunHistory(rootDir, {
        actor,
        currentStatus,
        finishedAt,
      });
  return {
    ...options,
    timeToGreenMinutes: options.timeToGreenMinutes ?? historyTimeToGreen ?? undefined,
  };
}

export function finalizeReadinessArtifacts({
  rootDir,
  options,
  defaults,
  runtime,
  actor,
  startedAt,
  reportResult,
  evidenceCheckFailure,
}) {
  const currentStatus = feedbackHasFailures(reportResult.record, evidenceCheckFailure) ? 'fail' : 'pass';
  const finishedAt = runtime.finishedAt ?? new Date().toISOString();
  const standardsFeedbackOptions = resolveStandardsFeedbackOptions({
    options,
    rootDir,
    actor,
    currentStatus,
    finishedAt,
    runtime,
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
    finishedAt,
    currentStatus,
    standardsFeedbackOptions,
    draftResult,
    standardsFeedbackResult,
  };
}
