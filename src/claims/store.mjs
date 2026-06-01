import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';

export const VERITAS_CLAIM_STORE_FILE = 'veritas.claims.json';

export function veritasClaimStorePath(rootDir = process.cwd()) {
  return resolve(rootDir, VERITAS_CLAIM_STORE_FILE);
}

export function claimStoreExists(rootDir = process.cwd()) {
  return existsSync(veritasClaimStorePath(rootDir));
}

export function loadVeritasClaimStore(rootDir = process.cwd()) {
  const path = veritasClaimStorePath(rootDir);
  if (!existsSync(path)) {
    throw new Error('veritas.claims.json is required. Run `veritas claim init` and commit the generated claim store.');
  }
  if (typeof Surface.loadClaimStore === 'function') {
    return Surface.loadClaimStore(path);
  }
  return validateClaimStore(JSON.parse(readFileSync(path, 'utf8')));
}

export function loadVeritasClaimStoreForWrite(rootDir = process.cwd()) {
  return claimStoreExists(rootDir) ? loadVeritasClaimStore(rootDir) : emptyClaimStore();
}

export function saveVeritasClaimStore(store, rootDir = process.cwd()) {
  const path = veritasClaimStorePath(rootDir);
  if (typeof Surface.saveClaimStore === 'function') {
    Surface.saveClaimStore(store, path);
    return;
  }
  writeFileSync(path, `${JSON.stringify(validateClaimStore(store), null, 2)}\n`, 'utf8');
}

export function emptyClaimStore() {
  return { schemaVersion: 1, producer: 'veritas', claims: [], policies: [] };
}

export function validateClaimStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Claim store must be a JSON object');
  }
  if (store.schemaVersion !== 1) {
    throw new Error(`Unsupported claim store schemaVersion: ${store.schemaVersion}`);
  }
  if (!Array.isArray(store.claims)) throw new Error('Claim store must have a claims array');
  if (!Array.isArray(store.policies)) throw new Error('Claim store must have a policies array');
  return store;
}

export function addClaimToStore(store, claim) {
  if (typeof Surface.addClaimToStore === 'function') return Surface.addClaimToStore(store, claim);
  if (store.claims.some((item) => item.id === claim.id)) throw new Error(`Claim "${claim.id}" already exists in store`);
  return { ...store, claims: [...store.claims, claim] };
}

export function updateClaimInStore(store, id, updates) {
  if (typeof Surface.updateClaimInStore === 'function') return Surface.updateClaimInStore(store, id, updates);
  const index = store.claims.findIndex((item) => item.id === id);
  if (index === -1) throw new Error(`Claim "${id}" not found in store`);
  const existing = store.claims[index];
  const updated = { ...existing, ...updates, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
  return { ...store, claims: [...store.claims.slice(0, index), updated, ...store.claims.slice(index + 1)] };
}

export function removeClaimFromStore(store, id) {
  if (typeof Surface.removeClaimFromStore === 'function') return Surface.removeClaimFromStore(store, id);
  if (!store.claims.some((item) => item.id === id)) throw new Error(`Claim "${id}" not found in store`);
  return { ...store, claims: store.claims.filter((item) => item.id !== id) };
}
