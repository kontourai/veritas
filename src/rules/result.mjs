export function buildRuleResult(rule, exceptions = {}) {
  const enforcement =
    rule.enforcement ?? (rule.classification === 'hard-invariant' ? 'deny' : 'advisory');
  return {
    rule_id: rule.id,
    classification: rule.classification,
    enforcementLevel: rule.enforcementLevel,
    enforcement,
    message: rule.message,
    owner: rule.owner ?? null,
    rollback_switch: rule.rollback_switch ?? null,
    implemented: false,
    passed: null,
    status: 'info',
    summary: `Rule ${rule.id} is metadata-only in the current product core.`,
    findings: [],
    ...exceptions,
  };
}
