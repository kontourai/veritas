import { loadJson } from '../load.mjs';
import {
  approvalResolverRejectionReason,
  isApprovalResolverResultAccepted,
  normalizeApprovalRefPolicy,
  resolveOfflineApprovalReference,
} from '../approval-resolvers.mjs';

export function rejectNonHumanActor(actorId) {
  if (/(\bbot\b|ci|github-actions|dependabot|buildkite|circleci|jenkins)/i.test(actorId)) {
    throw new Error(`Refusing to create a human attestation for non-human actor: ${actorId}`);
  }
}

export function requireHumanApprovalReference({ kind, approvalRef }) {
  if (typeof approvalRef === 'string' && approvalRef.trim()) return;
  throw new Error(
    `veritas attest ${kind} requires --approval-ref <reference> from an explicit human approval. ` +
    'Agents may prepare changes, but must not record authority-backed attestations without a human approval reference.',
  );
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
