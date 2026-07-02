export function buildAttestationValidityProjection({ input, claims, generatedAt }) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const policiesById = new Map(input.policies.map((policy) => [policy.id, policy]));
  const items = input.evidence
    .filter((evidence) =>
      evidence.method === 'attestation' ||
      evidence.evidenceType === 'attestation' ||
      evidence.evidenceType === 'human_attestation'
    )
    .map((evidence) => {
      const claim = claimsById.get(evidence.claimId);
      const policy = policiesById.get(claim?.verificationPolicyId);
      const actorRef = actorRefForEvidence(evidence);
      const validUntil = stringMetadata(evidence.metadata, 'validUntil');
      const revokedAt = stringMetadata(evidence.metadata, 'revokedAt');
      const integrityRef = evidence.integrityRef ?? stringMetadata(evidence.metadata, 'contentHash');
      const gaps = [];
      if (!actorRef) gaps.push('attestation_actor_missing');
      if (!hasIdentityEvidence(evidence)) gaps.push('attestation_identity_unverified');
      if (!hasAuthoritySource(evidence, policy, actorRef)) gaps.push('attestation_authority_unverified');
      if (!integrityRef) gaps.push('attestation_integrity_missing');
      if (validUntil && new Date(validUntil).getTime() < new Date(generatedAt).getTime()) {
        gaps.push('attestation_expired');
      }
      if (revokedAt) gaps.push('attestation_revoked');
      const status = gaps.includes('attestation_actor_missing') ||
        gaps.includes('attestation_expired') ||
        gaps.includes('attestation_revoked')
        ? 'invalid'
        : gaps.length === 0 ? 'valid' : 'weak';
      return {
        evidenceId: evidence.id,
        claimId: evidence.claimId,
        ...(actorRef ? { actorRef } : {}),
        ...(policy?.reviewAuthority ? { requiredAuthority: policy.reviewAuthority } : {}),
        status,
        gaps,
        ...(validUntil ? { validUntil } : {}),
        ...(revokedAt ? { revokedAt } : {}),
        ...(integrityRef ? { integrityRef } : {}),
      };
    })
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  return {
    totalAttestations: items.length,
    validAttestations: items.filter((item) => item.status === 'valid').length,
    weakAttestations: items.filter((item) => item.status === 'weak').length,
    invalidAttestations: items.filter((item) => item.status === 'invalid').length,
    items,
  };
}

export function buildAttestationGaps({ attestationValidity, claims }) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  return sortGaps(attestationValidity.items.flatMap((item) => {
    const claim = claimsById.get(item.claimId);
    return item.gaps.map((gapType) => ({
      claimId: item.claimId,
      facet: claim?.facet ?? 'unknown',
      impactLevel: claim?.impactLevel ?? 'medium',
      gapType,
      message: attestationGapMessage(gapType, item),
      ...(claim?.verificationPolicyId ? { policyId: claim.verificationPolicyId } : {}),
      evidenceIds: [item.evidenceId],
    }));
  }));
}

export function sortGaps(gaps) {
  const impactRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...gaps].sort((a, b) => {
    const impact = (impactRank[a.impactLevel] ?? 4) - (impactRank[b.impactLevel] ?? 4);
    if (impact !== 0) return impact;
    return a.claimId.localeCompare(b.claimId) || a.gapType.localeCompare(b.gapType);
  });
}

function attestationGapMessage(gapType, item) {
  if (gapType === 'attestation_actor_missing') return `Attestation ${item.evidenceId} has no actor reference.`;
  if (gapType === 'attestation_identity_unverified') return `Attestation ${item.evidenceId} has no identity evidenceCheck reference.`;
  if (gapType === 'attestation_authority_unverified') return `Attestation ${item.evidenceId} has no authority source for ${item.requiredAuthority ?? 'the required authority'}.`;
  if (gapType === 'attestation_integrity_missing') return `Attestation ${item.evidenceId} has no integrity reference.`;
  if (gapType === 'attestation_expired') return `Attestation ${item.evidenceId} expired at ${item.validUntil}.`;
  if (gapType === 'attestation_revoked') return `Attestation ${item.evidenceId} was revoked at ${item.revokedAt}.`;
  return `Attestation ${item.evidenceId} has gap ${gapType}.`;
}

function actorRefForEvidence(evidence) {
  const actor = evidence.metadata?.actor;
  if (typeof actor === 'object' && actor !== null && typeof actor.id === 'string') return actor.id;
  if (typeof evidence.metadata?.actorRef === 'string') return evidence.metadata.actorRef;
  if (typeof evidence.collectedBy === 'string' && evidence.collectedBy !== 'veritas') return evidence.collectedBy;
  return undefined;
}

function hasIdentityEvidence(evidence) {
  const actor = evidence.metadata?.actor;
  return Boolean(
    typeof evidence.metadata?.identityEvidence === 'string' ||
    (typeof actor === 'object' && actor !== null && typeof actor.identityEvidence === 'string'),
  );
}

function hasAuthoritySource(evidence, policy, actorRef) {
  if (!policy?.reviewAuthority || policy.reviewAuthority === 'none') return true;
  const actor = evidence.metadata?.actor;
  return Boolean(
    typeof evidence.metadata?.authoritySource === 'string' ||
    (typeof actor === 'object' && actor !== null && typeof actor.authoritySource === 'string') ||
    actorRef === policy.reviewAuthority,
  );
}

function stringMetadata(metadata, key) {
  return typeof metadata?.[key] === 'string' ? metadata[key] : undefined;
}
