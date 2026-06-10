import {
  buildConsoleActionQueues,
  claimQueueItem,
  transparencyGapQueueItem,
} from './console-action-queues.mjs';
import {
  buildAttestationGaps,
  buildAttestationValidityProjection,
  sortGaps,
} from './console-attestations.mjs';
import {
  buildEvidenceGaps,
  countBy,
  countTransparencyGapsBySeverity,
} from './console-gaps.mjs';

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
    actionQueues: buildConsoleActionQueues({
      claimItems,
      transparencyGapItems,
      evidenceRequirementGaps,
    }),
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
