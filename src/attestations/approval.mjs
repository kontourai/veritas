import { loadJson } from '../load.mjs';
import {
  approvalResolverRejectionReason,
  isApprovalResolverResultAccepted,
  normalizeApprovalRefPolicy,
  normalizeApprovalResolverResult,
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

// Why the approval metadata an attestation records does not make it
// authority-backed, or null when it does. It checks that the policy mode
// required resolution (`resolved` or `resolved-strict`), that the recorded
// resolver result is approved, and that the result is for the reference the
// attestation cites. `reference-only` and `prefix` modes never resolve the
// reference, and a resolver result supplied under them is recorded but never
// checked. Under a resolved mode, a result passed in by a caller is trusted as
// given: only its status, expiry and reference are checked. For a stored
// record, use attestationAuthorityGap, which also requires the metadata to be
// integrity-bound.
export function approvalAuthorityGap({ approvalRef, approvalRefPolicy, approvalResolution } = {}) {
  if (approvalRefPolicy?.requiresResolution !== true || approvalResolution?.approved !== true) {
    return 'its approval reference was not resolved against an approval record';
  }
  if (typeof approvalRef !== 'string' || approvalResolution.approvalRef !== approvalRef) {
    return `its approval was resolved, but for a different reference (${JSON.stringify(approvalResolution.approvalRef ?? null)})`;
  }
  return null;
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
  return approvalAuthorityGap(attestation?.metadata);
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
        `veritas attest approval reference was not accepted by resolver: ${approvalResolverRejectionReason(resolvedApproval, { now: resolverRequest?.requestedAt })}${resolvedApproval.failureReason ? ` (${resolvedApproval.failureReason})` : ''}`,
      );
    }
    // A result for another reference cannot approve this one, whoever resolved it.
    const resolvedRef = normalizeApprovalResolverResult(resolvedApproval).approvalRef;
    if (resolvedRef !== approvalRef.trim()) {
      throw new Error(
        `veritas attest approval reference was not accepted by resolver: ${resolvedRef === null ? 'the approved result names no approvalRef' : `the approved result is for ${JSON.stringify(resolvedRef)}`}, not ${JSON.stringify(approvalRef.trim())}`,
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
