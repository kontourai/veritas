import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { loadJson } from '../load.mjs';
import { uniqueStrings } from '../util/strings.mjs';

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

export function assertExternalToolConfig(externalTool) {
  if (!externalTool || typeof externalTool !== 'object' || Array.isArray(externalTool)) {
    throw new Error('Veritas adapter evidence.proofLanes[].externalTool must be an object.');
  }
  for (const field of ['tool', 'format', 'artifactPath']) {
    if (typeof externalTool[field] !== 'string' || externalTool[field].length === 0) {
      throw new Error(`Veritas adapter evidence.proofLanes[].externalTool.${field} must be a non-empty string.`);
    }
  }
  if (typeof externalTool.blocking !== 'boolean') {
    throw new Error('Veritas adapter evidence.proofLanes[].externalTool.blocking must be a boolean.');
  }
  const artifactPath = externalTool.artifactPath;
  if (artifactPath.startsWith('/') || artifactPath.includes('..') || !artifactPath.startsWith('.veritas/')) {
    throw new Error('Veritas adapter evidence.proofLanes[].externalTool.artifactPath must be a repo-local path inside .veritas/.');
  }
}

export function readExternalToolPayload(rootDir, artifactPath) {
  const resolvedPath = resolve(rootDir, artifactPath);
  assertWithinDir(
    resolvedPath,
    resolve(rootDir, '.veritas'),
    'external tool artifacts may only be read from .veritas/',
  );
  if (!existsSync(resolvedPath)) return null;
  try {
    return JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read external tool artifact ${artifactPath}: ${error.message}`);
  }
}

export function normalizeExternalToolVerdict(payload) {
  if (payload?.verdict === 'pass' || payload?.verdict === 'warn' || payload?.verdict === 'fail') {
    return payload.verdict;
  }
  if (typeof payload?.total_issues === 'number') {
    return payload.total_issues > 0 ? 'warn' : 'pass';
  }
  if (payload?.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)) {
    const numericCounts = Object.values(payload.summary).filter((value) => typeof value === 'number');
    if (numericCounts.length > 0) {
      return numericCounts.some((value) => value > 0) ? 'warn' : 'pass';
    }
  }
  return 'unknown';
}

export function externalToolSummary(payload) {
  const summary = {};
  if (payload?.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)) {
    Object.assign(summary, payload.summary);
  }
  if (typeof payload?.total_issues === 'number') summary.total_issues = payload.total_issues;
  if (Array.isArray(payload?.unused_exports)) summary.unused_exports = payload.unused_exports.length;
  if (Array.isArray(payload?.unused_files)) summary.unused_files = payload.unused_files.length;
  if (Array.isArray(payload?.unused_dependencies)) summary.unused_dependencies = payload.unused_dependencies.length;
  if (Array.isArray(payload?.boundary_violations)) summary.boundary_violations = payload.boundary_violations.length;
  if (Array.isArray(payload?.circular_dependencies)) summary.circular_dependencies = payload.circular_dependencies.length;
  if (Array.isArray(payload?.duplication?.clone_groups)) summary.duplication_clone_groups = payload.duplication.clone_groups.length;
  if (Array.isArray(payload?.dupes?.clone_groups)) summary.duplication_clone_groups = payload.dupes.clone_groups.length;
  if (typeof payload?.health?.summary?.functions_above_threshold === 'number') {
    summary.functions_above_threshold = payload.health.summary.functions_above_threshold;
  }
  return summary;
}

export function externalToolActions(payload) {
  if (!Array.isArray(payload?.actions)) return [];
  return payload.actions
    .filter((action) => action && typeof action === 'object')
    .slice(0, 20)
    .map((action) => ({
      type: String(action.type ?? 'external-tool-action'),
      description: String(action.description ?? action.message ?? 'External tool action'),
      auto_fixable: Boolean(action.auto_fixable),
      ...(Array.isArray(action.paths) ? { paths: action.paths.filter((path) => typeof path === 'string') } : {}),
    }));
}

export function buildExternalToolResults({ proofLanes, rootDir }) {
  return proofLanes
    .filter((lane) => lane.externalTool)
    .map((lane) => {
      const externalTool = lane.externalTool;
      const payload = readExternalToolPayload(rootDir, externalTool.artifactPath);
      if (!payload) {
        return {
          tool: externalTool.tool,
          format: externalTool.format,
          command: lane.command,
          proof_lane_id: lane.id,
          verdict: 'missing',
          blocking: externalTool.blocking,
          summary: {
            message: `External tool artifact ${externalTool.artifactPath} was not found.`,
          },
          artifact_path: externalTool.artifactPath,
          actions: [],
        };
      }
      return {
        tool: externalTool.tool,
        format: externalTool.format,
        command: lane.command,
        proof_lane_id: lane.id,
        verdict: normalizeExternalToolVerdict(payload),
        blocking: externalTool.blocking,
        summary: externalToolSummary(payload),
        artifact_path: externalTool.artifactPath,
        actions: externalToolActions(payload),
      };
    });
}

export function readProofFamilyManifestPaths(config) {
  return uniqueStrings(config.evidence?.proofFamilyManifests ?? []);
}

const PROOF_FAMILY_DISPOSITIONS = [
  'required',
  'candidate',
  'advisory',
  'move-to-test',
  'retire',
  'upstream-abstraction',
];

function readProofFamilyField(family, camelKey, snakeKey, fallback = null) {
  if (family[camelKey] !== undefined) return family[camelKey];
  if (snakeKey && family[snakeKey] !== undefined) return family[snakeKey];
  return fallback;
}

function assertProofFamilyString(value, label, { required = true } = {}) {
  if (!required && (value === undefined || value === null)) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function normalizeProofFamilyDisposition(family) {
  const disposition = family.defaultDisposition ?? family.disposition ?? 'candidate';
  if (family.currentBlockingStatus === 'required' || disposition === 'required') return 'required';
  if (disposition === 'retire') return 'retire';
  if (disposition === 'move-to-test') return 'move-to-test';
  if (disposition === 'upstream-abstraction') return 'upstream-abstraction';
  if (family.currentBlockingStatus === 'advisory' || disposition === 'advisory') return 'advisory';
  return 'candidate';
}

export function validateProofFamilyManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`proof-family manifest must be an object: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.families) || manifest.families.length === 0) {
    throw new Error(`proof-family manifest requires a non-empty families array: ${manifestPath}`);
  }

  const ids = new Set();
  for (const family of manifest.families) {
    if (!family || typeof family !== 'object' || Array.isArray(family)) {
      throw new Error(`proof-family manifest family must be an object: ${manifestPath}`);
    }
    assertProofFamilyString(family.id, `proof-family id in ${manifestPath}`);
    if (ids.has(family.id)) {
      throw new Error(`proof-family manifest contains duplicate family id: ${family.id}`);
    }
    ids.add(family.id);

    const rawDisposition = family.defaultDisposition ?? family.disposition;
    if (rawDisposition !== undefined && !PROOF_FAMILY_DISPOSITIONS.includes(rawDisposition)) {
      throw new Error(`proof-family ${family.id} has unsupported defaultDisposition: ${rawDisposition}`);
    }

    const disposition = normalizeProofFamilyDisposition(family);
    if (!PROOF_FAMILY_DISPOSITIONS.includes(disposition)) {
      throw new Error(`proof-family ${family.id} has unsupported disposition: ${disposition}`);
    }

    const required = disposition === 'required' || family.currentBlockingStatus === 'required';
    assertProofFamilyString(
      readProofFamilyField(family, 'laneId', 'lane_id', manifest.sourceProofLaneId),
      `proof-family ${family.id} laneId`,
    );
    assertProofFamilyString(family.owner, `proof-family ${family.id} owner`, { required });
    assertProofFamilyString(
      readProofFamilyField(family, 'expiryOrReviewTrigger', 'review_trigger'),
      `proof-family ${family.id} review trigger`,
      { required },
    );
    if (
      required &&
      readProofFamilyField(family, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown') === 'unknown'
    ) {
      throw new Error(`proof-family ${family.id} cannot be required with unknown recent catch evidence`);
    }
  }
}

export function verificationWeightForDisposition(disposition) {
  if (disposition === 'required') return 'blocking';
  if (disposition === 'candidate' || disposition === 'move-to-test' || disposition === 'upstream-abstraction') {
    return 'advisory';
  }
  return 'informational';
}

export function loadProofFamilyResults(config, rootDir, selectedProofLaneIds = []) {
  const selectedIds = new Set(selectedProofLaneIds);
  return readProofFamilyManifestPaths(config).flatMap((manifestPath) => {
    const resolvedManifestPath = resolve(rootDir, manifestPath);
    assertWithinDir(
      resolvedManifestPath,
      resolve(rootDir, '.veritas'),
      'proof-family manifests must live inside .veritas/',
    );
    const manifest = loadJson(resolvedManifestPath, 'proof-family manifest');
    const relativeManifestPath = relativeRepoPath(rootDir, resolvedManifestPath);
    validateProofFamilyManifest(manifest, relativeManifestPath);
    return (manifest.families ?? []).map((family) => {
      const disposition = normalizeProofFamilyDisposition(family);
      const laneId = family.laneId ?? family.proofLaneId ?? manifest.sourceProofLaneId ?? 'unknown';
      const recentCatchEvidence = readProofFamilyField(
        family,
        'recentCatchEvidence',
        'recent_catch_evidence',
        'unknown',
      );
      const reviewTrigger = readProofFamilyField(
        family,
        'expiryOrReviewTrigger',
        'review_trigger',
        null,
      );
      const lastReviewed = readProofFamilyField(family, 'lastReviewed', 'last_reviewed', null);
      const evidenceBasis = readProofFamilyField(
        family,
        'evidenceBasis',
        'evidence_basis',
        recentCatchEvidence === 'unknown' ? 'unknown' : 'recorded-catch-evidence',
      );
      const freshnessStatus =
        readProofFamilyField(family, 'freshnessStatus', 'freshness_status') ??
        (disposition === 'retire'
          ? 'retiring'
          : !reviewTrigger || recentCatchEvidence === 'unknown'
            ? 'review-needed'
            : 'current');
      return {
        id: family.id,
        lane_id: laneId,
        source_proof_lane_id: manifest.sourceProofLaneId ?? null,
        manifest_path: relativeManifestPath,
        destination: family.destination ?? null,
        owner: family.owner ?? null,
        disposition,
        blocking_status: family.currentBlockingStatus ?? disposition,
        verification_weight: verificationWeightForDisposition(disposition),
        selected: selectedIds.has(laneId),
        recent_catch_evidence: recentCatchEvidence,
        regression_severity: family.regressionSeverity ?? 'unknown',
        false_positive_risk: family.falsePositiveRisk ?? 'unknown',
        replacement_test_available: family.replacementTestAvailable ?? null,
        review_trigger: reviewTrigger,
        last_reviewed: lastReviewed,
        evidence_basis: evidenceBasis,
        freshness_status: freshnessStatus,
        rationale: family.rationale ?? '',
      };
    });
  });
}

export function buildVerificationBudget({ proofLanes, proofFamilyResults }) {
  const laneCount = proofLanes.length;
  const selectedLaneCount = proofLanes.filter((lane) => lane.selected).length;
  const requiredFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'required',
  ).length;
  const candidateFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'candidate',
  ).length;
  const advisoryFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'advisory',
  ).length;
  const moveToTestFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'move-to-test',
  ).length;
  const retireFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'retire',
  ).length;
  const upstreamCandidateCount = proofFamilyResults.filter(
    (family) => family.disposition === 'upstream-abstraction',
  ).length;

  const unknownCatchEvidenceFamilies = proofFamilyResults
    .filter((family) => family.recent_catch_evidence === 'unknown')
    .map((family) => family.id);
  const missingReviewTriggerFamilies = proofFamilyResults
    .filter((family) => !family.review_trigger)
    .map((family) => family.id);
  const staleFamilies = proofFamilyResults
    .filter(
      (family) =>
        family.freshness_status === 'review-needed' ||
        family.freshness_status === 'stale' ||
        family.disposition === 'retire'
    )
    .map((family) => family.id);
  const staleOrUnknownFamilies = uniqueStrings([
    ...unknownCatchEvidenceFamilies,
    ...missingReviewTriggerFamilies,
    ...staleFamilies,
  ]);

  return {
    proof_lane_count: laneCount,
    selected_proof_lane_count: selectedLaneCount,
    proof_family_count: proofFamilyResults.length,
    required_family_count: requiredFamilyCount,
    candidate_family_count: candidateFamilyCount,
    advisory_family_count: advisoryFamilyCount,
    move_to_test_family_count: moveToTestFamilyCount,
    retire_family_count: retireFamilyCount,
    upstream_candidate_count: upstreamCandidateCount,
    unknown_catch_evidence_family_ids: unknownCatchEvidenceFamilies,
    missing_review_trigger_family_ids: missingReviewTriggerFamilies,
    stale_family_ids: staleFamilies,
    stale_or_unknown_family_ids: staleOrUnknownFamilies,
    recommendation:
      staleOrUnknownFamilies.length > 0
        ? 'Review unknown, retiring, or triggerless proof families before promoting more checks.'
        : 'Verification budget has owners, review triggers, and no unknown catch-evidence families.',
  };
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
  if (policy === 'ignore' || policy === 'fail') {
    return policy;
  }
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

