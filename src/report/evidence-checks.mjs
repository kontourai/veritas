import { uniqueStrings } from '../util/strings.mjs';
import {
  evidenceCheckLabel,
  evidenceCheckRecordsForCommands,
  readEvidenceChecks,
} from '../evidence/index.mjs';

function evidenceCheckResultById(evidenceCheckResults, id) {
  return (evidenceCheckResults ?? []).find((result) => result.id === id) ?? null;
}

function evidenceCheckResultSummary(result) {
  if (!result) return null;
  if (result.passed) return 'All evidence checks passed.';
  if (result.runner === 'mcp') {
    const text = result.content?.find((content) => content.type === 'text')?.text;
    return text
      ? `MCP tool error: ${text.split('\n')[0]}`
      : 'MCP tool returned an error.';
  }
  const status = result.exitCode !== null && result.exitCode !== undefined
    ? `exit code ${result.exitCode}`
    : `signal ${result.signal ?? 'unknown'}`;
  const firstOutputLine = String(result.stderr || result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstOutputLine
    ? `Evidence checks failed with ${status}: ${firstOutputLine}`
    : `Evidence checks failed with ${status}.`;
}

export function buildEvidenceRecommendations(evidenceCheckPlan) {
  const { unmatchedFiles } = evidenceCheckPlan;
  if (!unmatchedFiles.length) return [];

  const unresolvedMessage =
    evidenceCheckPlan.uncoveredPathResult === 'fail'
      ? 'Some files do not match a configured work area and fail the uncovered-path policy.'
      : evidenceCheckPlan.uncoveredPathResult === 'ignore'
        ? 'Some files do not match a configured work area and were ignored by policy.'
        : 'Some files do not match a configured work area and need manual review.';

  return [
    {
      kind: 'unmatched-files',
      severity: evidenceCheckPlan.uncoveredPathResult,
      message: unresolvedMessage,
      files: unmatchedFiles,
    },
  ];
}

export function resolveSelectedEvidenceCheckSources(config, evidenceCheckPlan) {
  return evidenceCheckPlan.evidenceChecks ??
    evidenceCheckRecordsForCommands(config, evidenceCheckPlan.evidenceCheckCommands);
}

export function buildSelectedEvidenceChecks({ evidenceChecks, evidenceCheckResults }) {
  return evidenceChecks.map((evidenceCheck) => {
    const label = evidenceCheckLabel(evidenceCheck);
    const runner = evidenceCheck.runner ?? 'bash';
    const evidenceCheckResult = evidenceCheckResultById(evidenceCheckResults, evidenceCheck.id);
    return {
      id: evidenceCheck.id,
      runner,
      label,
      ...(evidenceCheck.command ? { command: evidenceCheck.command } : {}),
      method: evidenceCheck.method,
      surface_claim_ids: uniqueStrings(evidenceCheck.surfaceClaimIds ?? []),
      summary: evidenceCheckResultSummary(evidenceCheckResult) ?? evidenceCheck.summary ?? `Evidence Check ${evidenceCheck.id}: ${label}`,
      ...(evidenceCheckResult ? { evidence_check_result: evidenceCheckResult } : {}),
    };
  });
}

export function buildAllEvidenceChecks(config, selectedEvidenceCheckIds) {
  return readEvidenceChecks(config).map((evidenceCheck) => ({
    id: evidenceCheck.id,
    runner: evidenceCheck.runner ?? 'bash',
    label: evidenceCheckLabel(evidenceCheck),
    ...(evidenceCheck.command ? { command: evidenceCheck.command } : {}),
    method: evidenceCheck.method,
    surface_claim_ids: uniqueStrings(evidenceCheck.surfaceClaimIds ?? []),
    summary: evidenceCheck.summary ?? '',
    selected: selectedEvidenceCheckIds.includes(evidenceCheck.id),
  }));
}
