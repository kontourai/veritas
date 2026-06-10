import * as Surface from '@kontourai/surface';
import {
  SURFACE_SUPPORTS_AUTHORITY_TRACE,
} from './capabilities.mjs';

export function buildSurfaceTrustInputWithPublicApi(input) {
  if (typeof Surface.TrustInputBuilder !== 'function') {
    throw new Error('Surface TrustInputBuilder public API is required by Veritas projection.');
  }
  const builder = new Surface.TrustInputBuilder({
    source: input.source,
    schemaVersion: input.schemaVersion,
  });
  for (const claim of input.claims) builder.addClaim(claim);
  for (const policy of input.policies) builder.addPolicy(policy);
  for (const item of input.evidence) builder.addEvidence(item).linkTo(item.claimId);
  for (const event of input.events) builder.addEvent(event);
  for (const link of input.identityLinks ?? []) builder.addIdentityLink(link);
  for (const claimGroup of input.claimGroups ?? []) {
    if (typeof builder.addClaimGroup === 'function') builder.addClaimGroup(claimGroup);
  }
  return builder.build();
}

export function createSurfaceTrustInputAssembler({ source, schemaVersion }) {
  if (typeof Surface.TrustInputBuilder !== 'function') {
    throw new Error('Surface TrustInputBuilder public API is required by Veritas projection.');
  }
  const builder = new Surface.TrustInputBuilder({ source, schemaVersion });
  const draft = {
    schemaVersion,
    source,
    claims: [],
    evidence: [],
    policies: [],
    events: [],
    claimGroups: [],
    authorityTrace: [],
  };
  return {
    claims: {
      push: (...items) => {
        for (const item of items) {
          draft.claims.push(item);
          builder.addClaim(item);
        }
        return items.length;
      },
    },
    evidence: {
      push: (...items) => {
        for (const item of items) {
          const index = draft.evidence.findIndex((existing) => existing.id === item.id);
          if (index >= 0) draft.evidence[index] = item;
          else draft.evidence.push(item);
          builder.addEvidence(item).linkTo(item.claimId);
        }
        return items.length;
      },
    },
    events: {
      push: (...items) => {
        for (const item of items) {
          draft.events.push(item);
          builder.addEvent(item);
        }
        return items.length;
      },
    },
    claimGroups: {
      push: (...items) => {
        for (const item of items) {
          draft.claimGroups.push(item);
          if (typeof builder.addClaimGroup === 'function') builder.addClaimGroup(item);
        }
        return items.length;
      },
    },
    authorityTrace: {
      push: (...items) => {
        draft.authorityTrace.push(...items);
        return items.length;
      },
    },
    build: (policies) => {
      for (const policy of policies) {
        draft.policies.push(policy);
        builder.addPolicy(policy);
      }
      try {
        const input = builder.build();
        if (SURFACE_SUPPORTS_AUTHORITY_TRACE && draft.authorityTrace.length > 0) {
          return Surface.validateTrustInput({
            ...input,
            authorityTrace: [...draft.authorityTrace],
          });
        }
        return input;
      } catch (error) {
        error.trustInputDraft = {
          ...draft,
          claims: [...draft.claims],
          evidence: [...draft.evidence],
          policies: [...draft.policies],
          events: [...draft.events],
          claimGroups: [...draft.claimGroups],
          ...(SURFACE_SUPPORTS_AUTHORITY_TRACE ? { authorityTrace: [...draft.authorityTrace] } : {}),
        };
        throw error;
      }
    },
  };
}
