import { loadJson } from '../load.mjs';
import {
  approvalResolverRejectionReason,
  isApprovalResolverResultAccepted,
  normalizeApprovalRefPolicy,
  resolveOfflineApprovalReference,
} from '../approval-resolvers.mjs';

export function rejectNonHumanActor(actorId) {
  if (/(\bbot\b|\bci\b|github-actions|dependabot|buildkite|circleci|jenkins)/i.test(actorId)) {
    throw new Error(`Refusing to create a human attestation for non-human actor: ${actorId}`);
  }
}

export function requireHumanApprovalReference({ kind, approvalRef }) {
  if (typeof approvalRef === 'string' && approvalRef.trim()) return;
  throw new Error(
    `veritas attest ${kind} requires --approval-ref <reference> from an explicit human approval. ` +
    'Agents may prepare changes, but must not record attestations without a human approval reference.',
  );
}

// Checks the approval metadata an attestation records: the policy mode
// required resolution (`resolved` or `resolved-strict`), the recorded resolver
// result is approved, and that result is for the same reference the
// attestation cites. `reference-only` and `prefix` modes never resolve the
// reference, and a resolver result supplied under them is recorded but never
// checked. A result for a different reference does not back this one. For a
// stored record, use attestationAuthorityGap, which also requires the metadata
// to be integrity-bound.
export function isAuthorityBackedApproval({ approvalRef, approvalRefPolicy, approvalResolution } = {}) {
  return approvalRefPolicy?.requiresResolution === true
    && approvalResolution?.approved === true
    && typeof approvalRef === 'string'
    && approvalResolution.approvalRef === approvalRef;
}

// Why a stored attestation is not authority-backed, or null when it is. Its
// approval metadata counts only when record integrity verified it: an unbound
// record (written before record integrity, or with recordIntegrity deleted)
// can have that metadata edited without detection, so it is never
// authority-backed.
export function attestationAuthorityGap({ attestation, recordIntegrityStatus } = {}) {
  if (recordIntegrityStatus !== 'verified') {
    return 'its record integrity is not verified, so its approval metadata is not bound to it';
  }
  if (!isAuthorityBackedApproval(attestation?.metadata)) {
    return 'its approval reference was not resolved against an approval record';
  }
  return null;
}

export function validateApprovalReferencePolicy({
  rootDir,
  approvalRef,
  authoritySettingsPath,
  approvalResolverResult,
  resolverRequest,
}) {
  const authoritySettings = loadJson(authoritySettingsPath, 'authority settings');
  const policy = normalizeApprovalRefPolicy(
    authoritySettings.review_preferences?.attestation_approval_ref_policy,
  );
  const resolvedApproval = policy.requiresResolution && !approvalResolverResult
    ? resolveOfflineApprovalReference({
      rootDir,
      approvalRef,
      request: resolverRequest,
      resolvedAt: resolverRequest?.requestedAt,
    })
    : approvalResolverResult;
  if (policy.requiresResolution) {
    if (!resolvedApproval) {
      throw new Error(
        `veritas attest approval reference policy ${policy.mode} requires a resolver-backed approval result.`,
      );
    }
    if (!isApprovalResolverResultAccepted(resolvedApproval, { now: resolverRequest?.requestedAt })) {
      throw new Error(
        `veritas attest approval reference was not accepted by resolver: ${approvalResolverRejectionReason(resolvedApproval, { now: resolverRequest?.requestedAt })}`,
      );
    }
  }
  if (policy.allowedPrefixes.length === 0) {
    return {
      mode: policy.mode,
      matchedPrefix: null,
      requiresResolution: policy.requiresResolution,
      approvalResolverResult: resolvedApproval ?? null,
    };
  }

  const trimmedRef = approvalRef.trim();
  const matchedPrefix = policy.allowedPrefixes.find((prefix) =>
    trimmedRef.startsWith(prefix)
  );
  if (!matchedPrefix) {
    throw new Error(
      `veritas attest approval reference must start with one of: ${policy.allowedPrefixes.join(', ')}`,
    );
  }
  return {
    mode: policy.mode,
    matchedPrefix,
    requiresResolution: policy.requiresResolution,
    approvalResolverResult: resolvedApproval ?? null,
  };
}
