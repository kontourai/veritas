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
  const assembler = createSurfaceTrustInputAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 2,
  });
  const { claims, evidence, events } = assembler;

  for (const definition of claimStore.claims) {
    claims.push(claimDefToClaim(definition, record));
  }

  collectAffectedSurfaceEvidence(record, claimStore, evidence, events);
  collectProofLaneEvidence(record, claimStore, evidence, events);
  collectPolicyResultEvidence(record, claimStore, evidence, events);
  collectProofFamilyEvidence(record, claimStore, evidence, events);
  collectExternalToolEvidence(record, claimStore, evidence, events);
  collectVerificationBudgetEvidence(record, claimStore, evidence, events);
  collectGovernanceEvidence(record, claimStore, evidence, events);
  collectProposalEvidence(record, claimStore, evidence, rootDir);
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
    return assembler.build(claimStore.policies);
  } catch (error) {
    return throwSurfaceTrustInputValidationError({
      error,
      input: error.trustInputDraft,
      record,
      rootDir,
    });
  }
}

function claimDefToClaim(definition, record) {
  return {
    ...definition,
    value: definition.metadata?.value ?? defaultClaimValue(definition),
    currentIntegrityRef: record.source_ref,
    updatedAt: record.timestamp ?? definition.updatedAt,
  };
}

function defaultClaimValue(definition) {
  if (definition.claimType === 'software-proof') return 'all checks pass';
  return definition.fieldOrBehavior;
}

function claimsByType(claimStore, claimType) {
  return claimStore.claims.filter((claim) => claim.claimType === claimType);
}

function collectAffectedSurfaceEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-affected-surface');
  for (const node of record.affected_nodes ?? []) {
    const claim = candidates.find((item) => item.metadata?.nodeId === node || item.fieldOrBehavior === node || item.subjectId.endsWith(`:${node}`));
    if (!claim) continue;
    const evidenceId = `${record.run_id}.surface.${surfaceSafeId(node)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: 'affected_nodes',
      summary: `Veritas marked ${node} as an affected repo surface for ${record.resolved_workstream}.`,
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

function collectProofLaneEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'software-proof');
  for (const lane of record.selected_proof_lanes ?? []) {
    const claim = candidates.find((item) => item.metadata?.command === lane.command || item.fieldOrBehavior === lane.command);
    if (!claim) continue;
    const proofResult = lane.proof_result ?? null;
    const passing = typeof proofResult?.passed === 'boolean'
      ? proofResult.passed
      : record.baseline_ci_fast_passed === null ? undefined : record.baseline_ci_fast_passed;
    const observedStatus = typeof passing === 'boolean' ? (passing ? 'passed' : 'failed') : 'not captured';
    const observedSummary = proofResultSummary(proofResult)
      ?? (typeof passing === 'boolean'
        ? (passing ? 'All proof checks passed.' : 'Proof checks failed.')
        : `Proof command selected but output was not captured: ${lane.command}`);
    const evidenceId = `${record.run_id}.proof.${surfaceSafeId(lane.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'test_output',
      method: lane.method ?? 'validation',
      record,
      locator: 'selected_proof_lanes',
      summary: observedSummary,
      passing,
      blocking: true,
      metadata: {
        command: lane.command,
        expectedResult: 'all checks pass',
        observedResult: {
          expected: 'all checks pass',
          status: observedStatus,
          summary: observedSummary,
        },
        ...(proofResult ? {
          commandOutput: {
            command: lane.command,
            exitCode: proofResult.exitCode,
            signal: proofResult.signal,
            stdout: proofResult.stdout ?? '',
            stderr: proofResult.stderr ?? '',
            combined: proofResult.output ?? `${proofResult.stdout ?? ''}${proofResult.stderr ?? ''}`,
          },
        } : {}),
        proofResolutionSource: record.proof_resolution_source,
        baselineCiFastPassed: typeof passing === 'boolean' ? passing : record.baseline_ci_fast_passed,
        proofLaneId: lane.id,
        surfaceClaimIds: lane.surface_claim_ids ?? [],
      },
    }));
    if (typeof passing === 'boolean') {
      events.push(surfaceEvent({
        id: `${record.run_id}.proof.${surfaceSafeId(lane.id)}.${passing ? 'verified' : 'rejected'}`,
        claimId: claim.id,
        status: passing ? 'verified' : 'rejected',
        method: lane.command,
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
    const claim = candidates.find((item) => item.metadata?.tool === result.tool || item.metadata?.proofLaneId === result.proof_lane_id);
    if (!claim) continue;
    const status = surfaceExternalToolStatus(result);
    const evidenceId = `${record.run_id}.external-tool.${surfaceSafeId(`${result.tool}-${result.proof_lane_id}`)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'test_output',
      method: 'auditability',
      record,
      locator: result.artifact_path,
      summary: `${result.tool} reported ${result.verdict} for proof lane ${result.proof_lane_id}.`,
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
      id: `${record.run_id}.external-tool.${surfaceSafeId(`${result.tool}-${result.proof_lane_id}`)}.${status}`,
      claimId: claim.id,
      status,
      method: result.command,
      evidenceIds: [evidenceId],
      record,
      notes: `${result.tool} ${result.format} verdict: ${result.verdict}`,
    }));
  }
}

function collectProofFamilyEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-proof-family');
  for (const family of record.proof_family_results ?? []) {
    const claim = candidates.find((item) => item.metadata?.familyId === family.id || item.fieldOrBehavior === family.id);
    if (!claim) continue;
    const status = surfaceProofFamilyStatus(family);
    const evidenceId = `${record.run_id}.proof-family.${surfaceSafeId(family.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
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
      id: `${record.run_id}.proof-family.${surfaceSafeId(family.id)}.${status}`,
      claimId: claim.id,
      status,
      method: 'proof family inventory',
      evidenceIds: [evidenceId],
      record,
      verifiedAt: isoDateTimeOrUndefined(family.last_reviewed),
      notes: family.rationale,
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
    const evidenceId = `${record.run_id}.governance.${surfaceSafeId(claim.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'attestation',
      method: 'attestation',
      record,
      locator: '.veritas/attestations',
      summary: `Human attestation currency is ${status} for Zone 1 governance state ${record.governance_state.state}.`,
      passing: status === 'verified',
      blocking: status !== 'verified',
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.governance.${surfaceSafeId(claim.id)}.${status}`,
      claimId: claim.id,
      status,
      method: 'human attestation status',
      evidenceIds: [evidenceId],
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

export function surfaceEvidence({ id, claimId, type, method, record, locator, summary, passing, blocking, metadata = {} }) {
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
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof passing === 'boolean' ? { passing } : {}),
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof blocking === 'boolean' ? { blocking } : {}),
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
