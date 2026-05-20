import { uniqueStrings } from '../util/strings.mjs';
import { assertExternalToolConfig } from './external-tools.mjs';
import { readProofSuiteManifestPaths } from './suites.mjs';

export function readProofRoutes(config) {
  assertProofConfig(config);
  return Array.isArray(config.evidence?.proofRoutes)
    ? config.evidence.proofRoutes
    : [];
}

export function readProofs(config) {
  assertProofConfig(config);
  return Array.isArray(config.evidence?.proofs) ? config.evidence.proofs : [];
}

export function readDefaultProofIds(config) {
  assertProofConfig(config);
  return uniqueStrings(config.evidence?.defaultProofIds ?? []);
}

export function readRequiredProofIds(config) {
  assertProofConfig(config);
  return uniqueStrings(config.evidence?.requiredProofIds ?? []);
}

export function proofById(config) {
  return new Map(readProofs(config).map((proof) => [proof.id, proof]));
}

export function commandsForProofIds(config, proofIds) {
  const proofs = proofById(config);
  return uniqueStrings(proofIds.map((id) => {
    const proof = proofs.get(id);
    return (proof?.runner ?? 'bash') === 'bash' ? proof.command : null;
  }).filter(Boolean));
}

export function proofsByIds(config, proofIds) {
  const proofs = proofById(config);
  return uniqueStrings(proofIds)
    .map((id) => proofs.get(id))
    .filter(Boolean);
}

export function proofRecordsForCommands(config, commands) {
  const proofs = readProofs(config);
  return commands.map((command) => {
    const proof = proofs.find((item) => (item.runner ?? 'bash') === 'bash' && item.command === command);
    return proof ?? {
      id: command.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'explicit-proof',
      runner: 'bash',
      command,
      method: 'validation',
      summary: `Explicit proof command: ${command}`,
    };
  });
}

export function proofLabel(proof) {
  if ((proof.runner ?? 'bash') === 'mcp') {
    return `${proof.tool}@${proof.server?.command ?? 'mcp'}`;
  }
  return proof.command;
}

export function assertProofConfig(config) {
  const evidence = config.evidence ?? {};
  const removedFields = [
    'requiredProofLanes',
    'defaultProofLanes',
    'surfaceProofLanes',
    'requiredProofs',
    'defaultProofs',
    'surfaceProofs',
  ].filter((field) => field in evidence);
  if (removedFields.length > 0) {
    throw new Error(
      `Veritas adapter proof config uses removed field(s): ${removedFields.join(', ')}. Migrate to evidence.proofs[].command, requiredProofIds, defaultProofIds, and proofRoutes; see docs/reference/artifacts-and-schemas.md#adapter-proof-lane-migration.`,
    );
  }

  if (!Array.isArray(evidence.proofs) || evidence.proofs.length === 0) {
    throw new Error('Veritas adapter evidence.proofs must contain proof objects with id, runner-specific execution fields, and method.');
  }

  const proofIds = new Set();
  for (const proof of evidence.proofs) {
    assertProofObject(proof);
    if (proofIds.has(proof.id)) throw new Error(`Veritas adapter evidence.proofs contains duplicate id: ${proof.id}`);
    proofIds.add(proof.id);
  }

  for (const field of ['requiredProofIds', 'defaultProofIds']) {
    for (const id of uniqueStrings(evidence[field] ?? [])) {
      if (!proofIds.has(id)) throw new Error(`Veritas adapter evidence.${field} references unknown proof id: ${id}`);
    }
  }

  for (const route of evidence.proofRoutes ?? []) {
    if (!Array.isArray(route.proofIds)) {
      throw new Error('Veritas adapter evidence.proofRoutes[].proofIds must reference proof ids.');
    }
    for (const id of uniqueStrings(route.proofIds)) {
      if (!proofIds.has(id)) throw new Error(`Veritas adapter proof route references unknown proof id: ${id}`);
    }
  }

  for (const manifestPath of readProofSuiteManifestPaths(config)) {
    if (manifestPath.startsWith('/') || manifestPath.includes('..')) {
      throw new Error('Veritas adapter evidence.proofSuiteManifests must contain repo-local paths inside .veritas/.');
    }
    if (!manifestPath.startsWith('.veritas/')) {
      throw new Error('Veritas adapter evidence.proofSuiteManifests paths must start with .veritas/.');
    }
  }
}

export function assertProofObject(proof) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    throw new Error('Veritas adapter evidence.proofs entries must be objects.');
  }
  for (const field of ['id', 'method']) {
    if (typeof proof[field] !== 'string' || proof[field].length === 0) {
      throw new Error(`Veritas adapter evidence.proofs[].${field} must be a non-empty string.`);
    }
  }
  const runner = proof.runner ?? 'bash';
  if (!['bash', 'mcp'].includes(runner)) {
    throw new Error(`Veritas adapter evidence.proofs[].runner contains unsupported value: ${proof.runner}`);
  }
  if (runner === 'bash') {
    if (typeof proof.command !== 'string' || proof.command.length === 0) {
      throw new Error('Veritas adapter evidence.proofs[].command must be a non-empty string for bash proofs.');
    }
  } else {
    if (!proof.server || typeof proof.server !== 'object' || Array.isArray(proof.server)) {
      throw new Error('Veritas adapter evidence.proofs[].server must be an object for MCP proofs.');
    }
    if (typeof proof.server.command !== 'string' || proof.server.command.length === 0) {
      throw new Error('Veritas adapter evidence.proofs[].server.command must be a non-empty string for MCP proofs.');
    }
    if (!Array.isArray(proof.server.args)) {
      throw new Error('Veritas adapter evidence.proofs[].server.args must be an array for MCP proofs.');
    }
    if (proof.server.args.some((arg) => typeof arg !== 'string')) {
      throw new Error('Veritas adapter evidence.proofs[].server.args must contain only strings.');
    }
    if (proof.server.env !== undefined && (!proof.server.env || typeof proof.server.env !== 'object' || Array.isArray(proof.server.env))) {
      throw new Error('Veritas adapter evidence.proofs[].server.env must be an object when provided.');
    }
    if (typeof proof.tool !== 'string' || proof.tool.length === 0) {
      throw new Error('Veritas adapter evidence.proofs[].tool must be a non-empty string for MCP proofs.');
    }
    if (proof.input !== undefined && (!proof.input || typeof proof.input !== 'object' || Array.isArray(proof.input))) {
      throw new Error('Veritas adapter evidence.proofs[].input must be an object when provided.');
    }
  }
  if (!['observation', 'extraction', 'validation', 'corroboration', 'attestation', 'auditability', 'anchoring', 'monitoring'].includes(proof.method)) {
    throw new Error(`Veritas adapter evidence.proofs[].method contains unsupported value: ${proof.method}`);
  }
  if (proof.surfaceClaimIds !== undefined && !Array.isArray(proof.surfaceClaimIds)) {
    throw new Error('Veritas adapter evidence.proofs[].surfaceClaimIds must be an array of strings.');
  }
  if (proof.externalTool !== undefined) {
    assertExternalToolConfig(proof.externalTool);
  }
}

export function readUncoveredPathPolicy(config) {
  const policy = config.evidence?.uncoveredPathPolicy;
  if (policy === 'ignore' || policy === 'fail') return policy;
  return 'warn';
}

export function routeMatchesAnyComponent(route, components) {
  return (route.componentIds ?? []).some((componentId) => components.includes(componentId));
}

export function serializeProofRoutes(config) {
  return readProofRoutes(config).map((route) => ({
    component_ids: uniqueStrings(route.componentIds ?? []),
    proof_ids: uniqueStrings(route.proofIds ?? []),
  }));
}
