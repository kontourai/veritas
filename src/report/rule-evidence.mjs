import { isBoundEvidenceCheckResult } from '../evidence/execution-tokens.mjs';

export function bindRuleEvidenceResults({ policyResults, evidenceCheckPlan, evidenceCheckResults }) {
  const bindings = evidenceCheckPlan.ruleEvidenceBindings ?? [];
  if (bindings.length === 0) return policyResults;
  for (const binding of bindings) {
    if (!policyResults.some((result) => result.rule_id === binding.ruleId)) {
      throw new Error(`Rule evidence binding has no policy result: ${binding.ruleId}`);
    }
  }
  const bindingByRule = new Map(bindings.map((binding) => [binding.ruleId, binding]));
  return policyResults.map((policyResult) => {
    const binding = bindingByRule.get(policyResult.rule_id);
    if (!binding) return policyResult;
    const failures = binding.evidenceCheckIds.flatMap((id) => {
      const definition = evidenceCheckPlan.evidenceChecks.find((check) => check.id === id);
      const result = definition && (evidenceCheckResults ?? []).find(
        (candidate) => candidate.id === id && isBoundEvidenceCheckResult(candidate, definition),
      );
      if (result?.passed === true) return [];
      return [{
        kind: 'rule-evidence-check-not-verified',
        artifact: binding.files[0],
        required: id,
        diagnostic: result ? 'failed' : 'missing',
      }];
    });
    if (failures.length === 0) return policyResult;
    return {
      ...policyResult,
      passed: false,
      summary: `${policyResult.summary} Rule-linked evidence is not verified: ${failures.map((finding) => `${finding.required} (${finding.diagnostic})`).join(', ')}.`,
      findings: [...(policyResult.findings ?? []), ...failures],
    };
  });
}
