import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';

const CONSOLE_DIR = '.surface/runs';

export function buildSurfaceConsoleReadModel(record, {
  evidenceArtifactPath,
  claimInputPaths = [],
} = {}) {
  const input = record.surface?.input;
  const report = record.surface?.report;
  if (!input || !report) {
    throw new Error('Surface console read model requires record.surface.input and record.surface.report.');
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

function buildSurfaceCompatibleAnalyticsProjection({ input, report, claims }) {
  const claimItems = claims.map((claim) => claimQueueItem(claim));
  const transparencyGapItems = (report.transparencyGaps ?? []).map((transparencyGap) => transparencyGapQueueItem(transparencyGap));
  const evidenceGaps = buildEvidenceGaps({ claims, transparencyGaps: report.transparencyGaps ?? [] });
  const attestationValidity = buildAttestationValidityProjection({ input, claims, generatedAt: report.generatedAt });
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
      byType: report.summary?.transparencyGapsByType ?? countBy(report.transparencyGaps, (transparencyGap) => transparencyGap.type ?? 'unknown'),
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
      if (!hasIdentityEvidence(evidence)) gaps.push('attestation_identity_unverified');
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

export function writeSurfaceConsoleReadModel(record, rootDir, options = {}) {
  const readModel = buildSurfaceConsoleReadModel(record, options);
  const consoleDir = resolve(rootDir, CONSOLE_DIR);
  mkdirSync(consoleDir, { recursive: true });
  const path = resolve(consoleDir, `${record.run_id}.console.json`);
  writeFileSync(path, `${JSON.stringify(readModel, null, 2)}\n`, 'utf8');
  const indexPath = resolve(consoleDir, 'latest.json');
  writeFileSync(indexPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: 'surface-console-index',
    latestRunId: record.run_id,
    readModelPath: relativeRepoPath(rootDir, path),
    evidenceArtifactPath: options.evidenceArtifactPath ?? null,
    updatedAt: record.timestamp,
  }, null, 2)}\n`, 'utf8');
  return relativeRepoPath(rootDir, path);
}

/**
 * Patches the standardsFeedbackSummary field in an existing run snapshot.
 * Called by generateStandardsFeedbackRecord after the standards feedback record is written.
 */
export function updateRunStandardsFeedbackSummary(rootDir, runId, standardsFeedbackSummary) {
  const runPath = resolve(rootDir, CONSOLE_DIR, `${runId}.console.json`);
  if (!existsSync(runPath)) return false;
  try {
    const data = JSON.parse(readFileSync(runPath, 'utf8'));
    data.standardsFeedbackSummary = standardsFeedbackSummary;
    writeFileSync(runPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function buildConsoleGraph({ claims, evidence, events, policiesById, transparencyGaps }) {
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

  for (const transparencyGap of transparencyGaps) {
    addNode({ id: `transparency-gap:${transparencyGap.id}`, kind: 'transparency-gap', label: transparencyGap.type, severity: transparencyGap.severity });
    addEdge({ from: `transparency-gap:${transparencyGap.id}`, to: transparencyGap.claimId, kind: 'flags' });
  }

  return {
    nodes: [...nodes.values()],
    edges,
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
