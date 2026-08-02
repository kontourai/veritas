import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseReadinessArgs } from '../args.mjs';
import { assertWithinDir } from '../paths.mjs';
import {
  buildFeedbackSummary,
  feedbackHasFailures,
} from '../report/index.mjs';
import { hasReadinessOutcomeInputs, runMergeReadiness } from '../readiness/run.mjs';
import { readinessVerdict, requiredEvidenceChecksFor } from '../surface/readiness.mjs';

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

function retainProjection({ rootDir, reportResult, outputPath, force }) {
  if (!outputPath) return null;
  const sourcePath = resolve(rootDir, reportResult.consoleReadModelPath);
  const destinationPath = resolve(rootDir, outputPath);
  assertWithinDir(destinationPath, rootDir, 'readiness --projection-output must stay inside the target repository');
  if (existsSync(destinationPath) && !force) {
    throw new Error(`Refusing to overwrite existing projection output: ${relative(rootDir, destinationPath)}`);
  }
  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
  return relative(rootDir, destinationPath).replaceAll('\\', '/');
}

export function readinessRuntimeEnvelope(record, currentStatus) {
  const requiredEvidenceChecks = requiredEvidenceChecksFor(record);
  return {
    // This lives only in command stdout. The v1 evidence record remains free
    // of execution state and is deliberately not mutated for CLI reporting.
    status: currentStatus,
    verdict: readinessVerdict(record),
    requiredEvidenceChecks,
    remediation: requiredEvidenceChecks
      .filter((check) => check.state !== 'passed')
      .map((check) => ({
        id: check.id,
        state: check.state,
        message: `Required Evidence Check ${check.id} is ${check.state}; run it and record an acceptable result before merge readiness can be verified.`,
      })),
  };
}

export async function runReadinessCheckCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseReadinessArgs(argv);
  const format = normalizeOutputFormat(options.format, 'feedback');
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const onReadinessPhase = ({ phase, label }) => {
    process.stderr.write(`RUN   ${phase}${label ? `: ${label}` : ''}\n`);
  };
  let readinessRun;
  try {
    readinessRun = await runMergeReadiness(
      { ...options, rootDir },
      { ...defaults, rootDir },
      [],
      {
        ...(defaults.readinessRuntime ?? {}),
        onReadinessPhase,
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
    evidenceCheckResults,
    evidenceCheckFailure,
    evidenceCheckPlan,
    evidenceCheckExecutionSkipped,
    currentStatus,
    options: standardsFeedbackOptions,
  } = readinessRun;
  const projectionOutputPath = retainProjection({
    rootDir,
    reportResult,
    outputPath: options.projectionOutputPath,
    force: options.force,
  });

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
          evidenceCheckResults: options.skipEvidenceCheck ? [] : evidenceCheckResults,
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
          evidenceCheckLabels: evidenceCheckExecutionSkipped ? [] : evidenceCheckLabels,
          evidenceCheckResolutionSource: evidenceCheckPlan.resolutionSource,
          evidenceCheckRan: !evidenceCheckExecutionSkipped,
          evidenceCheckFailure,
          readiness: readinessRuntimeEnvelope(reportResult.record, currentStatus),
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          ...(projectionOutputPath ? { projectionOutputPath } : {}),
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
          evidenceCheckLabels: evidenceCheckExecutionSkipped ? [] : evidenceCheckLabels,
          evidenceCheckResults: evidenceCheckExecutionSkipped ? [] : evidenceCheckResults,
          evidenceCheckRan: !evidenceCheckExecutionSkipped,
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
        evidenceCheckLabels: evidenceCheckExecutionSkipped ? [] : evidenceCheckLabels,
        evidenceCheckResolutionSource: evidenceCheckPlan.resolutionSource,
        evidenceCheckRan: !evidenceCheckExecutionSkipped,
        evidenceCheckFailure,
        readiness: readinessRuntimeEnvelope(reportResult.record, currentStatus),
        reportArtifactPath: reportResult.artifactPath,
        draftArtifactPath: draftResult.artifactPath,
        standardsFeedbackArtifactPath: standardsFeedbackResult.artifactPath,
        reportRunId: reportResult.record.run_id,
        reportSourceKind: reportResult.record.source_kind,
        ...(projectionOutputPath ? { projectionOutputPath } : {}),
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
