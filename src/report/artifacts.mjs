import {
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';
import { resolveRunArtifactPath } from '../util/run-id.mjs';

export function writeEvidenceArtifact(record, config, rootDir) {
  const artifactDir = resolve(rootDir, config.evidence.artifactDir);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = resolveRunArtifactPath({
    dir: artifactDir,
    runId: record.run_id,
    suffix: '.json',
    label: 'Veritas evidence run id',
  });
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

function safeClaimFilename(claimId) {
  return `${claimId.replace(/[^A-Za-z0-9._-]+/g, '-')}.input.json`;
}

function buildSingleClaimInput(input, claim) {
  const evidenceForClaim = input.evidence.filter((item) => item.claimId === claim.id);
  const eventsForClaim = input.events.filter((item) => item.claimId === claim.id);
  return {
    schemaVersion: input.schemaVersion,
    source: input.source,
    generatedAt: new Date().toISOString(),
    claim,
    evidence: evidenceForClaim,
    events: eventsForClaim,
    policy: input.policies.find((policy) => policy.id === claim.verificationPolicyId) ?? null,
  };
}

export function writeSurfaceClaimInputs(record, rootDir) {
  const input = record.surface?.input;
  if (!input?.claims?.length) return [];
  const claimsDir = resolve(rootDir, '.veritas/claims');
  mkdirSync(claimsDir, { recursive: true });
  const written = [];
  for (const claim of input.claims) {
    const path = resolve(claimsDir, safeClaimFilename(claim.id));
    writeFileSync(path, `${JSON.stringify(buildSingleClaimInput(input, claim), null, 2)}\n`, 'utf8');
    written.push(relativeRepoPath(rootDir, path));
  }
  return written;
}
