import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadRepoMap } from '../load.mjs';
import { readDefaultEvidenceCheckIds, readEvidenceChecks, readRequiredEvidenceCheckIds, commandsForEvidenceCheckIds } from '../evidence/index.mjs';
import { buildBaselineClaims } from './templates.mjs';
import { claimStoreExists, saveVeritasClaimStore } from './store.mjs';

export async function initClaimStore({ rootDir = process.cwd(), repoName = basename(resolve(rootDir)), dryRun = false, force = false } = {}) {
  if (!dryRun && claimStoreExists(rootDir) && !force) {
    throw new Error('veritas.claims.json already exists. Use `veritas claim add` to add claims.');
  }

  const repoMapPath = resolve(rootDir, '.veritas/repo-map.json');
  const hasRepoMap = existsSync(repoMapPath);
  const config = hasRepoMap ? loadRepoMap(repoMapPath) : {};
  const evidenceCheckIds = hasRepoMap
    ? (readDefaultEvidenceCheckIds(config).length > 0 ? readDefaultEvidenceCheckIds(config) : readRequiredEvidenceCheckIds(config))
    : [];
  const evidenceCheckCommands = hasRepoMap ? commandsForEvidenceCheckIds(config, evidenceCheckIds) : [];
  const workAreaNodes = hasRepoMap && Array.isArray(config.graph?.nodes) ? config.graph.nodes : [];
  const hasGovernance = existsSync(resolve(rootDir, '.veritas/GOVERNANCE.md'));
  const { claims, policies } = buildBaselineClaims(repoName, {
    hasGovernance,
    evidenceCheckCommands: evidenceCheckCommands.length > 0 || !hasRepoMap
      ? evidenceCheckCommands
      : readEvidenceChecks(config).map((evidenceCheck) => evidenceCheck.command).filter(Boolean),
    workAreas: workAreaNodes,
  });
  const store = { schemaVersion: 1, producer: 'veritas', claims, policies };
  if (!dryRun) saveVeritasClaimStore(store, rootDir);
  return store;
}
