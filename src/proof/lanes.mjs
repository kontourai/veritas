import { uniqueStrings } from '../util/strings.mjs';
import { assertExternalToolConfig } from './external-tools.mjs';
import { readProofFamilyManifestPaths } from './family.mjs';

export function readSurfaceProofRoutes(config) {
  assertV2ProofLaneConfig(config);
  return Array.isArray(config.evidence?.surfaceProofRoutes)
    ? config.evidence.surfaceProofRoutes
    : [];
}

export function readProofLanes(config) {
  assertV2ProofLaneConfig(config);
  return Array.isArray(config.evidence?.proofLanes) ? config.evidence.proofLanes : [];
}

export function readDefaultProofLaneIds(config) {
  assertV2ProofLaneConfig(config);
  return uniqueStrings(config.evidence?.defaultProofLaneIds ?? []);
}

export function readRequiredProofLaneIds(config) {
  assertV2ProofLaneConfig(config);
  return uniqueStrings(config.evidence?.requiredProofLaneIds ?? []);
}

export function proofLaneById(config) {
  return new Map(readProofLanes(config).map((lane) => [lane.id, lane]));
}

export function proofCommandsForLaneIds(config, laneIds) {
  const lanes = proofLaneById(config);
  return uniqueStrings(laneIds.map((id) => lanes.get(id)?.command).filter(Boolean));
}

export function proofLaneRecordsForCommands(config, commands) {
  const lanes = readProofLanes(config);
  return commands.map((command) => {
    const lane = lanes.find((item) => item.command === command);
    return lane ?? {
      id: command.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'explicit-proof',
      command,
      method: 'validation',
      summary: `Explicit proof command: ${command}`,
    };
  });
}

export function assertV2ProofLaneConfig(config) {
  const evidence = config.evidence ?? {};
  const legacyFields = ['requiredProofLanes', 'defaultProofLanes', 'surfaceProofLanes'].filter((field) => field in evidence);
  if (legacyFields.length > 0) {
    throw new Error(
      `Veritas adapter proof lane config uses legacy field(s): ${legacyFields.join(', ')}. Migrate to evidence.proofLanes[].command, requiredProofLaneIds, defaultProofLaneIds, and surfaceProofRoutes; see docs/reference/artifacts-and-schemas.md#adapter-proof-lane-migration.`,
    );
  }

  if (!Array.isArray(evidence.proofLanes) || evidence.proofLanes.length === 0) {
    throw new Error('Veritas adapter evidence.proofLanes must contain proof-lane objects with id, command, and method.');
  }

  const laneIds = new Set();
  for (const lane of evidence.proofLanes) {
    assertProofLaneObject(lane);
    if (laneIds.has(lane.id)) throw new Error(`Veritas adapter evidence.proofLanes contains duplicate id: ${lane.id}`);
    laneIds.add(lane.id);
  }

  for (const field of ['requiredProofLaneIds', 'defaultProofLaneIds']) {
    for (const id of uniqueStrings(evidence[field] ?? [])) {
      if (!laneIds.has(id)) throw new Error(`Veritas adapter evidence.${field} references unknown proof lane id: ${id}`);
    }
  }

  for (const route of evidence.surfaceProofRoutes ?? []) {
    if (!Array.isArray(route.proofLaneIds)) {
      throw new Error('Veritas adapter evidence.surfaceProofRoutes[].proofLaneIds must reference proof lane ids.');
    }
    for (const id of uniqueStrings(route.proofLaneIds)) {
      if (!laneIds.has(id)) throw new Error(`Veritas adapter surface proof route references unknown proof lane id: ${id}`);
    }
  }

  for (const manifestPath of readProofFamilyManifestPaths(config)) {
    if (manifestPath.startsWith('/') || manifestPath.includes('..')) {
      throw new Error('Veritas adapter evidence.proofFamilyManifests must contain repo-local paths inside .veritas/.');
    }
    if (!manifestPath.startsWith('.veritas/')) {
      throw new Error('Veritas adapter evidence.proofFamilyManifests paths must start with .veritas/.');
    }
  }
}

export function assertProofLaneObject(lane) {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
    throw new Error('Veritas adapter evidence.proofLanes entries must be objects.');
  }
  for (const field of ['id', 'command', 'method']) {
    if (typeof lane[field] !== 'string' || lane[field].length === 0) {
      throw new Error(`Veritas adapter evidence.proofLanes[].${field} must be a non-empty string.`);
    }
  }
  if (!['observation', 'extraction', 'validation', 'corroboration', 'attestation', 'auditability', 'anchoring', 'monitoring'].includes(lane.method)) {
    throw new Error(`Veritas adapter evidence.proofLanes[].method contains unsupported value: ${lane.method}`);
  }
  if (lane.surfaceClaimIds !== undefined && !Array.isArray(lane.surfaceClaimIds)) {
    throw new Error('Veritas adapter evidence.proofLanes[].surfaceClaimIds must be an array of strings.');
  }
  if (lane.externalTool !== undefined) {
    assertExternalToolConfig(lane.externalTool);
  }
}

export function readUncoveredPathPolicy(config) {
  const policy = config.evidence?.uncoveredPathPolicy;
  if (policy === 'ignore' || policy === 'fail') return policy;
  return 'warn';
}

export function routeMatchesAnyNode(route, affectedNodes) {
  return (route.nodeIds ?? []).some((nodeId) => affectedNodes.includes(nodeId));
}

export function serializeSurfaceProofRoutes(config) {
  return readSurfaceProofRoutes(config).map((route) => ({
    node_ids: uniqueStrings(route.nodeIds ?? []),
    proof_lane_ids: uniqueStrings(route.proofLaneIds ?? []),
  }));
}
