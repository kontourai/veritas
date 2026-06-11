import { buildSurfaceCompatibleAnalyticsProjection } from './console-analytics.mjs';
import { buildConsoleGraph } from './console-graph.mjs';

export function buildSurfaceConsoleReadModel(record, {
  evidenceArtifactPath,
  claimInputPaths = [],
} = {}) {
  const input = record.trust?.bundle;
  const report = record.trust?.report;
  if (!input || !report) {
    throw new Error('Surface console read model requires record.trust.bundle and record.trust.report.');
  }

  const reportClaimsById = new Map((report.claims ?? []).map((claim) => [claim.id, claim]));
  const evidenceByClaimId = groupBy(input.evidence ?? [], (item) => item.claimId);
  const eventsByClaimId = groupBy(input.events ?? [], (item) => item.claimId);
  const transparencyGapsByClaimId = new Map(Object.entries(report.transparencyGapsByClaimId ?? {}));
  const policiesById = new Map((input.policies ?? []).map((policy) => [policy.id, policy]));

  const claims = (input.claims ?? []).map((claim) => {
    const reportClaim = reportClaimsById.get(claim.id);
    const evidence = evidenceByClaimId.get(claim.id) ?? [];
    const events = eventsByClaimId.get(claim.id) ?? [];
    const transparencyGaps = transparencyGapsByClaimId.get(claim.id) ?? [];
    const status = reportClaim?.status ?? claim.status ?? 'unknown';
    return {
      id: claim.id,
      status,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      surface: claim.surface,
      domain: consoleDomainForClaim(claim),
      claimType: claim.claimType,
      fieldOrBehavior: claim.fieldOrBehavior,
      value: claim.value,
      verificationPolicyId: claim.verificationPolicyId,
      impactLevel: claim.impactLevel ?? claim.confidenceBasis?.impactLevel ?? null,
      reviewerAuthority: claim.confidenceBasis?.reviewerAuthority ?? null,
      evidenceStrength: claim.confidenceBasis?.evidenceStrength ?? null,
      sourceQuality: claim.confidenceBasis?.sourceQuality ?? null,
      confidenceBasis: claim.confidenceBasis ?? null,
      currentIntegrityRef: claim.currentIntegrityRef ?? null,
      derivedFrom: claim.derivedFrom ?? [],
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      evidenceIds: evidence.map((item) => item.id),
      eventIds: events.map((item) => item.id),
      transparencyGapIds: transparencyGaps.map((item) => item.id),
      transparencyGapTypes: uniqueStrings(transparencyGaps.map((item) => item.type).filter(Boolean)),
      evidenceTypes: uniqueStrings(evidence.map((item) => item.evidenceType).filter(Boolean)),
      evidenceMethods: uniqueStrings(evidence.map((item) => item.method).filter(Boolean)),
      latestEventStatus: events.at(-1)?.status ?? null,
      metadata: claim.metadata ?? {},
    };
  });

  const policySummaries = (input.policies ?? []).map((policy) => {
    const policyClaims = claims.filter((claim) => claim.verificationPolicyId === policy.id);
    const policyTransparencyGaps = policyClaims.flatMap((claim) => transparencyGapsByClaimId.get(claim.id) ?? []);
    return {
      id: policy.id,
      claimType: policy.claimType,
      requiredEvidence: policy.requiredEvidence ?? [],
      requiredMethods: policy.requiredMethods ?? [],
      reviewAuthority: policy.reviewAuthority ?? null,
      validityRule: policy.validityRule ?? null,
      impactLevel: policy.impactLevel ?? null,
      claimCount: policyClaims.length,
      statusCounts: countBy(policyClaims, (claim) => claim.status),
      transparencyGapCounts: countBy(policyTransparencyGaps, (transparencyGap) => transparencyGap.type ?? 'unknown'),
    };
  });

  return {
    schemaVersion: 1,
    kind: 'surface-console-read-model',
    contract: 'surface.analytics-compatible',
    generatedAt: record.timestamp,
    source: input.source,
    producer: {
      name: 'veritas',
      runId: record.run_id,
      sourceRef: record.source_ref,
      sourceKind: record.source_kind,
      sourceScope: record.source_scope,
      evidenceArtifactPath: evidenceArtifactPath ?? null,
      claimInputPaths,
    },
    summary: {
      claimCount: claims.length,
      evidenceCount: input.evidence.length,
      policyCount: input.policies.length,
      eventCount: input.events.length,
      transparencyGapCount: report.transparencyGaps.length,
      statusCounts: countBy(claims, (claim) => claim.status),
      claimTypeCounts: countBy(claims, (claim) => claim.claimType),
      surfaceCounts: countBy(claims, (claim) => claim.surface),
      domainCounts: countBy(claims, (claim) => claim.domain),
      policyCounts: countBy(claims, (claim) => claim.verificationPolicyId ?? 'none'),
      evidenceTypeCounts: countBy(input.evidence, (item) => item.evidenceType ?? 'unknown'),
      evidenceMethodCounts: countBy(input.evidence, (item) => item.method ?? 'unknown'),
      reviewerAuthorityCounts: countBy(claims, (claim) => claim.reviewerAuthority ?? 'unknown'),
      impactLevelCounts: countBy(claims, (claim) => claim.impactLevel ?? 'unknown'),
      transparencyGapTypeCounts: countBy(report.transparencyGaps, (transparencyGap) => transparencyGap.type ?? 'unknown'),
      attentionClaimIds: claims
        .filter((claim) => ['stale', 'disputed', 'rejected', 'unknown'].includes(claim.status))
        .map((claim) => claim.id),
    },
    analytics: buildSurfaceCompatibleAnalyticsProjection({
      input,
      report,
      claims,
    }),
    standardsFeedbackSummary: null,
    claims,
    policies: policySummaries,
    evidence: input.evidence,
    events: input.events,
    transparencyGaps: report.transparencyGaps,
    graph: buildConsoleGraph({ claims: input.claims, evidence: input.evidence, events: input.events, policiesById, transparencyGaps: report.transparencyGaps }),
  };
}

function consoleDomainForClaim(claim) {
  if (typeof claim.metadata?.domain === 'string') return claim.metadata.domain;
  if (typeof claim.surface === 'string' && claim.surface.includes('.')) {
    return claim.surface.split('.').at(0);
  }
  return claim.surface ?? 'unknown';
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item) ?? 'unknown';
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  return grouped;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = String(keyFn(item) ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)))].sort();
}
