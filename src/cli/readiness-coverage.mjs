import { parseCoverageArgs } from '../args.mjs';
import { buildReadinessCoverage } from '../evidence/index.mjs';
import {
  generateVeritasReport,
  buildFeedbackSummary,
} from '../report/index.mjs';

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
