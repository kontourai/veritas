import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadAdapterConfig } from '../load.mjs';
import { readDefaultProofIds, readProofs, readRequiredProofIds, commandsForProofIds } from '../proof/index.mjs';
import { buildBaselineClaims } from './templates.mjs';
import { claimStoreExists, saveVeritasClaimStore } from './store.mjs';

export async function initClaimStore({ rootDir = process.cwd(), repoName = basename(resolve(rootDir)), dryRun = false, force = false } = {}) {
  if (!dryRun && claimStoreExists(rootDir) && !force) {
    throw new Error('veritas.claims.json already exists. Use `veritas claim add` to add claims.');
  }

  const adapterPath = resolve(rootDir, '.veritas/repo.adapter.json');
  const hasAdapter = existsSync(adapterPath);
  const config = hasAdapter ? loadAdapterConfig(adapterPath) : {};
  const proofIds = hasAdapter
    ? (readDefaultProofIds(config).length > 0 ? readDefaultProofIds(config) : readRequiredProofIds(config))
    : [];
  const proofCommands = hasAdapter ? commandsForProofIds(config, proofIds) : [];
  const allSurfaceNodes = hasAdapter && Array.isArray(config.graph?.nodes) ? config.graph.nodes : [];
  const hasGovernance = existsSync(resolve(rootDir, '.veritas/GOVERNANCE.md'));
  const { claims, policies } = buildBaselineClaims(repoName, {
    hasGovernance,
    proofCommands: proofCommands.length > 0 || !hasAdapter
      ? proofCommands
      : readProofs(config).map((proof) => proof.command).filter(Boolean),
    surfaceNodes: allSurfaceNodes,
  });
  const store = { schemaVersion: 1, producer: 'veritas', claims, policies };
  if (!dryRun) saveVeritasClaimStore(store, rootDir);
  return store;
}
