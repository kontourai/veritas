export const APPROVAL_REF_POLICY_MODES = [
  'reference-only',
  'prefix',
  'resolved',
  'resolved-strict',
];

export const APPROVAL_RESOLUTION_STATUSES = [
  'approved',
  'rejected',
  'unresolved',
  'expired',
  'out-of-scope',
  'error',
];

export function normalizeApprovalRefPolicy(policy = {}) {
  const mode = policy.mode ?? 'reference-only';
  if (!APPROVAL_REF_POLICY_MODES.includes(mode)) {
    throw new Error(`Unsupported attestation approval reference policy mode: ${mode}`);
  }
  const allowedPrefixes = Array.isArray(policy.allowed_prefixes)
    ? policy.allowed_prefixes.filter((prefix) => typeof prefix === 'string' && prefix.length > 0)
    : [];
  return {
    mode,
    allowedPrefixes,
    requiresResolution: mode === 'resolved' || mode === 'resolved-strict',
    strict: mode === 'resolved-strict',
  };
}

export function buildApprovalResolverRequest({
  approvalRef,
  attestationKind,
  actor,
  repo,
  protectedStandards,
  requestedAt,
} = {}) {
  if (typeof approvalRef !== 'string' || !approvalRef.trim()) {
    throw new Error('approval resolver request requires approvalRef');
  }
  if (!attestationKind) {
    throw new Error('approval resolver request requires attestationKind');
  }
  return {
    schemaVersion: 1,
    approvalRef: approvalRef.trim(),
    attestationKind,
    actor: actor ?? null,
    repo: repo ?? null,
    protectedStandards: protectedStandards ?? null,
    requestedAt: requestedAt ?? new Date().toISOString(),
  };
}

export function normalizeApprovalResolverResult(result = {}, options = {}) {
  const status = result.status ?? 'unresolved';
  if (!APPROVAL_RESOLUTION_STATUSES.includes(status)) {
    throw new Error(`Unsupported approval resolver status: ${status}`);
  }
  const resolvedAt = result.resolvedAt ?? options.resolvedAt ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    status,
    approved: status === 'approved',
    approvalRef: result.approvalRef ?? null,
    provider: result.provider ?? null,
    authorityRef: result.authorityRef ?? null,
    approvedBy: result.approvedBy ?? null,
    approvedAt: result.approvedAt ?? null,
    expiresAt: result.expiresAt ?? null,
    scope: result.scope ?? null,
    evidenceHash: result.evidenceHash ?? null,
    resolvedAt,
    failureReason: status === 'approved' ? null : result.failureReason ?? 'approval reference was not approved',
    metadata: result.metadata ?? {},
  };
}

export function isApprovalResolverResultAccepted(result = {}, options = {}) {
  const normalized = normalizeApprovalResolverResult(result, options);
  if (!normalized.approved) return false;
  if (!normalized.expiresAt) return true;
  const now = new Date(options.now ?? normalized.resolvedAt).getTime();
  return new Date(normalized.expiresAt).getTime() > now;
}

export function approvalResolverRejectionReason(result = {}, options = {}) {
  const normalized = normalizeApprovalResolverResult(result, options);
  if (normalized.approved && !isApprovalResolverResultAccepted(normalized, options)) {
    return 'expired';
  }
  return normalized.status;
}

export function summarizeApprovalResolverResult(result = {}, options = {}) {
  const normalized = normalizeApprovalResolverResult(result, options);
  return {
    schemaVersion: normalized.schemaVersion,
    status: normalized.status,
    approved: normalized.approved,
    approvalRef: normalized.approvalRef,
    provider: normalized.provider,
    authorityRef: normalized.authorityRef,
    approvedBy: normalized.approvedBy,
    approvedAt: normalized.approvedAt,
    expiresAt: normalized.expiresAt,
    scope: normalized.scope,
    evidenceHash: normalized.evidenceHash,
    resolvedAt: normalized.resolvedAt,
    failureReason: normalized.failureReason,
  };
}
