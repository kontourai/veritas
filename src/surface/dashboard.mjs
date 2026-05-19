import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';

const DASHBOARD_DIR = '.veritas/surface-dashboard';

export function buildSurfaceDashboardReadModel(record, {
  evidenceArtifactPath,
  claimInputPaths = [],
} = {}) {
  const input = record.surface?.input;
  const report = record.surface?.report;
  if (!input || !report) {
    throw new Error('Surface dashboard read model requires record.surface.input and record.surface.report.');
  }

  const reportClaimsById = new Map((report.claims ?? []).map((claim) => [claim.id, claim]));
  const evidenceByClaimId = groupBy(input.evidence ?? [], (item) => item.claimId);
  const eventsByClaimId = groupBy(input.events ?? [], (item) => item.claimId);
  const faultLinesByClaimId = new Map(Object.entries(report.faultLinesByClaimId ?? {}));
  const policiesById = new Map((input.policies ?? []).map((policy) => [policy.id, policy]));

  const claims = (input.claims ?? []).map((claim) => {
    const reportClaim = reportClaimsById.get(claim.id);
    const evidence = evidenceByClaimId.get(claim.id) ?? [];
    const events = eventsByClaimId.get(claim.id) ?? [];
    const faultLines = faultLinesByClaimId.get(claim.id) ?? [];
    const status = reportClaim?.status ?? claim.status ?? 'unknown';
    return {
      id: claim.id,
      status,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      surface: claim.surface,
      domain: dashboardDomainForClaim(claim),
      claimType: claim.claimType,
      fieldOrBehavior: claim.fieldOrBehavior,
      value: claim.value,
      verificationPolicyId: claim.verificationPolicyId,
      impactLevel: claim.impactLevel ?? claim.confidenceBasis?.impactLevel ?? null,
      reviewerAuthority: claim.confidenceBasis?.reviewerAuthority ?? null,
      proofStrength: claim.confidenceBasis?.proofStrength ?? null,
      sourceQuality: claim.confidenceBasis?.sourceQuality ?? null,
      confidenceBasis: claim.confidenceBasis ?? null,
      currentIntegrityRef: claim.currentIntegrityRef ?? null,
      derivedFrom: claim.derivedFrom ?? [],
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      evidenceIds: evidence.map((item) => item.id),
      eventIds: events.map((item) => item.id),
      faultLineIds: faultLines.map((item) => item.id),
      faultLineTypes: uniqueStrings(faultLines.map((item) => item.type).filter(Boolean)),
      evidenceTypes: uniqueStrings(evidence.map((item) => item.evidenceType).filter(Boolean)),
      evidenceMethods: uniqueStrings(evidence.map((item) => item.method).filter(Boolean)),
      latestEventStatus: events.at(-1)?.status ?? null,
      metadata: claim.metadata ?? {},
    };
  });

  const policySummaries = (input.policies ?? []).map((policy) => {
    const policyClaims = claims.filter((claim) => claim.verificationPolicyId === policy.id);
    const policyFaultLines = policyClaims.flatMap((claim) => faultLinesByClaimId.get(claim.id) ?? []);
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
      faultLineCounts: countBy(policyFaultLines, (faultLine) => faultLine.type ?? 'unknown'),
    };
  });

  return {
    schemaVersion: 1,
    kind: 'surface-dashboard-read-model',
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
      faultLineCount: report.faultLines.length,
      statusCounts: countBy(claims, (claim) => claim.status),
      claimTypeCounts: countBy(claims, (claim) => claim.claimType),
      surfaceCounts: countBy(claims, (claim) => claim.surface),
      domainCounts: countBy(claims, (claim) => claim.domain),
      policyCounts: countBy(claims, (claim) => claim.verificationPolicyId ?? 'none'),
      evidenceTypeCounts: countBy(input.evidence, (item) => item.evidenceType ?? 'unknown'),
      evidenceMethodCounts: countBy(input.evidence, (item) => item.method ?? 'unknown'),
      reviewerAuthorityCounts: countBy(claims, (claim) => claim.reviewerAuthority ?? 'unknown'),
      impactLevelCounts: countBy(claims, (claim) => claim.impactLevel ?? 'unknown'),
      faultLineTypeCounts: countBy(report.faultLines, (faultLine) => faultLine.type ?? 'unknown'),
      attentionClaimIds: claims
        .filter((claim) => ['stale', 'disputed', 'rejected', 'unknown'].includes(claim.status))
        .map((claim) => claim.id),
    },
    analytics: buildSurfaceCompatibleAnalyticsProjection({
      input,
      report,
      claims,
    }),
    claims,
    policies: policySummaries,
    evidence: input.evidence,
    events: input.events,
    faultLines: report.faultLines,
    graph: buildDashboardGraph({ claims: input.claims, evidence: input.evidence, events: input.events, policiesById, faultLines: report.faultLines }),
  };
}

function buildSurfaceCompatibleAnalyticsProjection({ input, report, claims }) {
  const claimItems = claims.map((claim) => claimQueueItem(claim));
  const faultLineItems = (report.faultLines ?? []).map((faultLine) => faultLineQueueItem(faultLine));
  const evidenceGaps = buildEvidenceGaps({ claims, faultLines: report.faultLines ?? [] });
  const attestationValidity = buildAttestationValidityProjection({ input, claims, generatedAt: report.generatedAt });
  const attestationGaps = buildAttestationGaps({ attestationValidity, claims });
  const proofRequirementGaps = sortGaps([...evidenceGaps, ...attestationGaps]);
  const resolveConflicts = faultLineItems.filter((item) => item.type === 'contradiction');
  return {
    reportId: report.id,
    generatedAt: report.generatedAt,
    source: report.source,
    totals: {
      claims: claims.length,
      evidence: input.evidence.length,
      policies: input.policies.length,
      events: input.events.length,
      faultLines: report.faultLines.length,
    },
    coverageBySurface: buildCoverageBySurface(claims),
    staleClaims: claimItems.filter((item) => item.status === 'stale'),
    disputedClaims: claimItems.filter((item) => item.status === 'disputed'),
    highImpactUnsupportedClaims: claimItems.filter((item) =>
      (item.impactLevel === 'high' || item.impactLevel === 'critical') &&
      (item.status === 'unknown' || item.status === 'proposed')
    ),
    faultLines: {
      byType: report.summary?.faultLinesByType ?? countBy(report.faultLines, (faultLine) => faultLine.type ?? 'unknown'),
      bySeverity: countFaultLinesBySeverity(report.faultLines ?? []),
      items: faultLineItems,
    },
    evidenceGaps,
    proofRequirementGaps,
    confidenceBasis: report.summary?.confidenceBasis ?? {},
    actionQueues: {
      reviewNow: claimItems.filter((item) =>
        item.status === 'disputed' ||
        ((item.impactLevel === 'high' || item.impactLevel === 'critical') &&
          (item.status === 'unknown' || item.status === 'proposed')) ||
        faultLineItems.some((faultLine) =>
          faultLine.claimId === item.claimId &&
          (faultLine.severity === 'high' || faultLine.severity === 'critical')
        )
      ),
      reverifyStale: claimItems.filter((item) => item.status === 'stale'),
      resolveConflicts,
      strengthenEvidence: proofRequirementGaps,
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

function faultLineQueueItem(faultLine) {
  const item = {
    faultLineId: faultLine.id,
    claimId: faultLine.claimId,
    type: faultLine.type,
    severity: faultLine.severity,
    message: faultLine.message,
    evidenceIds: faultLine.evidenceIds ?? [],
  };
  if (faultLine.policyId) item.policyId = faultLine.policyId;
  return item;
}

function buildEvidenceGaps({ claims, faultLines }) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const gapTypes = new Set([
    'provenance_gap',
    'policy_violation',
    'corroboration_absent',
    'unsupported_inference',
    'freshness_breach',
  ]);
  return sortGaps(faultLines
    .filter((faultLine) => gapTypes.has(faultLine.type))
    .map((faultLine) => {
      const claim = claimsById.get(faultLine.claimId);
      const gap = {
        claimId: faultLine.claimId,
        surface: claim?.surface ?? 'unknown',
        impactLevel: claim?.impactLevel ?? faultLine.severity,
        gapType: faultLine.type,
        message: faultLine.message,
        evidenceIds: faultLine.evidenceIds ?? [],
      };
      if (faultLine.policyId) gap.policyId = faultLine.policyId;
      return gap;
    }));
}

function buildAttestationValidityProjection({ input, claims, generatedAt }) {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const policiesById = new Map(input.policies.map((policy) => [policy.id, policy]));
  const items = input.evidence
    .filter((evidence) => evidence.method === 'attestation' || evidence.evidenceType === 'attestation' || evidence.evidenceType === 'human_attestation')
    .map((evidence) => {
      const claim = claimsById.get(evidence.claimId);
      const policy = policiesById.get(claim?.verificationPolicyId);
      const actorRef = actorRefForEvidence(evidence);
      const validUntil = stringMetadata(evidence.metadata, 'validUntil');
      const revokedAt = stringMetadata(evidence.metadata, 'revokedAt');
      const integrityRef = evidence.integrityRef ?? stringMetadata(evidence.metadata, 'contentHash');
      const gaps = [];
      if (!actorRef) gaps.push('attestation_actor_missing');
      if (!hasIdentityProof(evidence)) gaps.push('attestation_identity_unverified');
      if (!hasAuthoritySource(evidence, policy, actorRef)) gaps.push('attestation_authority_unverified');
      if (!integrityRef) gaps.push('attestation_integrity_missing');
      if (validUntil && new Date(validUntil).getTime() < new Date(generatedAt).getTime()) gaps.push('attestation_expired');
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
  if (gapType === 'attestation_identity_unverified') return `Attestation ${item.evidenceId} has no identity proof reference.`;
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

function countFaultLinesBySeverity(faultLines) {
  return {
    low: faultLines.filter((item) => item.severity === 'low').length,
    medium: faultLines.filter((item) => item.severity === 'medium').length,
    high: faultLines.filter((item) => item.severity === 'high').length,
    critical: faultLines.filter((item) => item.severity === 'critical').length,
  };
}

function actorRefForEvidence(evidence) {
  const actor = evidence.metadata?.actor;
  if (typeof actor === 'object' && actor !== null && typeof actor.id === 'string') return actor.id;
  if (typeof evidence.metadata?.actorRef === 'string') return evidence.metadata.actorRef;
  if (typeof evidence.collectedBy === 'string' && evidence.collectedBy !== 'veritas') return evidence.collectedBy;
  return undefined;
}

function hasIdentityProof(evidence) {
  const actor = evidence.metadata?.actor;
  return Boolean(
    typeof evidence.metadata?.identityProof === 'string' ||
    (typeof actor === 'object' && actor !== null && typeof actor.identityProof === 'string'),
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

export function writeSurfaceDashboardReadModel(record, rootDir, options = {}) {
  const readModel = buildSurfaceDashboardReadModel(record, options);
  const dashboardDir = resolve(rootDir, DASHBOARD_DIR);
  mkdirSync(dashboardDir, { recursive: true });
  const path = resolve(dashboardDir, `${record.run_id}.dashboard.json`);
  writeFileSync(path, `${JSON.stringify(readModel, null, 2)}\n`, 'utf8');
  const indexPath = resolve(dashboardDir, 'latest.json');
  writeFileSync(indexPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: 'surface-dashboard-index',
    latestRunId: record.run_id,
    readModelPath: relativeRepoPath(rootDir, path),
    evidenceArtifactPath: options.evidenceArtifactPath ?? null,
    updatedAt: record.timestamp,
  }, null, 2)}\n`, 'utf8');
  return relativeRepoPath(rootDir, path);
}

function buildDashboardGraph({ claims, evidence, events, policiesById, faultLines }) {
  const nodes = new Map();
  const edges = [];
  const addNode = (node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge) => {
    edges.push(edge);
  };

  for (const claim of claims) {
    addNode({ id: claim.id, kind: 'claim', label: claim.fieldOrBehavior, claimType: claim.claimType });
    addNode({ id: `subject:${claim.subjectType}:${claim.subjectId}`, kind: 'subject', label: claim.subjectId, subjectType: claim.subjectType });
    addEdge({ from: claim.id, to: `subject:${claim.subjectType}:${claim.subjectId}`, kind: 'about' });
    if (claim.verificationPolicyId) {
      addNode({ id: `policy:${claim.verificationPolicyId}`, kind: 'policy', label: claim.verificationPolicyId, claimType: policiesById.get(claim.verificationPolicyId)?.claimType ?? null });
      addEdge({ from: `policy:${claim.verificationPolicyId}`, to: claim.id, kind: 'validates' });
    }
    for (const parentId of claim.derivedFrom ?? []) {
      addEdge({ from: claim.id, to: parentId, kind: 'derived-from' });
    }
  }

  for (const item of evidence) {
    addNode({ id: `evidence:${item.id}`, kind: 'evidence', label: item.evidenceType, method: item.method });
    addEdge({ from: `evidence:${item.id}`, to: item.claimId, kind: 'supports' });
  }

  for (const event of events) {
    addNode({ id: `event:${event.id}`, kind: 'event', label: event.status, method: event.method });
    addEdge({ from: `event:${event.id}`, to: event.claimId, kind: 'updates-status' });
  }

  for (const faultLine of faultLines) {
    addNode({ id: `fault-line:${faultLine.id}`, kind: 'fault-line', label: faultLine.type, severity: faultLine.severity });
    addEdge({ from: `fault-line:${faultLine.id}`, to: faultLine.claimId, kind: 'flags' });
  }

  return {
    nodes: [...nodes.values()],
    edges,
  };
}

function dashboardDomainForClaim(claim) {
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
