import { resolveActor } from '../util/actor.mjs';
import { surfaceSafeId } from './primitives.mjs';

// `actor` is the readiness run's resolved actor (see resolveActor); it is a projection input, not a
// record field. A current attestation's actor still names the authority when there is one.
function buildReadinessAuthorityTrace(record, { actor: runActor = null } = {}) {
  const governanceState = record.governance_state;
  const attestationActorId = governanceState?.attestation?.actor?.id;
  if (governanceState?.attestation && (typeof attestationActorId !== 'string' || !/[a-zA-Z0-9._]/.test(attestationActorId))) {
    throw new Error('Readiness authority trace requires an attestation actor with a non-empty string id containing a Surface-safe identifier character.');
  }
  const actor = attestationActorId ?? resolveActor(runActor) ?? record.owner ?? 'veritas';
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

export function buildReadinessAuthorityTraceRecord(record, claim, evidenceId, { actor = null } = {}) {
  const governanceState = record.governance_state;
  const metadataTrace = buildReadinessAuthorityTrace(record, { actor });
  const actorRef = governanceState?.attestation
    ? `actor:${surfaceSafeId(metadataTrace.actor)}`
    : `system:${surfaceSafeId(metadataTrace.actor)}`;
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
