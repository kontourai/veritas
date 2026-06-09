import { surfaceSafeId } from './primitives.mjs';

export function buildReadinessAuthorityTrace(record) {
  const governanceState = record.governance_state;
  const actor = governanceState?.attestation?.actor ?? process.env.VERITAS_ACTOR ?? record.owner ?? 'veritas';
  const protectedStandards = governanceState?.protectedStandards ?? null;
  return {
    kind: governanceState?.attestation ? 'governance-attestation' : 'producer-fallback',
    producer: 'veritas',
    actor,
    method: governanceState?.attestation ? 'attestation' : 'readiness-producer',
    sourceRef: record.integrity?.sourceRef ?? record.source_ref,
    currentAttestationId: governanceState?.currentAttestationId ?? null,
    attestationState: governanceState?.state ?? 'absent',
    validUntil: governanceState?.validUntil ?? null,
    protectedStandards: protectedStandards ? {
      paths: protectedStandards.paths ?? {},
      hashes: protectedStandards.hashes ?? {},
      drift: governanceState?.drift ?? [],
    } : null,
  };
}

export function buildReadinessAuthorityTraceRecord(record, claim, evidenceId) {
  const governanceState = record.governance_state;
  const metadataTrace = buildReadinessAuthorityTrace(record);
  const attestationActor = governanceState?.attestation?.actor;
  const actorRef = attestationActor
    ? `actor:${surfaceSafeId(attestationActor)}`
    : `system:${surfaceSafeId(process.env.VERITAS_ACTOR ?? record.owner ?? 'veritas')}`;
  const authorityRef = governanceState?.currentAttestationId
    ? `attestation:${surfaceSafeId(governanceState.currentAttestationId)}`
    : 'producer:veritas';
  return {
    id: `${claim.id}.authority`,
    subject: {
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
    },
    actorRef,
    authorityType: governanceState?.attestation ? 'credential' : 'system',
    authorityRef,
    sourceRef: record.integrity?.sourceRef ?? record.source_ref ?? record.run_id,
    observedAt: record.timestamp,
    evidenceIds: [evidenceId],
    claimIds: [claim.id],
    validUntil: governanceState?.validUntil ?? undefined,
    integrityRef: record.integrity?.sourceRef ?? record.source_ref,
    metadata: metadataTrace,
  };
}
