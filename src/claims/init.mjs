import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadAdapterConfig } from '../load.mjs';
import { readDefaultProofLaneIds, readProofLanes, readRequiredProofLaneIds, proofCommandsForLaneIds } from '../proof/index.mjs';
import { buildBaselineClaims } from './templates.mjs';
import { claimStoreExists, saveVeritasClaimStore } from './store.mjs';

export async function initClaimStore({ rootDir = process.cwd(), repoName = basename(resolve(rootDir)), dryRun = false, force = false } = {}) {
  if (!dryRun && claimStoreExists(rootDir) && !force) {
    throw new Error('veritas.claims.json already exists. Use `veritas claim add` to add claims.');
  }

  const adapterPath = resolve(rootDir, '.veritas/repo.adapter.json');
  const hasAdapter = existsSync(adapterPath);
  const config = hasAdapter ? loadAdapterConfig(adapterPath) : {};
  const laneIds = hasAdapter
    ? (readDefaultProofLaneIds(config).length > 0 ? readDefaultProofLaneIds(config) : readRequiredProofLaneIds(config))
    : [];
  const proofLaneCommands = hasAdapter ? proofCommandsForLaneIds(config, laneIds) : [];
  const allSurfaceNodes = hasAdapter && Array.isArray(config.graph?.nodes) ? config.graph.nodes : [];
  const hasGovernance = existsSync(resolve(rootDir, '.veritas/GOVERNANCE.md'));
  const { claims, policies } = buildBaselineClaims(repoName, {
    hasGovernance,
    proofLaneCommands: proofLaneCommands.length > 0 || !hasAdapter
      ? proofLaneCommands
      : readProofLanes(config).map((lane) => lane.command).filter(Boolean),
    surfaceNodes: allSurfaceNodes,
  });
  const store = { schemaVersion: 1, producer: 'veritas', claims, policies };
  if (!dryRun) saveVeritasClaimStore(store, rootDir);
  return store;
}
