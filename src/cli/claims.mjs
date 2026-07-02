import { parseTokens } from '../args.mjs';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { initClaimStore } from '../claims/init.mjs';
import {
  addClaimToStore,
  loadVeritasClaimStore,
  loadVeritasClaimStoreForWrite,
  removeClaimFromStore,
  saveVeritasClaimStore,
  updateClaimInStore,
  validateClaimStore,
} from '../claims/store.mjs';
import { loadRepoMap } from '../load.mjs';
import { loadPluginsFromConfig } from '../plugins/loader.mjs';
import { getPlugin } from '../plugins/registry.mjs';

export async function runClaimCli(argv = process.argv.slice(2), { rootDir = process.cwd() } = {}) {
  const [subcommand, ...rest] = argv;
  if (subcommand === 'init') return runClaimInit(rest, rootDir);
  if (subcommand === 'list') return runClaimList(rootDir);
  if (subcommand === 'add') return runClaimAdd(rest, rootDir);
  if (subcommand === 'edit') return runClaimEdit(rest, rootDir);
  if (subcommand === 'remove') return runClaimRemove(rest, rootDir);
  if (subcommand === 'scaffold') return runClaimScaffold(rest, rootDir);
  if (subcommand === 'validate') return runClaimValidate(rootDir);
  throw new Error(`Unknown claim subcommand: ${subcommand}. Use init, list, add, edit, remove, scaffold, or validate.`);
}

async function runClaimInit(args, rootDir) {
  const { options } = parseTokens(args, {
    '--repo-name': { type: 'string', key: 'repoName' },
    '--dry-run': { type: 'flag', key: 'dryRun' },
    '--force': { type: 'flag', key: 'force' },
  });
  const store = await initClaimStore({ rootDir, repoName: options.repoName, dryRun: options.dryRun, force: options.force });
  process.stdout.write(`${JSON.stringify(store, null, 2)}\n`);
}

function runClaimList(rootDir) {
  const store = loadVeritasClaimStore(rootDir);
  if (store.claims.length === 0) {
    process.stdout.write('No claims defined. Run `veritas claim add` to create one.\n');
    return;
  }
  for (const claim of store.claims) {
    process.stdout.write(`${claim.id}\t${claim.claimType}\t${claim.fieldOrBehavior}\t${claim.impactLevel ?? 'medium'}\n`);
  }
}

function runClaimAdd(args, rootDir) {
  const options = parseClaimFlags(args);
  const now = new Date().toISOString();
  const claim = {
    id: options.id ?? generateClaimId(options.subjectId, options.facet, options.field),
    facet: options.facet,
    claimType: options.type,
    fieldOrBehavior: options.field,
    subjectType: options.subjectType,
    subjectId: options.subjectId,
    impactLevel: options.impact ?? 'medium',
    verificationPolicyId: options.policyId,
    metadata: options.metadata,
    createdAt: now,
    updatedAt: now,
  };
  const updated = addClaimToStore(loadVeritasClaimStoreForWrite(rootDir), claim);
  saveVeritasClaimStore(updated, rootDir);
  process.stdout.write(`Added claim: ${claim.id}\n`);
}

function runClaimEdit(args, rootDir) {
  const options = parseClaimFlags(args, { requireCreateFields: false });
  if (!options.claimId) throw new Error('veritas claim edit requires --claim-id');
  const updates = {};
  if (options.type) updates.claimType = options.type;
  if (options.facet) updates.facet = options.facet;
  if (options.subjectType) updates.subjectType = options.subjectType;
  if (options.subjectId) updates.subjectId = options.subjectId;
  if (options.field) updates.fieldOrBehavior = options.field;
  if (options.impact) updates.impactLevel = options.impact;
  if (options.policyId) updates.verificationPolicyId = options.policyId;
  if (options.metadata) updates.metadata = options.metadata;
  const updated = updateClaimInStore(loadVeritasClaimStore(rootDir), options.claimId, updates);
  saveVeritasClaimStore(updated, rootDir);
  process.stdout.write(`Updated claim: ${options.claimId}\n`);
}

function runClaimRemove(args, rootDir) {
  const options = parseClaimFlags(args, { requireCreateFields: false });
  if (!options.claimId) throw new Error('veritas claim remove requires --claim-id');
  const updated = removeClaimFromStore(loadVeritasClaimStore(rootDir), options.claimId);
  saveVeritasClaimStore(updated, rootDir);
  process.stdout.write(`Removed claim: ${options.claimId}\n`);
}

function runClaimValidate(rootDir) {
  const store = validateClaimStore(loadVeritasClaimStore(rootDir));
  process.stdout.write(`${store.claims.length} claims, ${store.policies.length} policies\nClaim store is valid.\n`);
}

async function runClaimScaffold(args, rootDir) {
  const { options, rest } = parseTokens(args, {
    '--plugin': { type: 'string', key: 'pluginName' },
  });
  if (rest.length > 0) throw new Error(`Unknown claim scaffold argument(s): ${rest.join(', ')}`);
  if (!options.pluginName) throw new Error('veritas claim scaffold requires --plugin <name>');
  const repoMapPath = resolve(rootDir, '.veritas/repo-map.json');
  const repoMapConfig = existsSync(repoMapPath) ? loadRepoMap(repoMapPath) : {};
  await loadPluginsFromConfig(repoMapConfig, rootDir);
  const plugin = getPlugin(options.pluginName);
  if (!plugin) throw new Error(`Plugin "${options.pluginName}" is not loaded. Check your repo-map.json.`);
  if (typeof plugin.scaffoldClaims !== 'function') {
    throw new Error(`Plugin "${options.pluginName}" does not support claim scaffolding.`);
  }
  const repoName = repoMapConfig?.repo?.name ?? repoMapConfig?.name ?? basename(rootDir);
  const scaffolded = plugin.scaffoldClaims(repoName) ?? [];
  let updated = loadVeritasClaimStoreForWrite(rootDir);
  let added = 0;
  for (const claim of scaffolded) {
    if (!updated.claims.some((item) => item.id === claim.id)) {
      updated = addClaimToStore(updated, claim);
      added++;
    }
  }
  if (plugin.policyTemplates) {
    const policiesById = new Map(updated.policies.map((policy) => [policy.id, policy]));
    for (const [id, template] of Object.entries(plugin.policyTemplates)) {
      if (!policiesById.has(id)) policiesById.set(id, { id, ...template });
    }
    updated = { ...updated, policies: [...policiesById.values()] };
  }
  saveVeritasClaimStore(updated, rootDir);
  process.stdout.write(`Scaffolded ${added} claim(s) from plugin ${options.pluginName}.\n`);
}

function parseClaimFlags(args, { requireCreateFields = true } = {}) {
  const { options, rest } = parseTokens(args, {
    '--id': { type: 'string', key: 'id' },
    '--claim-id': { type: 'string', key: 'claimId' },
    '--type': { type: 'string', key: 'type' },
    '--facet': { type: 'string', key: 'facet' },
    '--subject-type': { type: 'string', key: 'subjectType' },
    '--subject-id': { type: 'string', key: 'subjectId' },
    '--field': { type: 'string', key: 'field' },
    '--impact': { type: 'string', key: 'impact' },
    '--policy-id': { type: 'string', key: 'policyId' },
    '--metadata': { type: 'string', key: 'metadataJson' },
  });
  if (rest.length > 0) throw new Error(`Unknown claim argument(s): ${rest.join(', ')}`);
  if (options.metadataJson) options.metadata = JSON.parse(options.metadataJson);
  if (options.impact && !['low', 'medium', 'high', 'critical'].includes(options.impact)) {
    throw new Error('--impact must be low, medium, high, or critical');
  }
  if (requireCreateFields) {
    for (const field of ['type', 'facet', 'subjectType', 'subjectId', 'field']) {
      if (!options[field]) throw new Error(`veritas claim add requires --${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    }
  }
  return options;
}

function generateClaimId(subjectId, facet, field) {
  return `${safeId(subjectId)}.${safeId(facet)}.${safeId(field)}`;
}

function safeId(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'claim';
}
