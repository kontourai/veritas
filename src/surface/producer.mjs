import {
  buildSurfaceTrustInput,
  buildSurfaceTrustReportSummary,
  throwSurfaceTrustInputValidationError,
  validateSurfaceTrustInputAtBoundary,
} from './projection.mjs';

export async function produceSurfaceStateForVeritasRecord(record, {
  rootDir = process.cwd(),
  repoMapConfig = null,
} = {}) {
  const input = await buildSurfaceTrustInput(record, { rootDir, repoMapConfig });
  const validatedInput = validateSurfaceTrustInputAtBoundary({ input, record, rootDir });
  let report;
  try {
    report = buildSurfaceTrustReportSummary({ input: validatedInput, record });
  } catch (error) {
    throwSurfaceTrustInputValidationError({ error, input: validatedInput, record, rootDir });
  }
  return {
    input: validatedInput,
    report,
  };
}
