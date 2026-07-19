import { resolve } from 'node:path';
import { parseReadinessArgs } from '../args.mjs';
import {
  buildFeedbackSummary,
  feedbackHasFailures,
} from '../report/index.mjs';
import { hasReadinessOutcomeInputs, runMergeReadiness } from '../readiness/run.mjs';

function normalizeOutputFormat(format, defaultFormat) {
  const resolvedFormat = format ?? defaultFormat;
  if (!['json', 'feedback', 'trust-bundle'].includes(resolvedFormat)) {
    throw new Error('--format must be json, feedback, or trust-bundle');
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
  let readinessRun;
  try {
    readinessRun = await runMergeReadiness(
      { ...options, rootDir },
      { ...defaults, rootDir },
      [],
      {
        onEvidenceCheckOutput: format === 'feedback'
          ? null
          : (evidenceCheckResult) => {
              if (evidenceCheckResult.runner !== 'bash') return;
              const outputStream = format === 'trust-bundle' ? process.stderr : process.stdout;
              if (evidenceCheckResult.stdout) outputStream.write(evidenceCheckResult.stdout);
              if (evidenceCheckResult.stderr) process.stderr.write(evidenceCheckResult.stderr);
            },
      },
    );
  } catch (error) {
    readinessRun = handleSurfaceValidationCliError(error);
  }
  if (!readinessRun) return;

  const {
    reportResult,
    draftResult,
    standardsFeedbackResult,
    evidenceCheckLabels,
    evidenceCheckFailure,
    evidenceCheckPlan,
    options: standardsFeedbackOptions,
  } = readinessRun;

  if (format === 'trust-bundle') {
    const bundle = reportResult.record.trust?.bundle;
    if (!bundle) {
      throw new Error('readiness report did not contain a canonical trust.bundle projection');
    }
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    if (feedbackHasFailures(reportResult.record, evidenceCheckFailure)) {
      process.exitCode = 1;
    }
    return;
  }

  if (!hasReadinessOutcomeInputs(standardsFeedbackOptions)) {
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
          suggestedFeedbackCommand: draftResult.suggestedRecordCommand,
          message:
            'Evidence Check, report, and standards feedback draft completed. The final judgment fields still need confirmation.',
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

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: reportResult.record,
        reportArtifactPath: reportResult.artifactPath,
        draftArtifactPath: draftResult.artifactPath,
        standardsFeedbackArtifactPath: standardsFeedbackResult.artifactPath,
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
        mode: 'report-draft-and-feedback',
        evidenceCheckLabels: options.skipEvidenceCheck ? [] : evidenceCheckLabels,
        evidenceCheckResolutionSource: evidenceCheckPlan.resolutionSource,
        evidenceCheckRan: !options.skipEvidenceCheck,
        evidenceCheckFailure,
        reportArtifactPath: reportResult.artifactPath,
        draftArtifactPath: draftResult.artifactPath,
        standardsFeedbackArtifactPath: standardsFeedbackResult.artifactPath,
        reportRunId: reportResult.record.run_id,
        reportSourceKind: reportResult.record.source_kind,
        feedbackMode: standardsFeedbackResult.record.mode,
      },
      null,
      2,
    )}\n`,
  );
  if (feedbackHasFailures(reportResult.record, evidenceCheckFailure)) {
    process.exitCode = 1;
  }
}
