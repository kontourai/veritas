import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';
import { resolveRunArtifactPath } from '../util/run-id.mjs';
import { buildSurfaceCompatibleAnalyticsProjection } from './console-analytics.mjs';
import { buildConsoleGraph } from './console-graph.mjs';

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

export function writeSurfaceConsoleReadModel(record, rootDir, options = {}) {
  const readModel = buildSurfaceConsoleReadModel(record, options);
  const consoleDir = resolve(rootDir, CONSOLE_DIR);
  mkdirSync(consoleDir, { recursive: true });
  const path = resolveRunArtifactPath({
    dir: consoleDir,
    runId: record.run_id,
    suffix: '.console.json',
    label: 'Surface console run id',
  });
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
  const runPath = resolveRunArtifactPath({
    dir: resolve(rootDir, CONSOLE_DIR),
    runId,
    suffix: '.console.json',
    label: 'Surface console run id',
  });
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
