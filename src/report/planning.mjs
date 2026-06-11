import { classifyNodes } from '../repo/classify.mjs';
import { matchesPatternsForAnyFile } from '../util/patterns.mjs';
import { uniqueStrings } from '../util/strings.mjs';
import {
  readEvidenceCheckRoutes,
  readDefaultEvidenceCheckIds,
  readRequiredEvidenceCheckIds,
  evidenceChecksByIds,
  evidenceCheckRecordsForCommands,
  readUncoveredPathPolicy,
  routeMatchesAnyComponent,
} from '../evidence/index.mjs';

export function resolveEvidenceCheckPlan({
  files,
  config,
  rootDir,
  explicitEvidenceCheckCommand,
}) {
  const {
    affectedNodes,
    affectedEvidenceChecks,
    unmatchedFiles,
    matchedNodes,
    fileNodes,
  } = classifyNodes(files, config, rootDir);
  const uncoveredPathPolicy = readUncoveredPathPolicy(config);
  const evidenceCheckRoutes = readEvidenceCheckRoutes(config);
  const matchedRoutes = evidenceCheckRoutes.filter((route) => routeMatchesAnyComponent(route, affectedNodes));
  let evidenceChecks = [];
  let resolutionSource = 'none';

  if (explicitEvidenceCheckCommand) {
    evidenceChecks = evidenceCheckRecordsForCommands(config, [explicitEvidenceCheckCommand]);
    resolutionSource = 'explicit';
  } else if (matchedRoutes.length > 0) {
    const routedComponentIds = new Set(
      matchedRoutes.flatMap((route) => (route.componentIds ?? []).filter((componentId) => affectedNodes.includes(componentId))),
    );
    evidenceChecks = evidenceChecksByIds(config, uniqueStrings(matchedRoutes.flatMap((route) => route.evidenceCheckIds ?? [])));
    if (affectedNodes.some((nodeId) => !routedComponentIds.has(nodeId))) {
      const defaultEvidenceCheckIds = readDefaultEvidenceCheckIds(config);
      const requiredEvidenceCheckIds = readRequiredEvidenceCheckIds(config);
      const fallbackEvidenceChecks = evidenceChecksByIds(config, defaultEvidenceCheckIds.length > 0 ? defaultEvidenceCheckIds : requiredEvidenceCheckIds);
      const seenEvidenceCheckIds = new Set(evidenceChecks.map((evidenceCheck) => evidenceCheck.id));
      evidenceChecks = [...evidenceChecks, ...fallbackEvidenceChecks.filter((evidenceCheck) => !seenEvidenceCheckIds.has(evidenceCheck.id))];
    }
    resolutionSource = 'surface';
  } else {
    const defaultEvidenceCheckIds = readDefaultEvidenceCheckIds(config);
    const requiredEvidenceCheckIds = readRequiredEvidenceCheckIds(config);

    if (defaultEvidenceCheckIds.length > 0) {
      evidenceChecks = evidenceChecksByIds(config, defaultEvidenceCheckIds);
      resolutionSource = 'default';
    } else if (requiredEvidenceCheckIds.length > 0) {
      evidenceChecks = evidenceChecksByIds(config, requiredEvidenceCheckIds);
      resolutionSource = 'required';
    }
  }
  const evidenceCheckCommands = evidenceChecks.flatMap((evidenceCheck) => (evidenceCheck.runner ?? 'bash') === 'mcp' ? [] : [evidenceCheck.command]);

  return {
    affectedNodes,
    affectedEvidenceChecks,
    matchedNodes,
    fileNodes,
    unmatchedFiles,
    uncoveredPathPolicy,
    uncoveredPathResult: unmatchedFiles.length > 0 ? uncoveredPathPolicy : 'clear',
    evidenceCheckCommands,
    evidenceChecks,
    resolutionSource,
  };
}

export function resolveWorkstream(options, config, normalizedFiles = []) {
  if (options.workstream) {
    const resolvedPhase =
      options.phase ??
      config.graph.activePhase ??
      config.graph.defaultResolution?.phase;
    return {
      resolvedPhase,
      resolvedWorkstream: options.workstream,
      matchedArtifacts: ['explicit-workstream'],
      promotionAllowed: options.workstream !== 'multi-workstream',
    };
  }

  for (const rule of config.graph.resolutionRules ?? []) {
    if (matchesPatternsForAnyFile(normalizedFiles, rule.match.patterns)) {
      return {
        resolvedPhase: rule.resolution.phase,
        resolvedWorkstream: rule.resolution.workstream,
        matchedArtifacts: rule.resolution.matchedArtifacts,
        promotionAllowed: true,
      };
    }
  }

  const defaultResolution = config.graph.defaultResolution;
  return {
    resolvedPhase: defaultResolution.phase,
    resolvedWorkstream: defaultResolution.workstream,
    matchedArtifacts: defaultResolution.matchedArtifacts,
    promotionAllowed: true,
  };
}

export function parseBaselineCiFastStatus(status) {
  if (status === 'success') return true;
  if (status === 'failed') return false;
  return null;
}

export function formatTriState(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}
