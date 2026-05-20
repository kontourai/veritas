import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';
import { relativeRepoPath } from '../paths.mjs';
import { SURFACE_TRUST_POLICIES } from './policies.mjs';
import { loadVeritasClaimStore } from '../claims/store.mjs';
import { registerVeritasExtension } from './extension.mjs';
import { loadPluginsFromConfig, collectPluginEvidence } from '../plugins/loader.mjs';

const SURFACE_SUPPORTS_EVIDENCE_EVALUATION = typeof Surface.loadClaimStore === 'function';

export async function buildSurfaceTrustInput(record, { rootDir = process.cwd(), adapterConfig = null } = {}) {
  registerVeritasExtension();
  if (adapterConfig) await loadPluginsFromConfig(adapterConfig, rootDir);
  const claimStore = loadVeritasClaimStore(rootDir);
  const effectiveClaimStore = withProjectedPolicyClaims(claimStore, record);
  const assembler = createSurfaceTrustInputAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 2,
  });
  const { claims, evidence, events, collections } = assembler;

  for (const definition of effectiveClaimStore.claims) {
    claims.push(claimDefToClaim(definition, record));
  }

  collectAffectedSurfaceEvidence(record, effectiveClaimStore, evidence, events);
  collectProofEvidence(record, effectiveClaimStore, evidence, events);
  collectPolicyResultEvidence(record, effectiveClaimStore, evidence, events);
  collectProofSuiteEvidence(record, effectiveClaimStore, evidence, events);
  collectExternalToolEvidence(record, effectiveClaimStore, evidence, events);
  collectVerificationBudgetEvidence(record, effectiveClaimStore, evidence, events);
  collectGovernanceEvidence(record, effectiveClaimStore, evidence, events);
  collectProposalEvidence(record, effectiveClaimStore, evidence, rootDir);
  const policyCollection = buildPolicyPackCollection(record, effectiveClaimStore);
  if (policyCollection) collections.push(policyCollection);
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
    const existing = claims.find((claim) =>
      claim.claimType === 'veritas-policy-result' &&
      (claim.metadata?.ruleId === result.rule_id || claim.fieldOrBehavior === result.rule_id || claim.subjectId.endsWith(`:${result.rule_id}`))
    );
    if (existing) continue;
    claims.push({
      id,
      surface: 'veritas.policy-results',
      claimType: 'veritas-policy-result',
      fieldOrBehavior: result.rule_id,
      subjectType: 'policy-rule',
      subjectId: `${record.adapter?.name ?? 'adapter'}:${record.policy_pack?.name ?? 'policy-pack'}:${result.rule_id}`,
      impactLevel: surfacePolicyImpact(result),
      verificationPolicyId: SURFACE_TRUST_POLICIES.policyResult.id,
      metadata: {
        projected: true,
        ruleId: result.rule_id,
        stage: result.stage,
        classification: result.classification,
        policyPack: record.policy_pack?.name,
        adapter: record.adapter?.name,
      },
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
    });
    existingIds.add(id);
  }
  if ((record.policy_results ?? []).length > 0 && !existingPolicyIds.has(SURFACE_TRUST_POLICIES.policyResult.id)) {
    policies.push(SURFACE_TRUST_POLICIES.policyResult);
  }
  return { ...claimStore, claims, policies };
}

function buildPolicyPackCollection(record, claimStore) {
  const results = record.policy_results ?? [];
  if (results.length === 0) return null;
  const claims = claimsByType(claimStore, 'veritas-policy-result');
  const controls = results.map((result) => {
    const claim = claims.find((item) =>
      item.metadata?.ruleId === result.rule_id ||
      item.fieldOrBehavior === result.rule_id ||
      item.subjectId.endsWith(`:${result.rule_id}`)
    );
    if (!claim) return null;
    return {
      id: `veritas.control.${surfaceSafeId(result.rule_id)}`,
      title: result.rule_id,
      claimIds: [claim.id],
      required: result.stage === 'block',
      severity: surfacePolicyImpact(result),
      validationStrategy: {
        requiredEvidence: ['policy_rule'],
        requiredMethods: ['validation'],
        requiredProof: ['policy pack evaluation'],
        reviewAuthority: 'veritas policy pack',
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
  if (controls.length === 0) return null;
  const policyPackId = surfaceSafeId(record.policy_pack?.name ?? 'policy-pack');
  return {
    id: `veritas.framework.${policyPackId}`,
    title: record.policy_pack?.name ?? 'Veritas policy pack',
    kind: 'framework',
    description: 'Veritas policy pack controls projected as Surface trust claims.',
    claimIds: controls.flatMap((control) => control.claimIds),
    controls,
    rollupPolicy: {
      mode: 'all-required',
      requiredControlIds: controls.filter((control) => control.required).map((control) => control.id),
      optionalControlIds: controls.filter((control) => !control.required).map((control) => control.id),
    },
    metadata: {
      producer: 'veritas',
      policyPack: record.policy_pack,
      adapter: record.adapter,
    },
  };
}

function claimDefToClaim(definition, record) {
  return {
    ...definition,
    value: definition.metadata?.value ?? defaultClaimValue(definition),
    currentIntegrityRef: record.integrity?.sourceRef ?? record.source_ref,
    updatedAt: record.timestamp ?? definition.updatedAt,
  };
}

function defaultClaimValue(definition) {
  if (definition.claimType === 'software-proof') return 'all checks pass';
  return definition.fieldOrBehavior;
}

function fileIntegrityForNode(record, nodeId) {
  const fileRefs = record.integrity?.fileRefs ?? [];
  if (!fileRefs.length) return [];
  const nodeFiles = Object.entries(record.file_nodes ?? {})
    .filter(([, nodes]) => nodes.some((node) => node.id === nodeId))
    .map(([file]) => file);
  if (!nodeFiles.length) return [];
  const nodeFileSet = new Set(nodeFiles);
  return fileRefs.filter((ref) => nodeFileSet.has(ref.path));
}

function claimsByType(claimStore, claimType) {
  return claimStore.claims.filter((claim) => claim.claimType === claimType);
}

function collectAffectedSurfaceEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-affected-surface');
  for (const node of record.components ?? []) {
    const claim = candidates.find((item) => item.metadata?.nodeId === node || item.fieldOrBehavior === node || item.subjectId.endsWith(`:${node}`));
    if (!claim) continue;
    const evidenceId = `${record.run_id}.surface.${surfaceSafeId(node)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: 'components',
      summary: `Veritas marked ${node} as an affected repo surface for ${record.resolved_workstream}.`,
      metadata: {
        affectedNode: node,
        fileIntegrity: fileIntegrityForNode(record, node),
      },
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.surface.${surfaceSafeId(node)}.verified`,
      claimId: claim.id,
      status: 'verified',
      method: 'affected surface resolution',
      evidenceIds: [evidenceId],
      record,
    }));
  }
}

function collectProofEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'software-proof');
  for (const proof of record.selected_proofs ?? []) {
    const claim = candidates.find((item) => item.metadata?.command === proof.command || item.fieldOrBehavior === proof.command);
    if (!claim) continue;
    const proofResult = proof.proof_result ?? null;
    const passing = typeof proofResult?.passed === 'boolean'
      ? proofResult.passed
      : record.baseline_ci_fast_passed === null ? undefined : record.baseline_ci_fast_passed;
    const observedStatus = typeof passing === 'boolean' ? (passing ? 'passed' : 'failed') : 'not captured';
    const observedSummary = proofResultSummary(proofResult)
      ?? (typeof passing === 'boolean'
        ? (passing ? 'All proof checks passed.' : 'Proof checks failed.')
        : `Proof command selected but output was not captured: ${proof.command}`);
    const evidenceId = `${record.run_id}.proof.${surfaceSafeId(proof.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'test_output',
      method: proof.method ?? 'validation',
      record,
      locator: 'selected_proofs',
      summary: observedSummary,
      passing,
      blocking: true,
      metadata: {
        command: proof.command,
        expectedResult: 'all checks pass',
        observedResult: {
          expected: 'all checks pass',
          status: observedStatus,
          summary: observedSummary,
        },
        ...(proofResult ? {
          commandOutput: {
            command: proof.command,
            exitCode: proofResult.exitCode,
            signal: proofResult.signal,
            stdout: proofResult.stdout ?? '',
            stderr: proofResult.stderr ?? '',
            combined: proofResult.output ?? `${proofResult.stdout ?? ''}${proofResult.stderr ?? ''}`,
          },
        } : {}),
        proofResolutionSource: record.proof_resolution_source,
        baselineCiFastPassed: typeof passing === 'boolean' ? passing : record.baseline_ci_fast_passed,
        proofId: proof.id,
        surfaceClaimIds: proof.surface_claim_ids ?? [],
      },
    }));
    if (typeof passing === 'boolean') {
      events.push(surfaceEvent({
        id: `${record.run_id}.proof.${surfaceSafeId(proof.id)}.${passing ? 'verified' : 'rejected'}`,
        claimId: claim.id,
        status: passing ? 'verified' : 'rejected',
        method: proof.command,
        evidenceIds: [evidenceId],
        record,
      }));
    }
  }
}

function proofResultSummary(result) {
  if (!result) return null;
  if (result.passed) return 'All proof checks passed.';
  const status = result.exitCode !== null && result.exitCode !== undefined
    ? `exit code ${result.exitCode}`
    : `signal ${result.signal ?? 'unknown'}`;
  const firstOutputLine = String(result.stderr || result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstOutputLine
    ? `Proof checks failed with ${status}: ${firstOutputLine}`
    : `Proof checks failed with ${status}.`;
}

function collectPolicyResultEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-policy-result');
  for (const result of record.policy_results ?? []) {
    const claim = candidates.find((item) => item.metadata?.ruleId === result.rule_id || item.fieldOrBehavior === result.rule_id || item.subjectId.endsWith(`:${result.rule_id}`));
    if (!claim) continue;
    const status = surfacePolicyResultStatus(result);
    const impactLevel = surfacePolicyImpact(result);
    const evidenceId = `${record.run_id}.policy.${surfaceSafeId(result.rule_id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'validation',
      record,
      locator: `policy_results.${result.rule_id}`,
      summary: result.summary ?? result.message ?? `Policy ${result.rule_id} evaluated.`,
      passing: result.passed,
      blocking: result.stage === 'block',
      metadata: {
        stage: result.stage,
        classification: result.classification,
        implemented: result.implemented,
        passed: result.passed,
        faultLineHints: result.passed === false ? [{
          type: 'policy_violation',
          severity: impactLevel,
          message: result.message,
          blocking: result.stage === 'block',
        }] : [],
      },
    }));
    if (status !== 'proposed') {
      events.push(surfaceEvent({
        id: `${record.run_id}.policy.${surfaceSafeId(result.rule_id)}.${status}`,
        claimId: claim.id,
        status,
        method: 'policy pack evaluation',
        evidenceIds: [evidenceId],
        record,
        notes: result.message,
      }));
    }
  }
}

function collectExternalToolEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-external-tool-result');
  for (const result of record.external_tool_results ?? []) {
    const claim = candidates.find((item) => item.metadata?.tool === result.tool || item.metadata?.proofId === result.proof_id);
    if (!claim) continue;
    const status = surfaceExternalToolStatus(result);
    const evidenceId = `${record.run_id}.external-tool.${surfaceSafeId(`${result.tool}-${result.proof_id}`)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'test_output',
      method: 'auditability',
      record,
      locator: result.artifact_path,
      summary: `${result.tool} reported ${result.verdict} for proof ${result.proof_id}.`,
      passing: result.verdict === 'pass',
      blocking: result.blocking !== false,
      metadata: {
        externalToolResult: result,
        faultLineHints: status === 'verified' ? [] : [{
          type: result.blocking ? 'policy_violation' : 'provenance_gap',
          severity: result.blocking ? 'high' : 'medium',
          message: `${result.tool} verdict is ${result.verdict}.`,
          blocking: result.blocking !== false,
        }],
      },
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.external-tool.${surfaceSafeId(`${result.tool}-${result.proof_id}`)}.${status}`,
      claimId: claim.id,
      status,
      method: result.command,
      evidenceIds: [evidenceId],
      record,
      notes: `${result.tool} ${result.format} verdict: ${result.verdict}`,
    }));
  }
}

function collectProofSuiteEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-proof-suite');
  for (const suite of record.proof_suite_results ?? []) {
    const claim = candidates.find((item) => item.metadata?.suiteId === suite.id || item.fieldOrBehavior === suite.id);
    if (!claim) continue;
    const status = surfaceProofSuiteStatus(suite);
    const evidenceId = `${record.run_id}.proof-suite.${surfaceSafeId(suite.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'validation',
      record,
      locator: suite.manifest_path,
      summary: surfaceProofSuiteSummary(suite),
      metadata: {
        suiteId: suite.id,
        proofId: suite.proof_id,
        owner: suite.owner,
        selected: suite.selected,
        recentCatchEvidence: suite.recent_catch_evidence,
        evidenceBasis: suite.evidence_basis,
        freshnessStatus: suite.freshness_status,
        faultLineHints: surfaceProofSuiteFaultLineHints(suite),
      },
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.proof-suite.${surfaceSafeId(suite.id)}.${status}`,
      claimId: claim.id,
      status,
      method: 'proof suite inventory',
      evidenceIds: [evidenceId],
      record,
      verifiedAt: isoDateTimeOrUndefined(suite.last_reviewed),
      notes: suite.rationale,
    }));
  }
}

function collectVerificationBudgetEvidence(record, claimStore, evidence, events) {
  if (!record.verification_budget) return;
  const claim = claimsByType(claimStore, 'veritas-verification-budget')[0];
  if (!claim) return;
  const staleCount = record.verification_budget.stale_or_unknown_family_ids?.length ?? 0;
  const status = staleCount > 0 ? 'disputed' : 'verified';
  const evidenceId = `${record.run_id}.budget.verification.evidence`;
  evidence.push(surfaceEvidence({
    id: evidenceId,
    claimId: claim.id,
    type: 'policy_rule',
    method: 'auditability',
    record,
    locator: 'verification_budget',
    summary: record.verification_budget.recommendation,
    passing: staleCount === 0,
    blocking: staleCount > 0,
    metadata: {
      verificationBudget: record.verification_budget,
      faultLineHints: staleCount > 0 ? [{
        type: 'freshness_breach',
        severity: 'high',
        message: record.verification_budget.recommendation,
      }] : [],
    },
  }));
  events.push(surfaceEvent({
    id: `${record.run_id}.budget.verification.${status}`,
    claimId: claim.id,
    status,
    method: 'verification budget',
    evidenceIds: [evidenceId],
    record,
    notes: record.verification_budget.recommendation,
  }));
}

function collectGovernanceEvidence(record, claimStore, evidence, events) {
  const claims = claimsByType(claimStore, 'veritas-governance-artifact');
  if (!record.governance_state || claims.length === 0) return;
  const status = governanceAttestationStatus(record.governance_state);
  for (const claim of claims) {
    const attestationEvidenceId = `${record.run_id}.governance.${surfaceSafeId(claim.id)}.attestation.evidence`;
    const auditEvidenceId = `${record.run_id}.governance.${surfaceSafeId(claim.id)}.audit.evidence`;
    evidence.push(surfaceEvidence({
      id: attestationEvidenceId,
      claimId: claim.id,
      type: 'attestation',
      method: 'attestation',
      record,
      locator: '.veritas/attestations',
      summary: `Human attestation currency is ${status} for Zone 1 governance state ${record.governance_state.state}.`,
      passing: status === 'verified',
      blocking: status !== 'verified',
    }));
    evidence.push(surfaceEvidence({
      id: auditEvidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: 'governance_state',
      summary: `Veritas inspected Zone 1 governance state ${record.governance_state.state} for ${claim.fieldOrBehavior}.`,
      passing: status === 'verified',
      blocking: status !== 'verified',
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.governance.${surfaceSafeId(claim.id)}.${status}`,
      claimId: claim.id,
      status,
      method: 'human attestation status',
      evidenceIds: [attestationEvidenceId, auditEvidenceId],
      record,
      notes: `Human attestation currency is ${status}.`,
      verifiedAt: status === 'verified' ? record.timestamp : undefined,
    }));
  }
}

function collectProposalEvidence(record, claimStore, evidence, rootDir) {
  const candidates = claimsByType(claimStore, 'veritas-proposal');
  for (const proposal of readOpenProposalSummaries(rootDir)) {
    const claim = candidates.find((item) => item.metadata?.proposalId === proposal.id || item.subjectId === proposal.id);
    if (!claim) continue;
    const evidenceId = `${record.run_id}.proposal.${surfaceSafeId(proposal.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
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
}

export function buildGovernanceArtifactClaims({
  record,
  claims,
  evidence,
  events,
  attestationPolicyClaimId,
}) {
  const governanceState = record.governance_state;
  if (!governanceState) return;

  const artifacts = [
    {
      key: 'policy-pack',
      hashField: 'policyPackHash',
      subjectId: record.policy_pack?.name ?? 'policy-pack',
      path: governanceState.zone1?.paths?.policyPackPath,
      currentHash: governanceState.zone1?.hashes?.policyPackHash,
      attestedHash: governanceState.attestation?.policyPackHash,
      applicability: 'policy-results',
    },
    {
      key: 'adapter',
      hashField: 'adapterHash',
      subjectId: record.adapter?.name ?? 'adapter',
      path: governanceState.zone1?.paths?.adapterPath,
      currentHash: governanceState.zone1?.hashes?.adapterHash,
      attestedHash: governanceState.attestation?.adapterHash,
      applicability: record.uncovered_path_result === 'clear' ? 'covered' : record.uncovered_path_result,
    },
    {
      key: 'team-profile',
      hashField: 'teamProfileHash',
      subjectId: record.owner ?? 'team-profile',
      path: governanceState.zone1?.paths?.teamProfilePath,
      currentHash: governanceState.zone1?.hashes?.teamProfileHash,
      attestedHash: governanceState.attestation?.teamProfileHash,
      applicability: 'governance-actor-context',
    },
  ];

  for (const artifact of artifacts) {
    const drift = governanceState.drift?.find((item) => item.field === artifact.hashField);
    const status = governanceArtifactStatus(governanceState, drift);
    const id = surfaceClaimId(record.run_id, 'governance-artifact', artifact.key);
    const evidenceId = `${id}.evidence`;
    claims.push({
      id,
      subjectType: 'veritas-governance-artifact',
      subjectId: `${artifact.key}:${artifact.subjectId}`,
      surface: 'veritas.governance-artifacts',
      claimType: 'veritas-governance-artifact',
      fieldOrBehavior: artifact.key === 'adapter' ? 'integrityAndApplicability' : 'integrityAndCurrentness',
      value: {
        artifact: artifact.key,
        path: artifact.path,
        currentHash: drift?.current ?? artifact.currentHash,
        attestedHash: drift?.attested ?? artifact.attestedHash ?? null,
        attestationState: governanceState.state,
        expired: governanceState.expired,
        applicability: artifact.applicability,
      },
      status,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel: 'high',
      currentIntegrityRef: drift?.current ?? artifact.currentHash ?? record.source_ref,
      derivedFrom: attestationPolicyClaimId ? [attestationPolicyClaimId] : undefined,
      verificationPolicyId: SURFACE_TRUST_POLICIES.governanceArtifact.id,
      confidenceBasis: {
        sourceQuality: status === 'verified' ? 'strong' : 'moderate',
        reviewerAuthority: governanceState.attestation?.actor ? 'human' : 'none',
        proofStrength: status === 'verified' ? 'strong' : 'weak',
        conflictCount: status === 'verified' ? 0 : 1,
        impactLevel: 'high',
      },
      metadata: {
        source: 'Zone 1 governance hash inspection',
        currentAttestationId: governanceState.currentAttestationId,
        drift: drift ?? null,
        zone1Error: governanceState.zone1?.error,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'attestation',
      method: 'auditability',
      record,
      locator: artifact.path ?? 'governance_state',
      summary: governanceArtifactSummary(artifact.key, status, governanceState),
      metadata: {
        governanceArtifact: artifact.key,
        attestationState: governanceState.state,
        faultLineHints: status === 'verified' ? [] : [{
          type: status === 'stale' ? 'freshness_breach' : 'provenance_gap',
          severity: 'high',
          message: governanceArtifactSummary(artifact.key, status, governanceState),
        }],
      },
    }));
    events.push(surfaceEvent({
      id: `${id}.${status}`,
      claimId: id,
      status,
      method: 'Zone 1 governance hash inspection',
      evidenceIds: [evidenceId],
      record,
      notes: governanceArtifactSummary(artifact.key, status, governanceState),
    }));
  }

  const status = governanceAttestationStatus(governanceState);
  const id = surfaceClaimId(record.run_id, 'governance-attestation', governanceState.currentAttestationId ?? governanceState.state);
  const evidenceId = `${id}.evidence`;
  claims.push({
    id,
    subjectType: 'veritas-human-attestation',
    subjectId: governanceState.currentAttestationId ?? 'missing',
    surface: 'veritas.attestations',
    claimType: 'veritas-governance-artifact',
    fieldOrBehavior: 'attestationCurrency',
    value: {
      state: governanceState.state,
      currentAttestationId: governanceState.currentAttestationId,
      ageDays: governanceState.ageDays,
      validUntil: governanceState.validUntil,
      expired: governanceState.expired,
    },
    status,
    createdAt: record.timestamp,
    updatedAt: record.timestamp,
    impactLevel: 'high',
    currentIntegrityRef: governanceState.currentAttestationId ?? record.source_ref,
    derivedFrom: attestationPolicyClaimId ? [attestationPolicyClaimId] : undefined,
    verificationPolicyId: SURFACE_TRUST_POLICIES.governanceArtifact.id,
    confidenceBasis: {
      sourceQuality: governanceState.attestation ? 'strong' : 'weak',
      reviewerAuthority: governanceState.attestation?.actor ? 'human' : 'none',
      proofStrength: status === 'verified' ? 'strong' : 'weak',
      conflictCount: status === 'verified' ? 0 : 1,
      impactLevel: 'high',
    },
    metadata: {
      pending: governanceState.pending,
      drift: governanceState.drift,
    },
  });
  evidence.push(surfaceEvidence({
    id: evidenceId,
    claimId: id,
    type: 'attestation',
    method: 'attestation',
    record,
    locator: '.veritas/attestations',
    summary: `Human attestation currency is ${status} for Zone 1 governance state ${governanceState.state}.`,
  }));
  events.push(surfaceEvent({
    id: `${id}.${status}`,
    claimId: id,
    status,
    method: 'human attestation status',
    evidenceIds: [evidenceId],
    record,
    notes: `Human attestation currency is ${status}.`,
    verifiedAt: status === 'verified' ? record.timestamp : undefined,
  }));
}

function governanceArtifactStatus(governanceState, drift) {
  if (drift) return 'disputed';
  if (governanceState.state === 'drifted' || governanceState.state === 'broken-head') return 'verified';
  if (governanceState.state === 'missing' || governanceState.state === 'pending') return 'disputed';
  return 'verified';
}

function governanceAttestationStatus(governanceState) {
  if (governanceState.state === 'drifted' || governanceState.state === 'broken-head') return 'disputed';
  if (governanceState.state === 'missing' || governanceState.state === 'pending') return 'disputed';
  if (governanceState.expired) return 'stale';
  return 'verified';
}

function governanceArtifactSummary(artifact, status, governanceState) {
  if (status === 'disputed') {
    return `${artifact} governance state is disputed because attestation state is ${governanceState.state}.`;
  }
  if (status === 'stale') {
    return `${artifact} governance state is stale because the active attestation expired.`;
  }
  return `${artifact} governance state matches the active Zone 1 attestation.`;
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
  for (const collection of input.collections ?? []) {
    if (typeof builder.addCollection === 'function') builder.addCollection(collection);
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
    collections: [],
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
    collections: {
      push: (...items) => {
        for (const item of items) {
          draft.collections.push(item);
          if (typeof builder.addCollection === 'function') builder.addCollection(item);
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
          collections: [...draft.collections],
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
    collectionRollups: report.collectionRollups ?? [],
  };
}

export function surfaceEvidence({ id, claimId, type, method, record, locator, summary, passing, blocking, metadata = {} }) {
  const evidenceIntegrity = metadata.fileIntegrity
    ? { ...(record.integrity ?? {}), fileRefs: metadata.fileIntegrity }
    : record.integrity;
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
    integrityRef: record.integrity?.sourceRef ?? record.source_ref,
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof passing === 'boolean' ? { passing } : {}),
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof blocking === 'boolean' ? { blocking } : {}),
    metadata: {
      sourceKind: record.source_kind,
      sourceScope: record.source_scope,
      files: record.files ?? [],
      unresolvedFiles: record.unresolved_files ?? [],
      integrity: evidenceIntegrity ?? null,
      fileIntegrity: metadata.fileIntegrity ?? record.integrity?.fileRefs ?? [],
      configIntegrity: record.integrity?.configRefs ?? {},
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

export function surfaceProofSuiteStatus(suite) {
  if (suite.freshness_status === 'stale' || suite.freshness_status === 'review-needed') return 'stale';
  if (suite.freshness_status === 'retiring' || suite.disposition === 'retire') return 'superseded';
  if (suite.blocking_status === 'rejected') return 'rejected';
  if (suite.blocking_status === 'disputed') return 'disputed';
  if (suite.disposition === 'required' && suite.recent_catch_evidence !== 'unknown') return 'verified';
  return 'proposed';
}

export function surfaceProofSuiteImpact(suite) {
  if (suite.regression_severity === 'critical') return 'critical';
  if (suite.regression_severity === 'high' || suite.verification_weight === 'blocking' || suite.blocking_status === 'required') return 'high';
  if (suite.regression_severity === 'low' || suite.verification_weight === 'informational') return 'low';
  return 'medium';
}

export function surfaceProofSuiteStrength(suite) {
  if (suite.recent_catch_evidence === 'unknown' || suite.evidence_basis === 'unknown') return 'weak';
  if (suite.disposition === 'required' && suite.freshness_status === 'current') return 'strong';
  return 'moderate';
}

export function surfaceProofSuiteSummary(suite) {
  const rationale = suite.rationale ? ` ${suite.rationale}` : '';
  return `Proof suite ${suite.id} is ${suite.disposition} / ${suite.blocking_status}; freshness ${suite.freshness_status}; evidence ${suite.evidence_basis}.${rationale}`;
}

export function surfaceExternalToolStatus(result) {
  if (result.verdict === 'pass') return 'verified';
  if (result.blocking && (result.verdict === 'fail' || result.verdict === 'missing')) return 'rejected';
  if (result.verdict === 'fail' || result.verdict === 'warn' || result.verdict === 'missing') return 'disputed';
  return 'proposed';
}

export function surfaceProofSuiteFaultLineHints(suite) {
  const hints = [];
  if (suite.freshness_status === 'stale' || suite.freshness_status === 'review-needed' || suite.freshness_status === 'retiring') {
    hints.push({
      type: 'freshness_breach',
      severity: surfaceProofSuiteImpact(suite),
      message: `Proof suite ${suite.id} freshness is ${suite.freshness_status}.`,
    });
  }
  if (suite.recent_catch_evidence === 'unknown' || suite.evidence_basis === 'unknown') {
    hints.push({
      type: 'provenance_gap',
      severity: surfaceProofSuiteImpact(suite),
      message: `Proof suite ${suite.id} has weak or unknown catch evidence.`,
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

export function policyResultClaimId(record, ruleId) {
  return [
    'veritas',
    'policy',
    surfaceSafeId(record.adapter?.name ?? 'adapter'),
    surfaceSafeId(record.policy_pack?.name ?? 'policy-pack'),
    surfaceSafeId(ruleId),
  ].join('.');
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
