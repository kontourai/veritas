import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SURFACE_TRUST_POLICIES } from './policies.mjs';
import {
  surfaceClaimId,
  surfaceEvidence,
  surfaceEvent,
  surfaceSafeId,
} from './primitives.mjs';
import { veritasArtifactPath, veritasArtifactRepoPath } from '../paths.mjs';

function claimsByType(claimStore, claimType) {
  return (claimStore.claims ?? []).filter((claim) => claim.claimType === claimType);
}

export function collectGovernanceEvidence(record, claimStore, evidence, events) {
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
      summary: `Authority-backed attestation currency is ${status} for Protected Standards state ${record.governance_state.state}.`,
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
      summary: `Veritas inspected Protected Standards state ${record.governance_state.state} for ${claim.fieldOrBehavior}.`,
      passing: status === 'verified',
      blocking: status !== 'verified',
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.governance.${surfaceSafeId(claim.id)}.${status}`,
      claimId: claim.id,
      status,
      method: 'authority attestation status',
      evidenceIds: [attestationEvidenceId, auditEvidenceId],
      record,
      notes: `Authority-backed attestation currency is ${status}.`,
      verifiedAt: status === 'verified' ? record.timestamp : undefined,
    }));
  }
}

export function collectRecommendationEvidence(record, claimStore, evidence, rootDir) {
  const candidates = claimsByType(claimStore, 'veritas-recommendation');
  for (const recommendation of readOpenRecommendationSummaries(rootDir)) {
    const claim = candidates.find((item) => item.metadata?.recommendationId === recommendation.id || item.subjectId === recommendation.id);
    if (!claim) continue;
    const evidenceId = `${record.run_id}.recommendation.${surfaceSafeId(recommendation.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: veritasArtifactRepoPath('recommendations', `${recommendation.id}.recommendation.json`),
      summary: recommendation.rationale,
      metadata: {
        recommendationType: recommendation.type,
        recommendationTarget: recommendation.target,
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
      key: 'repo-standards',
      hashField: 'repoStandardsHash',
      subjectId: record.repo_standards?.name ?? 'repo-standards',
      path: governanceState.protectedStandards?.paths?.repoStandardsPath,
      currentHash: governanceState.protectedStandards?.hashes?.repoStandardsHash,
      attestedHash: governanceState.attestation?.repoStandardsHash,
      applicability: 'policy-results',
    },
    {
      key: 'repo-map',
      hashField: 'repoMapHash',
      subjectId: record.repo_map?.name ?? 'repo-map',
      path: governanceState.protectedStandards?.paths?.repoMapPath,
      currentHash: governanceState.protectedStandards?.hashes?.repoMapHash,
      attestedHash: governanceState.attestation?.repoMapHash,
      applicability: record.uncovered_path_result === 'clear' ? 'covered' : record.uncovered_path_result,
    },
    {
      key: 'authority-settings',
      hashField: 'authoritySettingsHash',
      subjectId: record.owner ?? 'authority-settings',
      path: governanceState.protectedStandards?.paths?.authoritySettingsPath,
      currentHash: governanceState.protectedStandards?.hashes?.authoritySettingsHash,
      attestedHash: governanceState.attestation?.authoritySettingsHash,
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
      facet: 'veritas.governance-artifacts',
      claimType: 'veritas-governance-artifact',
      fieldOrBehavior: artifact.key === 'repo-map' ? 'integrityAndApplicability' : 'integrityAndCurrentness',
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
        reviewerAuthority: governanceState.attestation?.actor ? 'authority' : 'none',
        evidenceStrength: status === 'verified' ? 'strong' : 'weak',
        conflictCount: status === 'verified' ? 0 : 1,
        impactLevel: 'high',
      },
      metadata: {
        source: 'Protected Standards hash inspection',
        currentAttestationId: governanceState.currentAttestationId,
        drift: drift ?? null,
        protectedStandardsError: governanceState.protectedStandards?.error,
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
        transparencyGapHints: status === 'verified' ? [] : [{
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
      method: 'Protected Standards hash inspection',
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
    facet: 'veritas.attestations',
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
      evidenceStrength: status === 'verified' ? 'strong' : 'weak',
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
    summary: `Authority-backed attestation currency is ${status} for Protected Standards state ${governanceState.state}.`,
  }));
  events.push(surfaceEvent({
    id: `${id}.${status}`,
    claimId: id,
    status,
    method: 'authority attestation status',
    evidenceIds: [evidenceId],
    record,
    notes: `Authority-backed attestation currency is ${status}.`,
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
  return `${artifact} governance state matches the active Protected Standards attestation.`;
}

function readOpenRecommendationSummaries(rootDir) {
  const dir = veritasArtifactPath(rootDir, 'recommendations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.recommendation.json'))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((recommendation) => recommendation?.status === 'proposed');
}
