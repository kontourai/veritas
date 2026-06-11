import { sortGaps } from './console-attestations.mjs';

export function buildEvidenceGaps({ claims, transparencyGaps }) {
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

export function countTransparencyGapsBySeverity(transparencyGaps) {
  return {
    low: transparencyGaps.filter((item) => item.severity === 'low').length,
    medium: transparencyGaps.filter((item) => item.severity === 'medium').length,
    high: transparencyGaps.filter((item) => item.severity === 'high').length,
    critical: transparencyGaps.filter((item) => item.severity === 'critical').length,
  };
}

export function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFn(item) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
