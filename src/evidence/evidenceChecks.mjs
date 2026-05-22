import { uniqueStrings } from '../util/strings.mjs';
import { assertExternalToolConfig } from './external-tools.mjs';
import { readEvidenceInventoryManifestPaths } from './suites.mjs';

export function readEvidenceCheckRoutes(config) {
  assertEvidenceCheckConfig(config);
  return Array.isArray(config.evidence?.evidenceCheckRoutes)
    ? config.evidence.evidenceCheckRoutes
    : [];
}

export function readEvidenceChecks(config) {
  assertEvidenceCheckConfig(config);
  return Array.isArray(config.evidence?.evidenceChecks) ? config.evidence.evidenceChecks : [];
}

export function readDefaultEvidenceCheckIds(config) {
  assertEvidenceCheckConfig(config);
  return uniqueStrings(config.evidence?.defaultEvidenceCheckIds ?? []);
}

export function readRequiredEvidenceCheckIds(config) {
  assertEvidenceCheckConfig(config);
  return uniqueStrings(config.evidence?.requiredEvidenceCheckIds ?? []);
}

export function evidenceCheckById(config) {
  return new Map(readEvidenceChecks(config).map((evidenceCheck) => [evidenceCheck.id, evidenceCheck]));
}

export function commandsForEvidenceCheckIds(config, evidenceCheckIds) {
  const evidenceChecks = evidenceCheckById(config);
  return uniqueStrings(evidenceCheckIds.map((id) => {
    const evidenceCheck = evidenceChecks.get(id);
    return (evidenceCheck?.runner ?? 'bash') === 'bash' ? evidenceCheck.command : null;
  }).filter(Boolean));
}

export function evidenceChecksByIds(config, evidenceCheckIds) {
  const evidenceChecks = evidenceCheckById(config);
  return uniqueStrings(evidenceCheckIds)
    .map((id) => evidenceChecks.get(id))
    .filter(Boolean);
}

export function evidenceCheckRecordsForCommands(config, commands) {
  const evidenceChecks = readEvidenceChecks(config);
  return commands.map((command) => {
    const evidenceCheck = evidenceChecks.find((item) => (item.runner ?? 'bash') === 'bash' && item.command === command);
    return evidenceCheck ?? {
      id: command.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'explicit-evidence-check',
      runner: 'bash',
      command,
      method: 'validation',
      summary: `Explicit evidenceCheck command: ${command}`,
    };
  });
}

export function evidenceCheckLabel(evidenceCheck) {
  if ((evidenceCheck.runner ?? 'bash') === 'mcp') {
    return `${evidenceCheck.tool}@${evidenceCheck.server?.command ?? 'mcp'}`;
  }
  return evidenceCheck.command;
}

export function assertEvidenceCheckConfig(config) {
  const evidence = config.evidence ?? {};
  const removedFields = [
    'requiredEvidenceCheckCommands',
    'defaultEvidenceCheckCommands',
    'surfaceEvidenceCheckCommands',
    'requiredEvidenceChecks',
    'defaultEvidenceChecks',
    'surfaceEvidenceChecks',
  ].filter((field) => field in evidence);
  if (removedFields.length > 0) {
    throw new Error(
      `Veritas Repo Map evidence config uses removed field(s): ${removedFields.join(', ')}. Migrate to evidence.evidenceChecks[].command, requiredEvidenceCheckIds, defaultEvidenceCheckIds, and evidenceCheckRoutes; see docs/reference/artifacts-and-schemas.md#adapter-evidence-check-migration.`,
    );
  }

  if (!Array.isArray(evidence.evidenceChecks) || evidence.evidenceChecks.length === 0) {
    throw new Error('Veritas adapter evidence.evidenceChecks must contain evidenceCheck objects with id, runner-specific execution fields, and method.');
  }

  const evidenceCheckIds = new Set();
  for (const evidenceCheck of evidence.evidenceChecks) {
    assertEvidenceCheckObject(evidenceCheck);
    if (evidenceCheckIds.has(evidenceCheck.id)) throw new Error(`Veritas adapter evidence.evidenceChecks contains duplicate id: ${evidenceCheck.id}`);
    evidenceCheckIds.add(evidenceCheck.id);
  }

  for (const field of ['requiredEvidenceCheckIds', 'defaultEvidenceCheckIds']) {
    for (const id of uniqueStrings(evidence[field] ?? [])) {
      if (!evidenceCheckIds.has(id)) throw new Error(`Veritas adapter evidence.${field} references unknown evidenceCheck id: ${id}`);
    }
  }

  for (const route of evidence.evidenceCheckRoutes ?? []) {
    if (!Array.isArray(route.evidenceCheckIds)) {
      throw new Error('Veritas adapter evidence.evidenceCheckRoutes[].evidenceCheckIds must reference evidenceCheck ids.');
    }
    for (const id of uniqueStrings(route.evidenceCheckIds)) {
      if (!evidenceCheckIds.has(id)) throw new Error(`Veritas adapter evidenceCheck route references unknown evidenceCheck id: ${id}`);
    }
  }

  for (const manifestPath of readEvidenceInventoryManifestPaths(config)) {
    if (manifestPath.startsWith('/') || manifestPath.includes('..')) {
      throw new Error('Veritas adapter evidence.evidenceInventoryManifests must contain repo-local paths inside .veritas/.');
    }
    if (!manifestPath.startsWith('.veritas/')) {
      throw new Error('Veritas adapter evidence.evidenceInventoryManifests paths must start with .veritas/.');
    }
  }
}

export function assertEvidenceCheckObject(evidenceCheck) {
  if (!evidenceCheck || typeof evidenceCheck !== 'object' || Array.isArray(evidenceCheck)) {
    throw new Error('Veritas adapter evidence.evidenceChecks entries must be objects.');
  }
  for (const field of ['id', 'method']) {
    if (typeof evidenceCheck[field] !== 'string' || evidenceCheck[field].length === 0) {
      throw new Error(`Veritas adapter evidence.evidenceChecks[].${field} must be a non-empty string.`);
    }
  }
  const runner = evidenceCheck.runner ?? 'bash';
  if (!['bash', 'mcp'].includes(runner)) {
    throw new Error(`Veritas adapter evidence.evidenceChecks[].runner contains unsupported value: ${evidenceCheck.runner}`);
  }
  if (runner === 'bash') {
    if (typeof evidenceCheck.command !== 'string' || evidenceCheck.command.length === 0) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].command must be a non-empty string for bash evidenceChecks.');
    }
  } else {
    if (!evidenceCheck.server || typeof evidenceCheck.server !== 'object' || Array.isArray(evidenceCheck.server)) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].server must be an object for MCP evidenceChecks.');
    }
    if (typeof evidenceCheck.server.command !== 'string' || evidenceCheck.server.command.length === 0) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].server.command must be a non-empty string for MCP evidenceChecks.');
    }
    if (!Array.isArray(evidenceCheck.server.args)) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].server.args must be an array for MCP evidenceChecks.');
    }
    if (evidenceCheck.server.args.some((arg) => typeof arg !== 'string')) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].server.args must contain only strings.');
    }
    if (evidenceCheck.server.env !== undefined && (!evidenceCheck.server.env || typeof evidenceCheck.server.env !== 'object' || Array.isArray(evidenceCheck.server.env))) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].server.env must be an object when provided.');
    }
    if (typeof evidenceCheck.tool !== 'string' || evidenceCheck.tool.length === 0) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].tool must be a non-empty string for MCP evidenceChecks.');
    }
    if (evidenceCheck.input !== undefined && (!evidenceCheck.input || typeof evidenceCheck.input !== 'object' || Array.isArray(evidenceCheck.input))) {
      throw new Error('Veritas adapter evidence.evidenceChecks[].input must be an object when provided.');
    }
  }
  if (!['observation', 'extraction', 'validation', 'corroboration', 'attestation', 'auditability', 'anchoring', 'monitoring'].includes(evidenceCheck.method)) {
    throw new Error(`Veritas adapter evidence.evidenceChecks[].method contains unsupported value: ${evidenceCheck.method}`);
  }
  if (evidenceCheck.surfaceClaimIds !== undefined && !Array.isArray(evidenceCheck.surfaceClaimIds)) {
    throw new Error('Veritas adapter evidence.evidenceChecks[].surfaceClaimIds must be an array of strings.');
  }
  if (evidenceCheck.externalTool !== undefined) {
    assertExternalToolConfig(evidenceCheck.externalTool);
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

export function serializeEvidenceCheckRoutes(config) {
  return readEvidenceCheckRoutes(config).map((route) => ({
    component_ids: uniqueStrings(route.componentIds ?? []),
    evidence_check_ids: uniqueStrings(route.evidenceCheckIds ?? []),
  }));
}
