import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';
import { relativeRepoPath, veritasArtifactPath } from '../paths.mjs';
import {
  buildGovernanceArtifactClaims,
} from './governance-projection.mjs';
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
import { createSurfaceProjectionAssembly } from './projection-assembly.mjs';

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
  const assembly = await createSurfaceProjectionAssembly(record, { rootDir, repoMapConfig });

  try {
    return assembly.assembler.build(assembly.policies);
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
