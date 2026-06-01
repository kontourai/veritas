import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from './paths.mjs';

const OFFLINE_APPROVAL_RECORDS_DIR = '.veritas/authority/approval-records';
const VERITAS_APPROVAL_REF_PREFIX = 'veritas-approval:';
const FILE_APPROVAL_REF_PREFIX = 'file:';

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

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function approvalRecordsDir(rootDir) {
  return resolve(rootDir, OFFLINE_APPROVAL_RECORDS_DIR);
}

function resolveOfflineApprovalRecordPath(rootDir, approvalRef) {
  const recordsDir = approvalRecordsDir(rootDir);
  if (approvalRef.startsWith(VERITAS_APPROVAL_REF_PREFIX)) {
    const id = approvalRef.slice(VERITAS_APPROVAL_REF_PREFIX.length).trim();
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new Error('veritas approval references must use an id containing only letters, numbers, dot, underscore, or dash');
    }
    return resolve(recordsDir, `${id}.approval.json`);
  }

  if (approvalRef.startsWith(FILE_APPROVAL_REF_PREFIX)) {
    const filePath = approvalRef.slice(FILE_APPROVAL_REF_PREFIX.length).trim();
    if (!filePath) {
      throw new Error('file approval references require a repo-local path');
    }
    const resolvedPath = resolve(rootDir, filePath);
    assertWithinDir(
      resolvedPath,
      recordsDir,
      `approval record path must stay inside ${OFFLINE_APPROVAL_RECORDS_DIR}`,
    );
    return resolvedPath;
  }

  return null;
}

function scopeContains(scope, key, value) {
  const values = scope?.[key];
  return !Array.isArray(values) || values.length === 0 || values.includes(value);
}

function scopeHashMatches(scope, key, value) {
  const expected = scope?.protectedStandardsHashes?.[key];
  return !expected || expected === value;
}

function evaluateOfflineApprovalRecordScope(record, request) {
  const scope = record.scope ?? {};
  if (!scopeContains(scope, 'attestationKinds', request.attestationKind)) {
    return `approval is not scoped for ${request.attestationKind} attestations`;
  }
  for (const key of ['repoStandardsHash', 'repoMapHash', 'authoritySettingsHash']) {
    if (!scopeHashMatches(scope, key, request.protectedStandards?.[key])) {
      return `approval is not scoped for current ${key}`;
    }
  }
  return null;
}

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

export function resolveOfflineApprovalReference({ rootDir, approvalRef, request, resolvedAt } = {}) {
  if (!rootDir) throw new Error('offline approval resolver requires rootDir');
  if (typeof approvalRef !== 'string' || !approvalRef.trim()) {
    throw new Error('offline approval resolver requires approvalRef');
  }
  const trimmedRef = approvalRef.trim();
  const path = resolveOfflineApprovalRecordPath(rootDir, trimmedRef);
  if (!path) {
    return normalizeApprovalResolverResult({
      status: 'unresolved',
      approvalRef: trimmedRef,
      provider: 'veritas-offline',
      failureReason: `approval reference must use ${VERITAS_APPROVAL_REF_PREFIX}<id> or file:${OFFLINE_APPROVAL_RECORDS_DIR}/<file> for the offline resolver`,
    }, { resolvedAt });
  }
  if (!existsSync(path)) {
    return normalizeApprovalResolverResult({
      status: 'unresolved',
      approvalRef: trimmedRef,
      provider: 'veritas-offline',
      authorityRef: basename(path),
      failureReason: `approval record not found at ${relativeRepoPath(rootDir, path)}`,
    }, { resolvedAt });
  }

  const raw = readFileSync(path, 'utf8');
  const record = JSON.parse(raw);
  const status = record.status ?? 'unresolved';
  const scopeFailure = status === 'approved' && request
    ? evaluateOfflineApprovalRecordScope(record, request)
    : null;
  return normalizeApprovalResolverResult({
    status: scopeFailure ? 'out-of-scope' : status,
    approvalRef: record.approvalRef ?? trimmedRef,
    provider: record.provider ?? 'veritas-offline',
    authorityRef: record.authorityRef ?? record.id ?? basename(path),
    approvedBy: record.approvedBy ?? null,
    approvedAt: record.approvedAt ?? null,
    expiresAt: record.expiresAt ?? null,
    scope: record.scope ?? null,
    evidenceHash: record.evidenceHash ?? `sha256:${sha256Hex(raw)}`,
    failureReason: scopeFailure ?? record.failureReason,
    metadata: {
      ...(record.metadata ?? {}),
      recordPath: relativeRepoPath(rootDir, path),
    },
  }, { resolvedAt });
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
