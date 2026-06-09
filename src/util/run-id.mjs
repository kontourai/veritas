import { resolve } from 'node:path';
import { assertWithinDir } from '../paths.mjs';

const SAFE_RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function assertSafeRunId(runId, label = 'Veritas run id') {
  if (typeof runId !== 'string' || !SAFE_RUN_ID_PATTERN.test(runId)) {
    throw new Error(`${label} may only contain letters, numbers, dot, underscore, and hyphen.`);
  }
}

export function resolveRunArtifactPath({ dir, runId, suffix, label }) {
  assertSafeRunId(runId, label);
  const artifactPath = resolve(dir, `${runId}${suffix}`);
  assertWithinDir(
    artifactPath,
    dir,
    `${label ?? 'Veritas run artifact'} may only be written inside its configured output directory.`,
  );
  return artifactPath;
}
