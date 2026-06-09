import { parseArgs } from '../args.mjs';
import {
  generateVeritasReport,
  buildFeedbackSummary,
  feedbackHasFailures,
} from '../report/index.mjs';
import {
  generateStandardsFeedbackSummary,
} from '../standards-feedback/records.mjs';

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
