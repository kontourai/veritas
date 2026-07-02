import * as Surface from '@kontourai/surface';
import { surfaceSafeId } from './primitives.mjs';

export function buildSurfaceTrustReportSummary({ input, record }) {
  const report = Surface.buildTrustReport(input, {
    id: `veritas.${surfaceSafeId(record.run_id)}.surface-report`,
    now: new Date(record.timestamp),
  });
  return summarizeSurfaceTrustReport(report);
}

export function summarizeSurfaceTrustReport(report) {
  const transparencyGapsByClaimId = new Map();
  for (const transparencyGap of report.transparencyGaps ?? []) {
    const entries = transparencyGapsByClaimId.get(transparencyGap.claimId) ?? [];
    entries.push({
      id: transparencyGap.id,
      type: transparencyGap.type,
      severity: transparencyGap.severity,
      message: transparencyGap.message,
      policyId: transparencyGap.policyId,
    });
    transparencyGapsByClaimId.set(transparencyGap.claimId, entries);
  }
  return {
    id: report.id,
    generatedAt: report.generatedAt,
    source: report.source,
    summary: report.summary,
    claims: report.claims.map((claim) => ({
      id: claim.id,
      status: claim.status,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      facet: claim.facet,
      claimType: claim.claimType,
      fieldOrBehavior: claim.fieldOrBehavior,
      value: claim.value,
      verificationPolicyId: claim.verificationPolicyId,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      currentIntegrityRef: claim.currentIntegrityRef,
    })),
    transparencyGaps: report.transparencyGaps.map((transparencyGap) => ({
      id: transparencyGap.id,
      claimId: transparencyGap.claimId,
      type: transparencyGap.type,
      severity: transparencyGap.severity,
      message: transparencyGap.message,
      policyId: transparencyGap.policyId,
      createdAt: transparencyGap.createdAt,
      evidenceIds: transparencyGap.evidenceIds,
    })),
    transparencyGapsByClaimId: Object.fromEntries(transparencyGapsByClaimId.entries()),
    claimGroupRollups: report.claimGroupRollups ?? [],
  };
}
