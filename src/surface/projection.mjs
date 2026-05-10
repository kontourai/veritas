import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';
import { relativeRepoPath } from '../paths.mjs';
import { SURFACE_TRUST_POLICIES } from './policies.mjs';

export function buildSurfaceTrustInput(record, { rootDir = process.cwd() } = {}) {
  const assembler = createSurfaceTrustInputAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 2,
  });
  const { claims, evidence, events } = assembler;
  const adapterName = record.adapter?.name ?? 'veritas';
  const proofLaneClaimIds = [];
  const policyClaimIds = [];
  const proofFamilyClaimIds = [];

  for (const node of record.affected_nodes) {
    const id = surfaceClaimId(record.run_id, 'surface', node);
    const evidenceId = `${id}.evidence`;
    claims.push({
      id,
      subjectType: 'repo-surface',
      subjectId: `${adapterName}:${node}`,
      surface: 'veritas.affected-surface',
      claimType: 'veritas-affected-surface',
      fieldOrBehavior: 'affectedNode',
      value: node,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel: 'medium',
      currentIntegrityRef: record.source_ref,
      verificationPolicyId: SURFACE_TRUST_POLICIES.affectedSurface.id,
      confidenceBasis: {
        sourceQuality: 'strong',
        reviewerAuthority: 'system',
        proofStrength: record.selected_proof_lanes.length > 0 ? 'moderate' : 'weak',
        impactLevel: 'medium',
      },
      metadata: {
        resolvedPhase: record.resolved_phase,
        resolvedWorkstream: record.resolved_workstream,
        affectedLanes: record.affected_lanes,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: 'affected_nodes',
      summary: `Veritas marked ${node} as an affected repo surface for ${record.resolved_workstream}.`,
    }));
    events.push(surfaceEvent({
      id: `${id}.verified`,
      claimId: id,
      status: 'verified',
      method: 'affected surface resolution',
      evidenceIds: [evidenceId],
      record,
    }));
  }

  for (const lane of record.selected_proof_lanes) {
    const id = surfaceClaimId(record.run_id, 'proof', lane.id);
    proofLaneClaimIds.push(id);
    const evidenceId = `${id}.evidence`;
    claims.push({
      id,
      subjectType: 'repo-proof-lane',
      subjectId: `${adapterName}:${lane.command}`,
      surface: 'veritas.proof-lanes',
      claimType: 'software-proof',
      fieldOrBehavior: 'selectedProofCommand',
      value: lane.command,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel: 'high',
      currentIntegrityRef: record.source_ref,
      verificationPolicyId: SURFACE_TRUST_POLICIES.proofLane.id,
      confidenceBasis: {
        sourceQuality: 'strong',
        reviewerAuthority: 'system',
        proofStrength: record.baseline_ci_fast_passed === true ? 'strong' : 'weak',
        impactLevel: 'high',
      },
      metadata: {
        proofResolutionSource: record.proof_resolution_source,
        baselineCiFastPassed: record.baseline_ci_fast_passed,
        proofLaneId: lane.id,
        surfaceClaimIds: lane.surface_claim_ids ?? [],
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'test_output',
      method: lane.method,
      record,
      locator: 'selected_proof_lanes',
      summary: lane.summary ?? `Selected proof lane ${lane.id}: ${lane.command}`,
    }));
    if (record.baseline_ci_fast_passed !== null) {
      events.push(surfaceEvent({
        id: `${id}.${record.baseline_ci_fast_passed ? 'verified' : 'rejected'}`,
        claimId: id,
        status: record.baseline_ci_fast_passed ? 'verified' : 'rejected',
        method: lane.command,
        evidenceIds: [evidenceId],
        record,
      }));
    }
  }

  for (const result of record.policy_results) {
    const id = surfaceClaimId(record.run_id, 'policy', result.rule_id);
    policyClaimIds.push(id);
    const evidenceId = `${id}.evidence`;
    const status = surfacePolicyResultStatus(result);
    const impactLevel = surfacePolicyImpact(result);
    claims.push({
      id,
      subjectType: 'veritas-policy-rule',
      subjectId: `${record.policy_pack?.name ?? 'policy-pack'}:${result.rule_id}`,
      surface: 'veritas.policy-results',
      claimType: 'veritas-policy-result',
      fieldOrBehavior: 'policyResult',
      value: {
        ruleId: result.rule_id,
        classification: result.classification,
        stage: result.stage,
        implemented: result.implemented,
        passed: result.passed,
      },
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel,
      currentIntegrityRef: record.source_ref,
      verificationPolicyId: SURFACE_TRUST_POLICIES.policyResult.id,
      confidenceBasis: {
        sourceQuality: 'strong',
        reviewerAuthority: 'system',
        proofStrength: result.passed === true ? 'strong' : 'weak',
        impactLevel,
        conflictCount: result.passed === false ? 1 : 0,
      },
      metadata: {
        message: result.message,
        owner: result.owner,
        findings: result.findings,
        policyPack: record.policy_pack,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'policy_rule',
      method: 'validation',
      record,
      locator: `policy_results.${result.rule_id}`,
      summary: result.summary,
      metadata: {
        stage: result.stage,
        classification: result.classification,
        implemented: result.implemented,
        passed: result.passed,
        faultLineHints: result.passed === false ? [{
          type: 'policy_violation',
          severity: impactLevel,
          message: result.message,
        }] : [],
      },
    }));
    if (status !== 'proposed') {
      events.push(surfaceEvent({
        id: `${id}.${status}`,
        claimId: id,
        status,
        method: 'policy pack evaluation',
        evidenceIds: [evidenceId],
        record,
        notes: result.message,
      }));
    }
  }

  for (const family of record.proof_family_results ?? []) {
    const id = surfaceClaimId(record.run_id, 'proof-family', family.id);
    proofFamilyClaimIds.push(id);
    const evidenceId = `${id}.evidence`;
    const status = surfaceProofFamilyStatus(family);
    const impactLevel = surfaceProofFamilyImpact(family);
    claims.push({
      id,
      subjectType: 'repo-proof-family',
      subjectId: `${adapterName}:${family.lane_id}:${family.id}`,
      surface: 'veritas.proof-families',
      claimType: 'veritas-proof-family',
      fieldOrBehavior: 'proofFamilyDisposition',
      value: {
        id: family.id,
        destination: family.destination,
        disposition: family.disposition,
      },
      status: status === 'verified' ? undefined : status,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel,
      currentIntegrityRef: record.source_ref,
      derivedFrom: proofLaneClaimIds.length > 0 ? [...proofLaneClaimIds] : undefined,
      verificationPolicyId: SURFACE_TRUST_POLICIES.proofFamily.id,
      confidenceBasis: {
        sourceQuality: family.recent_catch_evidence === 'unknown' || family.evidence_basis === 'unknown' ? 'weak' : 'moderate',
        reviewerAuthority: family.owner ? 'operator' : 'none',
        proofStrength: surfaceProofFamilyStrength(family),
        conflictCount: family.false_positive_risk === 'high' || family.false_positive_risk === 'unknown' ? 1 : 0,
        impactLevel,
      },
      metadata: {
        laneId: family.lane_id,
        sourceProofLaneId: family.source_proof_lane_id,
        manifestPath: family.manifest_path,
        owner: family.owner,
        blockingStatus: family.blocking_status,
        verificationWeight: family.verification_weight,
        selected: family.selected,
        regressionSeverity: family.regression_severity,
        falsePositiveRisk: family.false_positive_risk,
        replacementTestAvailable: family.replacement_test_available,
        reviewTrigger: family.review_trigger,
        lastReviewed: family.last_reviewed,
        evidenceBasis: family.evidence_basis,
        freshnessStatus: family.freshness_status,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'policy_rule',
      method: 'validation',
      record,
      locator: family.manifest_path,
      summary: surfaceProofFamilySummary(family),
      metadata: {
        familyId: family.id,
        laneId: family.lane_id,
        owner: family.owner,
        selected: family.selected,
        recentCatchEvidence: family.recent_catch_evidence,
        evidenceBasis: family.evidence_basis,
        freshnessStatus: family.freshness_status,
        faultLineHints: surfaceProofFamilyFaultLineHints(family),
      },
    }));
    events.push(surfaceEvent({
      id: `${id}.${status}`,
      claimId: id,
      status,
      method: 'proof family inventory',
      evidenceIds: [evidenceId],
      record,
      verifiedAt: isoDateTimeOrUndefined(family.last_reviewed),
      notes: family.rationale,
    }));
  }

  for (const result of record.external_tool_results ?? []) {
    const id = surfaceClaimId(record.run_id, 'external-tool', `${result.tool}-${result.proof_lane_id}`);
    const evidenceId = `${id}.evidence`;
    const status = surfaceExternalToolStatus(result);
    const impactLevel = result.blocking && status !== 'verified' ? 'high' : 'medium';
    claims.push({
      id,
      subjectType: 'external-tool-result',
      subjectId: `${adapterName}:${result.tool}:${result.proof_lane_id}`,
      surface: 'veritas.external-tool-results',
      claimType: 'veritas-external-tool-result',
      fieldOrBehavior: 'externalToolVerdict',
      value: {
        tool: result.tool,
        format: result.format,
        verdict: result.verdict,
        blocking: result.blocking,
      },
      status,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel,
      currentIntegrityRef: record.source_ref,
      derivedFrom: proofLaneClaimIds.length > 0 ? [...proofLaneClaimIds] : undefined,
      verificationPolicyId: SURFACE_TRUST_POLICIES.externalToolResult.id,
      confidenceBasis: {
        sourceQuality: result.verdict === 'missing' || result.verdict === 'unknown' ? 'weak' : 'moderate',
        reviewerAuthority: 'tool',
        proofStrength: result.verdict === 'pass' ? 'strong' : 'weak',
        conflictCount: status === 'verified' ? 0 : 1,
        impactLevel,
      },
      metadata: {
        proofLaneId: result.proof_lane_id,
        command: result.command,
        artifactPath: result.artifact_path,
        summary: result.summary,
        actions: result.actions,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'test_output',
      method: 'auditability',
      record,
      locator: result.artifact_path,
      summary: `${result.tool} reported ${result.verdict} for proof lane ${result.proof_lane_id}.`,
      metadata: {
        externalToolResult: result,
        faultLineHints: status === 'verified' ? [] : [{
          type: result.blocking ? 'policy_violation' : 'provenance_gap',
          severity: impactLevel,
          message: `${result.tool} verdict is ${result.verdict}.`,
        }],
      },
    }));
    events.push(surfaceEvent({
      id: `${id}.${status}`,
      claimId: id,
      status,
      method: result.command,
      evidenceIds: [evidenceId],
      record,
      notes: `${result.tool} ${result.format} verdict: ${result.verdict}`,
    }));
  }

  if (record.verification_budget) {
    const id = surfaceClaimId(record.run_id, 'budget', 'verification');
    const evidenceId = `${id}.evidence`;
    const status = record.verification_budget.stale_or_unknown_family_ids.length > 0 ? 'disputed' : 'verified';
    const impactLevel = record.verification_budget.stale_or_unknown_family_ids.length > 0 ? 'high' : 'medium';
    claims.push({
      id,
      subjectType: 'repo-verification-budget',
      subjectId: `${adapterName}:verification-budget`,
      surface: 'veritas.verification-budget',
      claimType: 'veritas-verification-budget',
      fieldOrBehavior: 'verificationBudget',
      value: {
        proofFamilyCount: record.verification_budget.proof_family_count,
        selectedProofLaneCount: record.verification_budget.selected_proof_lane_count,
        staleOrUnknownFamilyIds: record.verification_budget.stale_or_unknown_family_ids,
      },
      status,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel,
      currentIntegrityRef: record.source_ref,
      verificationPolicyId: SURFACE_TRUST_POLICIES.verificationBudget.id,
      derivedFrom: proofFamilyClaimIds.length > 0 ? proofFamilyClaimIds : policyClaimIds,
      confidenceBasis: {
        sourceQuality: 'strong',
        reviewerAuthority: 'system',
        proofStrength: record.verification_budget.stale_or_unknown_family_ids.length > 0 ? 'weak' : 'moderate',
        conflictCount: record.verification_budget.stale_or_unknown_family_ids.length,
        impactLevel,
      },
      metadata: {
        verificationBudget: record.verification_budget,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: 'verification_budget',
      summary: record.verification_budget.recommendation,
      metadata: {
        verificationBudget: record.verification_budget,
        faultLineHints: record.verification_budget.stale_or_unknown_family_ids.length > 0 ? [{
          type: 'freshness_breach',
          severity: 'high',
          message: record.verification_budget.recommendation,
        }] : [],
      },
    }));
    events.push(surfaceEvent({
      id: `${id}.${status}`,
      claimId: id,
      status,
      method: 'verification budget',
      evidenceIds: [evidenceId],
      record,
      notes: record.verification_budget.recommendation,
    }));
  }

  for (const proposal of readOpenProposalSummaries(rootDir)) {
    const id = proposal.surface?.claimId ?? surfaceClaimId(record.run_id, 'proposal', proposal.id);
    const evidenceId = `${id}.evidence`;
    claims.push({
      id,
      subjectType: 'veritas-proposal',
      subjectId: proposal.id,
      surface: 'veritas.proposals',
      claimType: 'veritas-proposal',
      fieldOrBehavior: proposal.type,
      value: {
        target: proposal.target,
        rationale: proposal.rationale,
      },
      status: 'proposed',
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      impactLevel: 'medium',
      verificationPolicyId: SURFACE_TRUST_POLICIES.proposal.id,
      confidenceBasis: {
        sourceQuality: 'moderate',
        reviewerAuthority: 'system',
        proofStrength: 'weak',
        impactLevel: 'medium',
      },
      metadata: {
        proposalId: proposal.id,
        evidenceRunIds: proposal.evidenceRunIds,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: `.veritas/proposals/${proposal.id}.proposal.json`,
      summary: proposal.rationale,
      metadata: {
        proposalType: proposal.type,
        proposalTarget: proposal.target,
      },
    }));
  }

  try {
    return assembler.build(Object.values(SURFACE_TRUST_POLICIES));
  } catch (error) {
    return throwSurfaceTrustInputValidationError({
      error,
      input: error.trustInputDraft,
      record,
      rootDir,
    });
  }
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
    build: (policies) => {
      for (const policy of policies) {
        draft.policies.push(policy);
        builder.addPolicy(policy);
      }
      try {
        return builder.build();
      } catch (error) {
        error.trustInputDraft = {
          ...draft,
          claims: [...draft.claims],
          evidence: [...draft.evidence],
          policies: [...draft.policies],
          events: [...draft.events],
        };
        throw error;
      }
    },
  };
}

export function summarizeSurfaceTrustReport(report) {
  const faultLinesByClaimId = new Map();
  for (const faultLine of report.faultLines ?? []) {
    const entries = faultLinesByClaimId.get(faultLine.claimId) ?? [];
    entries.push({
      id: faultLine.id,
      type: faultLine.type,
      severity: faultLine.severity,
      message: faultLine.message,
      policyId: faultLine.policyId,
    });
    faultLinesByClaimId.set(faultLine.claimId, entries);
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
    faultLines: report.faultLines.map((faultLine) => ({
      id: faultLine.id,
      claimId: faultLine.claimId,
      type: faultLine.type,
      severity: faultLine.severity,
      message: faultLine.message,
      policyId: faultLine.policyId,
      createdAt: faultLine.createdAt,
      evidenceIds: faultLine.evidenceIds,
    })),
    faultLinesByClaimId: Object.fromEntries(faultLinesByClaimId.entries()),
  };
}

export function surfaceEvidence({ id, claimId, type, method, record, locator, summary, metadata = {} }) {
  return {
    id,
    claimId,
    evidenceType: type,
    method,
    sourceRef: record.run_id,
    sourceLocator: locator,
    excerptOrSummary: summary,
    observedAt: record.timestamp,
    collectedBy: 'veritas',
    integrityRef: record.source_ref,
    metadata: {
      sourceKind: record.source_kind,
      sourceScope: record.source_scope,
      files: record.files ?? [],
      unresolvedFiles: record.unresolved_files ?? [],
      ...metadata,
    },
  };
}

export function surfaceEvent({ id, claimId, status, method, evidenceIds, record, notes, verifiedAt }) {
  return {
    id,
    claimId,
    status,
    actor: 'veritas',
    method,
    evidenceIds,
    createdAt: record.timestamp,
    verifiedAt: status === 'verified' ? (verifiedAt ?? record.timestamp) : undefined,
    notes,
  };
}

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

export function surfaceProofFamilyStatus(family) {
  if (family.freshness_status === 'stale' || family.freshness_status === 'review-needed') return 'stale';
  if (family.freshness_status === 'retiring' || family.disposition === 'retire') return 'superseded';
  if (family.blocking_status === 'rejected') return 'rejected';
  if (family.blocking_status === 'disputed') return 'disputed';
  if (family.disposition === 'required' && family.recent_catch_evidence !== 'unknown') return 'verified';
  return 'proposed';
}

export function surfaceProofFamilyImpact(family) {
  if (family.regression_severity === 'critical') return 'critical';
  if (family.regression_severity === 'high' || family.verification_weight === 'blocking' || family.blocking_status === 'required') return 'high';
  if (family.regression_severity === 'low' || family.verification_weight === 'informational') return 'low';
  return 'medium';
}

export function surfaceProofFamilyStrength(family) {
  if (family.recent_catch_evidence === 'unknown' || family.evidence_basis === 'unknown') return 'weak';
  if (family.disposition === 'required' && family.freshness_status === 'current') return 'strong';
  return 'moderate';
}

export function surfaceProofFamilySummary(family) {
  const rationale = family.rationale ? ` ${family.rationale}` : '';
  return `Proof family ${family.id} is ${family.disposition} / ${family.blocking_status}; freshness ${family.freshness_status}; evidence ${family.evidence_basis}.${rationale}`;
}

export function surfaceExternalToolStatus(result) {
  if (result.verdict === 'pass') return 'verified';
  if (result.blocking && (result.verdict === 'fail' || result.verdict === 'missing')) return 'rejected';
  if (result.verdict === 'fail' || result.verdict === 'warn' || result.verdict === 'missing') return 'disputed';
  return 'proposed';
}

export function surfaceProofFamilyFaultLineHints(family) {
  const hints = [];
  if (family.freshness_status === 'stale' || family.freshness_status === 'review-needed' || family.freshness_status === 'retiring') {
    hints.push({
      type: 'freshness_breach',
      severity: surfaceProofFamilyImpact(family),
      message: `Proof family ${family.id} freshness is ${family.freshness_status}.`,
    });
  }
  if (family.recent_catch_evidence === 'unknown' || family.evidence_basis === 'unknown') {
    hints.push({
      type: 'provenance_gap',
      severity: surfaceProofFamilyImpact(family),
      message: `Proof family ${family.id} has weak or unknown catch evidence.`,
    });
  }
  return hints;
}

export function isoDateTimeOrUndefined(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return value;
  return undefined;
}

export function surfaceClaimId(runId, group, value) {
  return `veritas.${surfaceSafeId(runId)}.${group}.${surfaceSafeId(value)}`;
}

export function surfaceSafeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function readOpenProposalSummaries(rootDir) {
  const dir = resolve(rootDir, '.veritas/proposals');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.proposal.json'))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((proposal) => proposal?.status === 'proposed');
}
