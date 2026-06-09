import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';
import { relativeRepoPath } from '../paths.mjs';
import { SURFACE_TRUST_POLICIES } from './policies.mjs';
import {
  SURFACE_SUPPORTS_AUTHORITY_TRACE,
} from './capabilities.mjs';
import { loadVeritasClaimStore } from '../claims/store.mjs';
import { registerVeritasExtension } from './extension.mjs';
import { loadPluginsFromConfig, collectPluginEvidence } from '../plugins/loader.mjs';
import {
  buildReadinessAuthorityTrace,
  collectAffectedSurfaceEvidence,
  collectEvidenceCheckEvidence,
  collectEvidenceInventoryEvidence,
  collectExternalToolEvidence,
  collectPolicyResultEvidence,
  collectReadinessCoverageEvidence,
  collectReadinessVerdictEvidence,
  surfacePolicyImpact,
} from './evidence-projection.mjs';
import {
  readinessIntegrityScope,
  readinessSurfaceStatus,
  readinessVerdict,
} from './readiness.mjs';
import {
  collectGovernanceEvidence,
  collectRecommendationEvidence,
  buildGovernanceArtifactClaims,
} from './governance-projection.mjs';
import {
  policyResultClaimId,
  surfaceClaimId,
  surfaceEvidence,
  surfaceEvent,
  surfaceSafeId,
} from './primitives.mjs';

export {
  isoDateTimeOrUndefined,
  surfaceEvidenceInventoryImpact,
  surfaceEvidenceInventoryStatus,
  surfaceEvidenceInventoryStrength,
  surfaceEvidenceInventorySummary,
  surfaceEvidenceInventoryTransparencyGapHints,
  surfaceExternalToolStatus,
  surfacePolicyImpact,
  surfacePolicyResultStatus,
} from './evidence-projection.mjs';

export {
  buildGovernanceArtifactClaims,
  policyResultClaimId,
  surfaceClaimId,
  surfaceEvidence,
  surfaceEvent,
  surfaceSafeId,
};

export async function buildSurfaceTrustInput(record, { rootDir = process.cwd(), repoMapConfig = null } = {}) {
  registerVeritasExtension();
  if (repoMapConfig) await loadPluginsFromConfig(repoMapConfig, rootDir);
  const claimStore = loadVeritasClaimStore(rootDir);
  const effectiveClaimStore = withProjectedPolicyClaims(claimStore, record);
  const assembler = createSurfaceTrustInputAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 2,
  });
  const { claims, evidence, events, claimGroups, authorityTrace } = assembler;

  for (const definition of effectiveClaimStore.claims) {
    claims.push(claimDefToClaim(definition, record));
  }

  collectAffectedSurfaceEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceCheckEvidence(record, effectiveClaimStore, evidence, events);
  collectPolicyResultEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceInventoryEvidence(record, effectiveClaimStore, evidence, events);
  collectExternalToolEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessCoverageEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessVerdictEvidence(record, effectiveClaimStore, evidence, events, authorityTrace);
  collectGovernanceEvidence(record, effectiveClaimStore, evidence, events);
  collectRecommendationEvidence(record, effectiveClaimStore, evidence, rootDir);
  const policyClaimGroup = buildRepoStandardsClaimGroup(record, effectiveClaimStore);
  if (policyClaimGroup) claimGroups.push(policyClaimGroup);
  const pluginContext = {
    runId: record.run_id,
    sourceRef: record.source_ref,
    timestamp: record.timestamp,
    rootDir,
  };
  for (const item of collectPluginEvidence(claimStore, pluginContext)) {
    evidence.push(item);
  }

  try {
    return assembler.build(effectiveClaimStore.policies);
  } catch (error) {
    return throwSurfaceTrustInputValidationError({
      error,
      input: error.trustInputDraft,
      record,
      rootDir,
    });
  }
}

function withProjectedPolicyClaims(claimStore, record) {
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
    (claim.metadata?.ruleId === result.rule_id || claim.fieldOrBehavior === result.rule_id || claim.subjectId.endsWith(`:${result.rule_id}`))
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
      authorityTrace: buildReadinessAuthorityTrace(record),
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

function buildRepoStandardsClaimGroup(record, claimStore) {
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

function claimDefToClaim(definition, record) {
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

export function validateSurfaceTrustInputAtBoundary({ input, record, rootDir }) {
  if (process.env.VERITAS_SKIP_SURFACE_VALIDATION === '1') {
    process.stderr.write('WARN: VERITAS_SKIP_SURFACE_VALIDATION=1 — this is intended as a short-lived escape hatch; remove once the underlying fixture is fixed.\n');
    return input;
  }
  try {
    return Surface.validateTrustInput(input);
  } catch (error) {
    return throwSurfaceTrustInputValidationError({ error, input, record, rootDir });
  }
}

export function throwSurfaceTrustInputValidationError({ error, input, record, rootDir }) {
  const failureDir = resolve(rootDir, '.veritas/external/surface-validation-failures');
  mkdirSync(failureDir, { recursive: true });
  const failurePath = resolve(failureDir, `${surfaceSafeId(record.run_id)}.json`);
  writeFileSync(failurePath, `${JSON.stringify(input ?? {}, null, 2)}\n`, 'utf8');
  const validationError = new Error(
    `Surface TrustInput validation failed: ${error.message}. Rejected input: ${relativeRepoPath(rootDir, failurePath)}`,
  );
  validationError.exitCode = 2;
  throw validationError;
}

export function buildSurfaceTrustReportSummary({ input, record }) {
  const report = Surface.buildTrustReport(input, {
    id: `veritas.${surfaceSafeId(record.run_id)}.surface-report`,
    now: new Date(record.timestamp),
  });
  return summarizeSurfaceTrustReport(report);
}

export function buildSurfaceTrustInputWithPublicApi(input) {
  if (typeof Surface.TrustInputBuilder !== 'function') {
    throw new Error('Surface TrustInputBuilder public API is required by Veritas projection.');
  }
  const builder = new Surface.TrustInputBuilder({
    source: input.source,
    schemaVersion: input.schemaVersion,
  });
  for (const claim of input.claims) builder.addClaim(claim);
  for (const policy of input.policies) builder.addPolicy(policy);
  for (const item of input.evidence) builder.addEvidence(item).linkTo(item.claimId);
  for (const event of input.events) builder.addEvent(event);
  for (const link of input.identityLinks ?? []) builder.addIdentityLink(link);
  for (const claimGroup of input.claimGroups ?? []) {
    if (typeof builder.addClaimGroup === 'function') builder.addClaimGroup(claimGroup);
  }
  return builder.build();
}

export function createSurfaceTrustInputAssembler({ source, schemaVersion }) {
  if (typeof Surface.TrustInputBuilder !== 'function') {
    throw new Error('Surface TrustInputBuilder public API is required by Veritas projection.');
  }
  const builder = new Surface.TrustInputBuilder({ source, schemaVersion });
  const draft = {
    schemaVersion,
    source,
    claims: [],
    evidence: [],
    policies: [],
    events: [],
    claimGroups: [],
    authorityTrace: [],
  };
  return {
    claims: {
      push: (...items) => {
        for (const item of items) {
          draft.claims.push(item);
          builder.addClaim(item);
        }
        return items.length;
      },
    },
    evidence: {
      push: (...items) => {
        for (const item of items) {
          const index = draft.evidence.findIndex((existing) => existing.id === item.id);
          if (index >= 0) draft.evidence[index] = item;
          else draft.evidence.push(item);
          builder.addEvidence(item).linkTo(item.claimId);
        }
        return items.length;
      },
    },
    events: {
      push: (...items) => {
        for (const item of items) {
          draft.events.push(item);
          builder.addEvent(item);
        }
        return items.length;
      },
    },
    claimGroups: {
      push: (...items) => {
        for (const item of items) {
          draft.claimGroups.push(item);
          if (typeof builder.addClaimGroup === 'function') builder.addClaimGroup(item);
        }
        return items.length;
      },
    },
    authorityTrace: {
      push: (...items) => {
        draft.authorityTrace.push(...items);
        return items.length;
      },
    },
    build: (policies) => {
      for (const policy of policies) {
        draft.policies.push(policy);
        builder.addPolicy(policy);
      }
      try {
        const input = builder.build();
        if (SURFACE_SUPPORTS_AUTHORITY_TRACE && draft.authorityTrace.length > 0) {
          return Surface.validateTrustInput({
            ...input,
            authorityTrace: [...draft.authorityTrace],
          });
        }
        return input;
      } catch (error) {
        error.trustInputDraft = {
          ...draft,
          claims: [...draft.claims],
          evidence: [...draft.evidence],
          policies: [...draft.policies],
          events: [...draft.events],
          claimGroups: [...draft.claimGroups],
          ...(SURFACE_SUPPORTS_AUTHORITY_TRACE ? { authorityTrace: [...draft.authorityTrace] } : {}),
        };
        throw error;
      }
    },
  };
}

export function summarizeSurfaceTrustReport(report) {
  const transparencyGapsByClaimId = new Map();
  for (const transparencyGap of report.transparencyGaps ?? []) {
    const entries = transparencyGapsByClaimId.get(transparencyGap.claimId) ?? [];
    entries.push({
      id: transparencyGap.id,
      type: transparencyGap.type,
      severity: transparencyGap.severity,
      message: transparencyGap.message,
      policyId: transparencyGap.policyId,
    });
    transparencyGapsByClaimId.set(transparencyGap.claimId, entries);
  }
  return {
    id: report.id,
    generatedAt: report.generatedAt,
    source: report.source,
    summary: report.summary,
    claims: report.claims.map((claim) => ({
      id: claim.id,
      status: claim.status,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      surface: claim.surface,
      claimType: claim.claimType,
      fieldOrBehavior: claim.fieldOrBehavior,
      value: claim.value,
      verificationPolicyId: claim.verificationPolicyId,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      currentIntegrityRef: claim.currentIntegrityRef,
    })),
    transparencyGaps: report.transparencyGaps.map((transparencyGap) => ({
      id: transparencyGap.id,
      claimId: transparencyGap.claimId,
      type: transparencyGap.type,
      severity: transparencyGap.severity,
      message: transparencyGap.message,
      policyId: transparencyGap.policyId,
      createdAt: transparencyGap.createdAt,
      evidenceIds: transparencyGap.evidenceIds,
    })),
    transparencyGapsByClaimId: Object.fromEntries(transparencyGapsByClaimId.entries()),
    claimGroupRollups: report.claimGroupRollups ?? [],
  };
}
