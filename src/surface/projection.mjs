import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';
import { relativeRepoPath } from '../paths.mjs';
import {
  SURFACE_SUPPORTS_AUTHORITY_TRACE,
} from './capabilities.mjs';
import { loadVeritasClaimStore } from '../claims/store.mjs';
import { registerVeritasExtension } from './extension.mjs';
import { loadPluginsFromConfig, collectPluginEvidence } from '../plugins/loader.mjs';
import {
  collectAffectedSurfaceEvidence,
  collectEvidenceCheckEvidence,
  collectEvidenceInventoryEvidence,
  collectExternalToolEvidence,
  collectPolicyResultEvidence,
  collectReadinessCoverageEvidence,
  collectReadinessVerdictEvidence,
} from './evidence-projection.mjs';
import {
  collectGovernanceEvidence,
  collectRecommendationEvidence,
  buildGovernanceArtifactClaims,
} from './governance-projection.mjs';
import {
  buildRepoStandardsClaimGroup,
  claimDefToClaim,
  withProjectedPolicyClaims,
} from './projected-claims.mjs';
import {
  policyResultClaimId,
  surfaceClaimId,
  surfaceEvidence,
  surfaceEvent,
  surfaceSafeId,
} from './primitives.mjs';
import {
  buildSurfaceTrustReportSummary,
  summarizeSurfaceTrustReport,
} from './trust-report.mjs';

export {
  isoDateTimeOrUndefined,
  surfaceEvidenceInventoryImpact,
  surfaceEvidenceInventoryStatus,
  surfaceEvidenceInventoryStrength,
  surfaceEvidenceInventorySummary,
  surfaceEvidenceInventoryTransparencyGapHints,
  surfaceExternalToolStatus,
  surfacePolicyImpact,
  surfacePolicyResultStatus,
} from './evidence-projection.mjs';

export {
  buildGovernanceArtifactClaims,
  buildSurfaceTrustReportSummary,
  policyResultClaimId,
  summarizeSurfaceTrustReport,
  surfaceClaimId,
  surfaceEvidence,
  surfaceEvent,
  surfaceSafeId,
};

export async function buildSurfaceTrustInput(record, { rootDir = process.cwd(), repoMapConfig = null } = {}) {
  registerVeritasExtension();
  if (repoMapConfig) await loadPluginsFromConfig(repoMapConfig, rootDir);
  const claimStore = loadVeritasClaimStore(rootDir);
  const effectiveClaimStore = withProjectedPolicyClaims(claimStore, record);
  const assembler = createSurfaceTrustInputAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 2,
  });
  const { claims, evidence, events, claimGroups, authorityTrace } = assembler;

  for (const definition of effectiveClaimStore.claims) {
    claims.push(claimDefToClaim(definition, record));
  }

  collectAffectedSurfaceEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceCheckEvidence(record, effectiveClaimStore, evidence, events);
  collectPolicyResultEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceInventoryEvidence(record, effectiveClaimStore, evidence, events);
  collectExternalToolEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessCoverageEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessVerdictEvidence(record, effectiveClaimStore, evidence, events, authorityTrace);
  collectGovernanceEvidence(record, effectiveClaimStore, evidence, events);
  collectRecommendationEvidence(record, effectiveClaimStore, evidence, rootDir);
  const policyClaimGroup = buildRepoStandardsClaimGroup(record, effectiveClaimStore);
  if (policyClaimGroup) claimGroups.push(policyClaimGroup);
  const pluginContext = {
    runId: record.run_id,
    sourceRef: record.source_ref,
    timestamp: record.timestamp,
    rootDir,
  };
  for (const item of collectPluginEvidence(claimStore, pluginContext)) {
    evidence.push(item);
  }

  try {
    return assembler.build(effectiveClaimStore.policies);
  } catch (error) {
    return throwSurfaceTrustInputValidationError({
      error,
      input: error.trustInputDraft,
      record,
      rootDir,
    });
  }
}

export function validateSurfaceTrustInputAtBoundary({ input, record, rootDir }) {
  if (process.env.VERITAS_SKIP_SURFACE_VALIDATION === '1') {
    process.stderr.write('WARN: VERITAS_SKIP_SURFACE_VALIDATION=1 — this is intended as a short-lived escape hatch; remove once the underlying fixture is fixed.\n');
    return input;
  }
  try {
    return Surface.validateTrustInput(input);
  } catch (error) {
    return throwSurfaceTrustInputValidationError({ error, input, record, rootDir });
  }
}

export function throwSurfaceTrustInputValidationError({ error, input, record, rootDir }) {
  const failureDir = resolve(rootDir, '.veritas/external/surface-validation-failures');
  mkdirSync(failureDir, { recursive: true });
  const failurePath = resolve(failureDir, `${surfaceSafeId(record.run_id)}.json`);
  writeFileSync(failurePath, `${JSON.stringify(input ?? {}, null, 2)}\n`, 'utf8');
  const validationError = new Error(
    `Surface TrustInput validation failed: ${error.message}. Rejected input: ${relativeRepoPath(rootDir, failurePath)}`,
  );
  validationError.exitCode = 2;
  throw validationError;
}

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
