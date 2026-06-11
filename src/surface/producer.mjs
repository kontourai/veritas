import {
  buildSurfaceTrustBundle,
  buildSurfaceTrustReportSummary,
  throwSurfaceTrustBundleValidationError,
  validateSurfaceTrustBundleAtBoundary,
} from './projection.mjs';

export async function produceSurfaceStateForVeritasRecord(record, {
  rootDir = process.cwd(),
  repoMapConfig = null,
} = {}) {
  const bundle = await buildSurfaceTrustBundle(record, { rootDir, repoMapConfig });
  const validatedBundle = validateSurfaceTrustBundleAtBoundary({ input: bundle, record, rootDir });
  let report;
  try {
    report = buildSurfaceTrustReportSummary({ input: validatedBundle, record });
  } catch (error) {
    throwSurfaceTrustBundleValidationError({ error, input: validatedBundle, record, rootDir });
  }
  return {
    bundle: validatedBundle,
    report,
  };
}
