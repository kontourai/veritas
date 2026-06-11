export function surfacePolicyResultStatus(result) {
  if (result.passed === true) return 'verified';
  if (result.passed === false && result.stage === 'block') return 'rejected';
  if (result.passed === false) return 'disputed';
  return 'proposed';
}

export function surfacePolicyImpact(result) {
  if (result.stage === 'block' || result.classification === 'hard-invariant') return 'high';
  if (result.stage === 'warn') return 'medium';
  return 'low';
}

export function surfaceEvidenceInventoryStatus(suite) {
  if (suite.freshness_status === 'stale' || suite.freshness_status === 'review-needed') return 'stale';
  if (suite.freshness_status === 'retiring' || suite.disposition === 'retire') return 'superseded';
  if (suite.blocking_status === 'rejected') return 'rejected';
  if (suite.blocking_status === 'disputed') return 'disputed';
  if (suite.disposition === 'required' && suite.recent_catch_evidence !== 'unknown') return 'verified';
  return 'proposed';
}

export function surfaceEvidenceInventoryImpact(suite) {
  if (suite.regression_severity === 'critical') return 'critical';
  if (suite.regression_severity === 'high' || suite.verification_weight === 'blocking' || suite.blocking_status === 'required') return 'high';
  if (suite.regression_severity === 'low' || suite.verification_weight === 'informational') return 'low';
  return 'medium';
}

export function surfaceEvidenceInventoryStrength(suite) {
  if (suite.recent_catch_evidence === 'unknown' || suite.evidence_basis === 'unknown') return 'weak';
  if (suite.disposition === 'required' && suite.freshness_status === 'current') return 'strong';
  return 'moderate';
}

export function surfaceEvidenceInventorySummary(suite) {
  const rationale = suite.rationale ? ` ${suite.rationale}` : '';
  return `Evidence inventory ${suite.id} is ${suite.disposition} / ${suite.blocking_status}; freshness ${suite.freshness_status}; evidence ${suite.evidence_basis}.${rationale}`;
}

export function surfaceExternalToolStatus(result) {
  if (result.verdict === 'pass') return 'verified';
  if (result.blocking && (result.verdict === 'fail' || result.verdict === 'missing')) return 'rejected';
  if (result.verdict === 'fail' || result.verdict === 'warn' || result.verdict === 'missing') return 'disputed';
  return 'proposed';
}

export function surfaceEvidenceInventoryTransparencyGapHints(suite) {
  const hints = [];
  if (suite.freshness_status === 'stale' || suite.freshness_status === 'review-needed' || suite.freshness_status === 'retiring') {
    hints.push({
      type: 'freshness_breach',
      severity: surfaceEvidenceInventoryImpact(suite),
      message: `Evidence inventory ${suite.id} freshness is ${suite.freshness_status}.`,
    });
  }
  if (suite.recent_catch_evidence === 'unknown' || suite.evidence_basis === 'unknown') {
    hints.push({
      type: 'provenance_gap',
      severity: surfaceEvidenceInventoryImpact(suite),
      message: `Evidence inventory ${suite.id} has weak or unknown catch evidence.`,
    });
  }
  return hints;
}

export function isoDateTimeOrUndefined(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return value;
  return undefined;
}
