import { classifyNodes } from './classify.mjs';
import { matchesPatternsForAnyFile } from '../util/patterns.mjs';
import { uniqueStrings } from '../util/strings.mjs';
import { resolveRuleEvidenceBindings } from '../evidence/rule-bindings.mjs';
import {
  readEvidenceCheckRoutes,
  readDefaultEvidenceCheckIds,
  readRequiredEvidenceCheckIds,
  evidenceChecksByIds,
  evidenceCheckRecordsForCommands,
  readUncoveredPathPolicy,
  routeMatchesAnyComponent,
  routeNodeIds,
} from '../evidence/index.mjs';

export function resolveEvidenceCheckPlan({
  files,
  config,
  rootDir,
  repoStandards,
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
  const globalRequiredEvidenceCheckIds = readRequiredEvidenceCheckIds(config);
  const ruleEvidenceBindings = resolveRuleEvidenceBindings({ repoStandards, config, files, rootDir });
  const ruleEvidenceCheckIds = uniqueStrings(ruleEvidenceBindings.flatMap((binding) => binding.evidenceCheckIds));
  const requiredEvidenceCheckIds = uniqueStrings([
    ...globalRequiredEvidenceCheckIds,
    ...ruleEvidenceBindings
      .filter((binding) => binding.enforcementLevel === 'Require')
      .flatMap((binding) => binding.evidenceCheckIds),
  ]);
  const matchedRoutes = evidenceCheckRoutes.filter((route) => routeMatchesAnyComponent(route, affectedNodes));
  let evidenceChecks = [];
  let resolutionSource = 'none';

  if (explicitEvidenceCheckCommand) {
    evidenceChecks = evidenceCheckRecordsForCommands(config, [explicitEvidenceCheckCommand]);
    resolutionSource = 'explicit';
  } else if (matchedRoutes.length > 0) {
    const routedComponentIds = new Set(
      matchedRoutes.flatMap((route) => routeNodeIds(route).filter((nodeId) => affectedNodes.includes(nodeId))),
    );
    evidenceChecks = evidenceChecksByIds(config, uniqueStrings(matchedRoutes.flatMap((route) => route.evidenceCheckIds ?? [])));
    if (affectedNodes.some((nodeId) => !routedComponentIds.has(nodeId))) {
      const defaultEvidenceCheckIds = readDefaultEvidenceCheckIds(config);
      const fallbackEvidenceChecks = evidenceChecksByIds(config, defaultEvidenceCheckIds);
      const seenEvidenceCheckIds = new Set(evidenceChecks.map((evidenceCheck) => evidenceCheck.id));
      evidenceChecks = [...evidenceChecks, ...fallbackEvidenceChecks.filter((evidenceCheck) => !seenEvidenceCheckIds.has(evidenceCheck.id))];
    }
    resolutionSource = 'surface';
  } else {
    const defaultEvidenceCheckIds = readDefaultEvidenceCheckIds(config);
    if (defaultEvidenceCheckIds.length > 0) {
      evidenceChecks = evidenceChecksByIds(config, defaultEvidenceCheckIds);
      resolutionSource = 'default';
    } else if (globalRequiredEvidenceCheckIds.length > 0) {
      evidenceChecks = evidenceChecksByIds(config, globalRequiredEvidenceCheckIds);
      resolutionSource = 'required';
    }
  }
  const selectedEvidenceCheckIds = new Set(evidenceChecks.map((evidenceCheck) => evidenceCheck.id));
  const requiredEvidenceChecks = evidenceChecksByIds(config, uniqueStrings([...requiredEvidenceCheckIds, ...ruleEvidenceCheckIds]));
  evidenceChecks = [
    ...evidenceChecks,
    ...requiredEvidenceChecks.filter((evidenceCheck) => !selectedEvidenceCheckIds.has(evidenceCheck.id)),
  ];
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
    requiredEvidenceCheckIds,
    ruleEvidenceBindings,
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
