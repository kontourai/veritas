export function readinessVerdict(record) {
  if (record.promotion_allowed === true) return 'ready';
  if (readinessHasBlockingFailure(record)) return 'not-ready';
  return 'needs-review';
}

export function readinessSurfaceStatus(record) {
  if (record.promotion_allowed === true) return 'verified';
  if (readinessHasBlockingFailure(record)) return 'rejected';
  return 'disputed';
}

export function readinessHasBlockingFailure(record) {
  if (record.uncovered_path_result === 'fail') return true;
  if ((record.policy_results ?? []).some((result) => result.passed === false && result.stage === 'block')) return true;
  if ((record.selected_evidence_checks ?? []).some((check) => check.evidence_check_result?.passed === false)) return true;
  if ((record.external_tool_results ?? []).some((result) => result.blocking !== false && ['fail', 'missing'].includes(result.verdict))) return true;
  return false;
}

export function readinessVerdictSummary(record) {
  const verdict = readinessVerdict(record);
  if (verdict === 'ready') return 'Veritas readiness verdict is ready for the evaluated repository change.';
  if (verdict === 'not-ready') return 'Veritas readiness verdict is not ready because blocking requirements or evidence failed.';
  return 'Veritas readiness verdict needs review because readiness could not be fully verified.';
}

export function readinessPolicyResultSummary(record) {
  const results = record.policy_results ?? [];
  return {
    total: results.length,
    failedBlocking: results.filter((result) => result.passed === false && result.stage === 'block').map((result) => result.rule_id),
    warnings: results.filter((result) => result.passed === false && result.stage !== 'block').map((result) => result.rule_id),
  };
}

export function readinessEvidenceCheckSummary(record) {
  const checks = record.selected_evidence_checks ?? [];
  return {
    selected: checks.map((check) => check.id),
    failed: checks.filter((check) => check.evidence_check_result?.passed === false).map((check) => check.id),
    baselineCiFastPassed: record.baseline_ci_fast_passed,
  };
}

export function readinessIntegrityScope(record) {
  return {
    sourceRef: record.integrity?.sourceRef ?? record.source_ref,
    sourceKind: record.integrity?.sourceKind ?? record.source_kind,
    sourceScope: record.integrity?.sourceScope ?? record.source_scope ?? [],
    fileRefs: record.integrity?.fileRefs ?? [],
    configRefs: record.integrity?.configRefs ?? {},
  };
}

export function readinessTransparencyGapHints(record) {
  const hints = [];
  for (const ruleId of readinessPolicyResultSummary(record).failedBlocking) {
    hints.push({
      type: 'policy_violation',
      severity: 'high',
      message: `Blocking readiness requirement failed: ${ruleId}.`,
      blocking: true,
    });
  }
  if (record.uncovered_path_result === 'fail') {
    hints.push({
      type: 'policy_violation',
      severity: 'high',
      message: 'Changed files were outside configured work areas and uncovered path policy is fail.',
      blocking: true,
    });
  }
  if (!record.governance_state || record.governance_state.state === 'missing') {
    hints.push({
      type: 'provenance_gap',
      severity: 'medium',
      message: 'No active governance attestation was available; Veritas used producer authority fallback.',
    });
  }
  return hints;
}
