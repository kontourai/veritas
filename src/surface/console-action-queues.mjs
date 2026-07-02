export function buildConsoleActionQueues({
  claimItems,
  transparencyGapItems,
  evidenceRequirementGaps,
}) {
  return {
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
    resolveConflicts: transparencyGapItems.filter((item) => item.type === 'contradiction'),
    strengthenEvidence: evidenceRequirementGaps,
  };
}

export function claimQueueItem(claim) {
  const item = {
    claimId: claim.id,
    facet: claim.facet,
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

export function transparencyGapQueueItem(transparencyGap) {
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
