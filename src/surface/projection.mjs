import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';
import { relativeRepoPath, veritasArtifactPath } from '../paths.mjs';
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
import {
  buildSurfaceTrustBundleWithPublicApi,
  createSurfaceTrustBundleAssembler,
} from './trust-bundle-assembler.mjs';
import { validateTrustBundleSchema } from './trust-bundle-validator.mjs';

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
  buildSurfaceTrustBundleWithPublicApi,
  createSurfaceTrustBundleAssembler,
  policyResultClaimId,
  summarizeSurfaceTrustReport,
  surfaceClaimId,
  surfaceEvidence,
  surfaceEvent,
  surfaceSafeId,
};

export async function buildSurfaceTrustBundle(record, { rootDir = process.cwd(), repoMapConfig = null } = {}) {
  registerVeritasExtension();
  if (repoMapConfig) await loadPluginsFromConfig(repoMapConfig, rootDir);
  const claimStore = loadVeritasClaimStore(rootDir);
  const effectiveClaimStore = withProjectedPolicyClaims(claimStore, record);
  const assembler = createSurfaceTrustBundleAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 3,
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
    return throwSurfaceTrustBundleValidationError({
      error,
      input: error.trustBundleDraft,
      record,
      rootDir,
    });
  }
}

export function validateSurfaceTrustBundleAtBoundary({ input, record, rootDir }) {
  if (process.env.VERITAS_SKIP_SURFACE_VALIDATION === '1') {
    process.stderr.write('WARN: VERITAS_SKIP_SURFACE_VALIDATION=1 — this is intended as a short-lived escape hatch; remove once the underlying example is fixed.\n');
    return input;
  }
  let validated;
  try {
    validated = Surface.validateTrustBundle(input);
  } catch (error) {
    return throwSurfaceTrustBundleValidationError({ error, input, record, rootDir });
  }
  // Also validate against the normative Hachure JSON Schema (schemaVersion 3, ajv 2020-12)
  const hachureResult = validateTrustBundleSchema(validated);
  if (!hachureResult.valid) {
    const detail = hachureResult.errors.slice(0, 5).join('; ');
    const error = new Error(`Hachure schema validation failed: ${detail}`);
    return throwSurfaceTrustBundleValidationError({ error, input: validated, record, rootDir });
  }
  return validated;
}

export function throwSurfaceTrustBundleValidationError({ error, input, record, rootDir }) {
  const failureDir = veritasArtifactPath(rootDir, 'external', 'surface-validation-failures');
  mkdirSync(failureDir, { recursive: true });
  const failurePath = resolve(failureDir, `${surfaceSafeId(record.run_id)}.json`);
  writeFileSync(failurePath, `${JSON.stringify(input ?? {}, null, 2)}\n`, 'utf8');
  const validationError = new Error(
    `Surface TrustBundle validation failed: ${error.message}. Rejected input: ${relativeRepoPath(rootDir, failurePath)}`,
  );
  validationError.exitCode = 2;
  throw validationError;
}
