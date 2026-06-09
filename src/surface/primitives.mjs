import {
  SURFACE_SUPPORTS_EVIDENCE_EVALUATION,
  SURFACE_SUPPORTS_EVIDENCE_EXECUTION,
} from './capabilities.mjs';

export function surfaceEvidence({ id, claimId, type, method, record, locator, summary, passing, blocking, metadata = {}, execution }) {
  const evidenceIntegrity = metadata.fileIntegrity
    ? { ...(record.integrity ?? {}), fileRefs: metadata.fileIntegrity }
    : record.integrity;
  return {
    id,
    claimId,
    evidenceType: type,
    method,
    sourceRef: record.run_id,
    sourceLocator: locator,
    excerptOrSummary: summary,
    observedAt: record.timestamp,
    collectedBy: 'veritas',
    integrityRef: record.integrity?.sourceRef ?? record.source_ref,
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof passing === 'boolean' ? { passing } : {}),
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof blocking === 'boolean' ? { blocking } : {}),
    ...(SURFACE_SUPPORTS_EVIDENCE_EXECUTION && execution ? { execution } : {}),
    metadata: {
      sourceKind: record.source_kind,
      sourceScope: record.source_scope,
      files: record.files ?? [],
      unresolvedFiles: record.unresolved_files ?? [],
      integrity: evidenceIntegrity ?? null,
      fileIntegrity: metadata.fileIntegrity ?? record.integrity?.fileRefs ?? [],
      configIntegrity: record.integrity?.configRefs ?? {},
      ...metadata,
    },
  };
}

export function surfaceEvent({ id, claimId, status, method, evidenceIds, record, notes, verifiedAt }) {
  return {
    id,
    claimId,
    status,
    actor: 'veritas',
    method,
    evidenceIds,
    createdAt: record.timestamp,
    verifiedAt: status === 'verified' ? (verifiedAt ?? record.timestamp) : undefined,
    notes,
  };
}

export function surfaceClaimId(runId, group, value) {
  return `veritas.${surfaceSafeId(runId)}.${group}.${surfaceSafeId(value)}`;
}

export function policyResultClaimId(record, ruleId) {
  return [
    'veritas',
    'policy',
    surfaceSafeId(record.repo_map?.name ?? 'repo-map'),
    surfaceSafeId(record.repo_standards?.name ?? 'repo-standards'),
    surfaceSafeId(ruleId),
  ].join('.');
}

export function surfaceSafeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}
