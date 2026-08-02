import { uniqueStrings } from '../util/strings.mjs';
import {
  evidenceCheckLabel,
  evidenceCheckRecordsForCommands,
  evidenceChecksByIds,
  readEvidenceChecks,
  readRequiredEvidenceCheckIds,
} from '../evidence/index.mjs';
import { isBoundEvidenceCheckResult } from '../evidence/execution-tokens.mjs';

function evidenceCheckResultForDefinition(evidenceCheckResults, evidenceCheck) {
  return (evidenceCheckResults ?? []).find(
    (result) => result.id === evidenceCheck.id && isBoundEvidenceCheckResult(result, evidenceCheck),
  ) ?? null;
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
    const evidenceCheckResult = evidenceCheckResultForDefinition(evidenceCheckResults, evidenceCheck);
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

export function buildRequiredEvidenceChecks({
  config,
  evidenceCheckPlan,
  evidenceCheckResults,
  evidenceCheckFailure,
  evidenceCheckExecutionSkipped = false,
}) {
  const selectedEvidenceCheckIds = new Set(
    (evidenceCheckPlan.evidenceChecks ?? []).map((evidenceCheck) => evidenceCheck.id),
  );
  return evidenceChecksByIds(config, readRequiredEvidenceCheckIds(config)).map((evidenceCheck) => {
    const plannedEvidenceCheck = (evidenceCheckPlan.evidenceChecks ?? []).find(
      (check) => check.id === evidenceCheck.id,
    );
    const result = plannedEvidenceCheck
      ? evidenceCheckResultForDefinition(evidenceCheckResults, plannedEvidenceCheck)
      : null;
    const selected = selectedEvidenceCheckIds.has(evidenceCheck.id);
    const observed = Boolean(result);
    const failure = plannedEvidenceCheck
      && evidenceCheckFailure?.id === evidenceCheck.id
      && isBoundEvidenceCheckResult(evidenceCheckFailure, plannedEvidenceCheck)
      ? evidenceCheckFailure
      : null;
    const state = !selected
      ? 'missing'
      : evidenceCheckExecutionSkipped
        ? 'skipped'
        : result?.timedOut || failure?.reason === 'timeout'
          ? 'timedout'
          : result
            ? (result.passed ? 'passed' : 'failed')
            : 'missing';
    return {
      id: evidenceCheck.id,
      label: evidenceCheckLabel(evidenceCheck),
      runner: evidenceCheck.runner ?? 'bash',
      selected,
      observed,
      imported: false,
      passed: result ? result.passed : null,
      state,
      ...(failure && !result ? { failure_reason: failure.reason } : {}),
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
