import { SURFACE_TRUST_POLICIES } from './policies.mjs';
import { surfacePolicyImpact } from './evidence-projection.mjs';
import {
  readinessIntegrityScope,
  readinessSurfaceStatus,
  readinessVerdict,
} from './readiness.mjs';
import {
  policyResultClaimId,
  surfaceClaimId,
  surfaceSafeId,
} from './primitives.mjs';

export function withProjectedPolicyClaims(claimStore, record) {
  const claims = [...claimStore.claims];
  const policies = [...claimStore.policies];
  const existingIds = new Set(claims.map((claim) => claim.id));
  const existingPolicyIds = new Set(policies.map((policy) => policy.id));
  for (const result of record.policy_results ?? []) {
    const id = policyResultClaimId(record, result.rule_id);
    if (existingIds.has(id)) continue;
    const existing = findPolicyResultClaim(claims, result);
    if (existing) continue;
    claims.push({
      id,
      surface: 'veritas.policy-results',
      claimType: 'veritas-policy-result',
      fieldOrBehavior: result.rule_id,
      subjectType: 'policy-rule',
      subjectId: `${record.repo_map?.name ?? 'repo-map'}:${record.repo_standards?.name ?? 'repo-standards'}:${result.rule_id}`,
      impactLevel: surfacePolicyImpact(result),
      verificationPolicyId: SURFACE_TRUST_POLICIES.policyResult.id,
      metadata: {
        projected: true,
        ruleId: result.rule_id,
        stage: result.stage,
        classification: result.classification,
        repoStandards: record.repo_standards?.name,
        repoMap: record.repo_map?.name,
      },
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
    });
    existingIds.add(id);
  }
  if ((record.policy_results ?? []).length > 0 && !existingPolicyIds.has(SURFACE_TRUST_POLICIES.policyResult.id)) {
    policies.push(SURFACE_TRUST_POLICIES.policyResult);
    existingPolicyIds.add(SURFACE_TRUST_POLICIES.policyResult.id);
  }
  const readinessPolicyResultClaims = (record.policy_results ?? [])
    .filter((result) => result.stage === 'block')
    .map((result) => ({ result, claim: findPolicyResultClaim(claims, result) }))
    .filter((item) => item.claim);
  const readinessClaim = buildReadinessVerdictClaim(record, readinessPolicyResultClaims);
  if (!existingIds.has(readinessClaim.id)) {
    claims.push(readinessClaim);
    existingIds.add(readinessClaim.id);
  }
  if (!existingPolicyIds.has(SURFACE_TRUST_POLICIES.readinessVerdict.id)) {
    policies.push(SURFACE_TRUST_POLICIES.readinessVerdict);
    existingPolicyIds.add(SURFACE_TRUST_POLICIES.readinessVerdict.id);
  }
  return { ...claimStore, claims, policies };
}

function findPolicyResultClaim(claims, result) {
  return claims.find((claim) =>
    claim.claimType === 'veritas-policy-result' &&
    (
      claim.metadata?.ruleId === result.rule_id ||
      claim.fieldOrBehavior === result.rule_id ||
      claim.subjectId.endsWith(`:${result.rule_id}`)
    )
  );
}

function buildReadinessVerdictClaim(record, policyResultClaimItems = []) {
  const verdict = readinessVerdict(record);
  const derivationEdges = readinessDerivationEdges(policyResultClaimItems);
  const derivedRequirementClaimIds = derivationEdges.map((edge) => edge.inputClaimId);
  return {
    id: surfaceClaimId(record.run_id, 'readiness-verdict', record.source_ref ?? 'source'),
    surface: 'veritas.readiness',
    claimType: 'software-readiness-verdict',
    fieldOrBehavior: 'mergeReadiness',
    subjectType: 'repository-change',
    subjectId: readinessSubjectId(record),
    value: {
      verdict,
      promotionAllowed: record.promotion_allowed,
      uncoveredPathResult: record.uncovered_path_result,
      sourceRef: record.integrity?.sourceRef ?? record.source_ref,
    },
    status: readinessSurfaceStatus(record),
    impactLevel: 'high',
    verificationPolicyId: SURFACE_TRUST_POLICIES.readinessVerdict.id,
    ...(derivedRequirementClaimIds.length > 0 ? { derivedFrom: derivedRequirementClaimIds } : {}),
    ...(derivationEdges.length > 0 ? { derivationEdges } : {}),
    currentIntegrityRef: record.integrity?.sourceRef ?? record.source_ref,
    createdAt: record.timestamp,
    updatedAt: record.timestamp,
    metadata: {
      producer: 'veritas',
      source: 'readiness',
      sourceRef: record.source_ref,
      sourceKind: record.source_kind,
      sourceScope: record.source_scope,
      policyCoverage: {
        policyResultCount: record.policy_results?.length ?? 0,
        derivedRequirementClaimIds,
        selectedEvidenceCheckCount: record.selected_evidence_checks?.length ?? 0,
        readinessCoveragePresent: Boolean(record.readiness_coverage),
      },
      integrity: readinessIntegrityScope(record),
    },
  };
}

function readinessDerivationEdges(policyResultClaimItems) {
  return policyResultClaimItems.map(({ result, claim }) => ({
    inputClaimId: claim.id,
    method: 'rule-application',
    role: 'blocking-requirement',
    supportStrength: 'strong',
    rationale: readinessRequirementRationale(result),
  }));
}

function readinessRequirementRationale(result) {
  const outcome = result.passed === true ? 'passed' : result.passed === false ? 'failed' : 'needs review';
  return `Veritas merge readiness applies the blocking requirement "${result.rule_id}", which ${outcome} during requirements evaluation.`;
}

function readinessSubjectId(record) {
  const producer = record.adapter?.name ?? record.repo_standards?.name ?? 'veritas';
  return `${surfaceSafeId(producer)}:${surfaceSafeId(record.integrity?.sourceRef ?? record.source_ref ?? record.run_id)}`;
}

export function buildRepoStandardsClaimGroup(record, claimStore) {
  const results = record.policy_results ?? [];
  if (results.length === 0) return null;
  const claims = claimsByType(claimStore, 'veritas-policy-result');
  const requirements = results.map((result) => {
    const claim = claims.find((item) =>
      item.metadata?.ruleId === result.rule_id ||
      item.fieldOrBehavior === result.rule_id ||
      item.subjectId.endsWith(`:${result.rule_id}`)
    );
    if (!claim) return null;
    return {
      id: `veritas.requirement.${surfaceSafeId(result.rule_id)}`,
      title: result.rule_id,
      claimIds: [claim.id],
      required: result.stage === 'block',
      severity: surfacePolicyImpact(result),
      validationStrategy: {
        requiredEvidence: ['policy_rule'],
        requiredMethods: ['validation'],
        acceptanceCriteria: ['requirements evaluation'],
        reviewAuthority: 'veritas requirements',
        metadata: {
          ruleId: result.rule_id,
          stage: result.stage,
          classification: result.classification,
        },
      },
      metadata: {
        implemented: result.implemented,
        stage: result.stage,
        classification: result.classification,
      },
    };
  }).filter(Boolean);
  if (requirements.length === 0) return null;
  const repoStandardsId = surfaceSafeId(record.repo_standards?.name ?? 'repo-standards');
  return {
    id: `veritas.requirements.${repoStandardsId}`,
    title: record.repo_standards?.name ?? 'Veritas requirements',
    kind: 'requirement-set',
    description: 'Veritas requirements projected as Surface trust claims.',
    claimIds: requirements.flatMap((requirement) => requirement.claimIds),
    requirements,
    rollupPolicy: {
      mode: 'all-required',
      requiredRequirementIds: requirements.filter((requirement) => requirement.required).map((requirement) => requirement.id),
      optionalRequirementIds: requirements.filter((requirement) => !requirement.required).map((requirement) => requirement.id),
    },
    metadata: {
      producer: 'veritas',
      repoStandards: record.repo_standards,
      repoMap: record.repo_map,
    },
  };
}

export function claimDefToClaim(definition, record) {
  return {
    ...definition,
    value: definition.value ?? definition.metadata?.value ?? defaultClaimValue(definition),
    currentIntegrityRef: record.integrity?.sourceRef ?? record.source_ref,
    updatedAt: record.timestamp ?? definition.updatedAt,
  };
}

function defaultClaimValue(definition) {
  if (definition.claimType === 'software-evidence-check') return 'all checks pass';
  return definition.fieldOrBehavior;
}

function claimsByType(claimStore, claimType) {
  return claimStore.claims.filter((claim) => claim.claimType === claimType);
}
