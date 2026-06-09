export function buildSurfaceCompatibleAnalyticsProjection({ input, report, claims }) {
  const claimItems = claims.map((claim) => claimQueueItem(claim));
  const transparencyGapItems = (report.transparencyGaps ?? []).map((transparencyGap) =>
    transparencyGapQueueItem(transparencyGap)
  );
  const evidenceGaps = buildEvidenceGaps({
    claims,
    transparencyGaps: report.transparencyGaps ?? [],
  });
  const attestationValidity = buildAttestationValidityProjection({
    input,
    claims,
    generatedAt: report.generatedAt,
  });
  const attestationGaps = buildAttestationGaps({ attestationValidity, claims });
  const evidenceRequirementGaps = sortGaps([...evidenceGaps, ...attestationGaps]);
  const resolveConflicts = transparencyGapItems.filter((item) => item.type === 'contradiction');
  return {
    reportId: report.id,
    generatedAt: report.generatedAt,
    source: report.source,
    totals: {
      claims: claims.length,
      evidence: input.evidence.length,
      policies: input.policies.length,
      events: input.events.length,
      transparencyGaps: report.transparencyGaps.length,
    },
    coverageBySurface: buildCoverageBySurface(claims),
    staleClaims: claimItems.filter((item) => item.status === 'stale'),
    disputedClaims: claimItems.filter((item) => item.status === 'disputed'),
    highImpactUnsupportedClaims: claimItems.filter((item) =>
      (item.impactLevel === 'high' || item.impactLevel === 'critical') &&
      (item.status === 'unknown' || item.status === 'proposed')
    ),
    transparencyGaps: {
      byType:
        report.summary?.transparencyGapsByType ??
        countBy(report.transparencyGaps, (transparencyGap) => transparencyGap.type ?? 'unknown'),
      bySeverity: countTransparencyGapsBySeverity(report.transparencyGaps ?? []),
      items: transparencyGapItems,
    },
    evidenceGaps,
    evidenceRequirementGaps,
    confidenceBasis: report.summary?.confidenceBasis ?? {},
    actionQueues: {
      reviewNow: claimItems.filter((item) =>
        item.status === 'disputed' ||
        ((item.impactLevel === 'high' || item.impactLevel === 'critical') &&
          (item.status === 'unknown' || item.status === 'proposed')) ||
        transparencyGapItems.some((transparencyGap) =>
          transparencyGap.claimId === item.claimId &&
          (transparencyGap.severity === 'high' || transparencyGap.severity === 'critical')
        )
      ),
      reverifyStale: claimItems.filter((item) => item.status === 'stale'),
      resolveConflicts,
      strengthenEvidence: evidenceRequirementGaps,
    },
    attestationValidity,
  };
}

function buildCoverageBySurface(claims) {
  const bySurface = new Map();
  for (const claim of claims) {
    const item = bySurface.get(claim.surface) ?? {
      surface: claim.surface,
      totalClaims: 0,
      verifiedClaims: 0,
      staleClaims: 0,
      disputedClaims: 0,
      unsupportedClaims: 0,
      verificationCoverage: 0,
    };
    item.totalClaims += 1;
    if (claim.status === 'verified') item.verifiedClaims += 1;
    if (claim.status === 'stale') item.staleClaims += 1;
    if (claim.status === 'disputed') item.disputedClaims += 1;
    if (claim.status === 'unknown' || claim.status === 'proposed') item.unsupportedClaims += 1;
    bySurface.set(claim.surface, item);
  }
  return [...bySurface.values()]
    .map((item) => ({
      ...item,
      verificationCoverage: item.totalClaims === 0 ? 0 : item.verifiedClaims / item.totalClaims,
    }))
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

function claimQueueItem(claim) {
  const item = {
    claimId: claim.id,
    surface: claim.surface,
    status: claim.status,
    impactLevel: claim.impactLevel ?? 'medium',
    claimType: claim.claimType,
    subject: {
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
    },
  };
  if (claim.verificationPolicyId) item.policyId = claim.verificationPolicyId;
  return item;
}

function transparencyGapQueueItem(transparencyGap) {
  const item = {
    transparencyGapId: transparencyGap.id,
    claimId: transparencyGap.claimId,
    type: transparencyGap.type,
    severity: transparencyGap.severity,
    message: transparencyGap.message,
    evidenceIds: transparencyGap.evidenceIds ?? [],
  };
  if (transparencyGap.policyId) item.policyId = transparencyGap.policyId;
  return item;
}

function buildEvidenceGaps({ claims, transparencyGaps }) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const gapTypes = new Set([
    'provenance_gap',
    'policy_violation',
    'corroboration_absent',
    'unsupported_inference',
    'freshness_breach',
  ]);
  return sortGaps(transparencyGaps
    .filter((transparencyGap) => gapTypes.has(transparencyGap.type))
    .map((transparencyGap) => {
      const claim = claimsById.get(transparencyGap.claimId);
      const gap = {
        claimId: transparencyGap.claimId,
        surface: claim?.surface ?? 'unknown',
        impactLevel: claim?.impactLevel ?? transparencyGap.severity,
        gapType: transparencyGap.type,
        message: transparencyGap.message,
        evidenceIds: transparencyGap.evidenceIds ?? [],
      };
      if (transparencyGap.policyId) gap.policyId = transparencyGap.policyId;
      return gap;
    }));
}

function buildAttestationValidityProjection({ input, claims, generatedAt }) {
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

function buildAttestationGaps({ attestationValidity, claims }) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  return sortGaps(attestationValidity.items.flatMap((item) => {
    const claim = claimsById.get(item.claimId);
    return item.gaps.map((gapType) => ({
      claimId: item.claimId,
      surface: claim?.surface ?? 'unknown',
      impactLevel: claim?.impactLevel ?? 'medium',
      gapType,
      message: attestationGapMessage(gapType, item),
      ...(claim?.verificationPolicyId ? { policyId: claim.verificationPolicyId } : {}),
      evidenceIds: [item.evidenceId],
    }));
  }));
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

function sortGaps(gaps) {
  const impactRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...gaps].sort((a, b) => {
    const impact = (impactRank[a.impactLevel] ?? 4) - (impactRank[b.impactLevel] ?? 4);
    if (impact !== 0) return impact;
    return a.claimId.localeCompare(b.claimId) || a.gapType.localeCompare(b.gapType);
  });
}

function countTransparencyGapsBySeverity(transparencyGaps) {
  return {
    low: transparencyGaps.filter((item) => item.severity === 'low').length,
    medium: transparencyGaps.filter((item) => item.severity === 'medium').length,
    high: transparencyGaps.filter((item) => item.severity === 'high').length,
    critical: transparencyGaps.filter((item) => item.severity === 'critical').length,
  };
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFn(item) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
