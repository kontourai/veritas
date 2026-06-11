import { normalizeRepoPath } from '../paths.mjs';
import { evaluateRepoStandards } from '../rules/evaluate.mjs';
import { produceSurfaceStateForVeritasRecord } from '../surface/producer.mjs';
import { buildAttestationPolicyResult } from '../attestations.mjs';
import {
  readDefaultEvidenceCheckIds,
  readRequiredEvidenceCheckIds,
  loadEvidenceInventoryResults,
  buildReadinessCoverage,
  buildExternalToolResults,
  serializeEvidenceCheckRoutes,
} from '../evidence/index.mjs';
import {
  buildAllEvidenceChecks,
  buildEvidenceRecommendations,
  buildSelectedEvidenceChecks,
  resolveSelectedEvidenceCheckSources,
} from './evidence-checks.mjs';
import { buildEvidenceIntegrity, resolveSourceRef } from './integrity.mjs';
import {
  parseBaselineCiFastStatus,
  resolveEvidenceCheckPlan,
  resolveWorkstream,
} from './planning.mjs';

function requireRepoStandards(repoStandards) {
  if (!repoStandards) {
    throw new Error('buildEvidenceRecord requires a repoStandards');
  }
  return repoStandards;
}

function resolvePolicyDefaults(config) {
  return {
    false_positive_review: config.policy?.defaultFalsePositiveReview ?? 'unknown',
    promotion_candidate: config.policy?.defaultPromotionCandidate ?? false,
    override_or_bypass: config.policy?.defaultExceptionAllowed ?? false,
  };
}

function resolvePolicyResultSet({
  repoStandards,
  rootDir,
  normalizedFiles,
  config,
  options,
}) {
  const policyResults =
    options.policyResults ??
    evaluateRepoStandards(repoStandards, {
      rootDir,
      changedFiles: normalizedFiles,
      config,
      actor: options.actor,
    });
  const governanceState = options.governanceState ?? options.attestationStatus;
  const resolvedPolicyResults = governanceState
    ? [
        buildAttestationPolicyResult(governanceState),
        ...policyResults,
      ]
    : policyResults;
  return {
    governanceState,
    policyResults: resolvedPolicyResults,
  };
}

function buildProducerSnapshot({ recordSchemaVersion, config, policyDefaults }) {
  return {
    name: 'veritas',
    record_schema_version: recordSchemaVersion,
    resolver_precedence: config.graph.resolverPrecedence,
    policy_defaults: policyDefaults,
  };
}

function buildRepoMapSnapshot({
  config,
  allEvidenceChecks,
  evidenceCheckPlan,
}) {
  return {
    name: config.name ?? config.repoMap?.name,
    kind: config.kind ?? config.repoMap?.kind,
    report_transport: config.evidence.reportTransport,
    default_resolution: config.graph.defaultResolution,
    non_sliceable_invariants: config.graph.nonSliceableInvariants,
    evidenceChecks: allEvidenceChecks.map(({ selected, ...evidenceCheck }) => evidenceCheck),
    required_evidence_check_ids: readRequiredEvidenceCheckIds(config),
    default_evidence_check_ids: readDefaultEvidenceCheckIds(config),
    evidence_check_routes: serializeEvidenceCheckRoutes(config),
    uncovered_path_policy: evidenceCheckPlan.uncoveredPathPolicy,
  };
}

function buildBaseEvidenceRecord({
  recordSchemaVersion,
  runId,
  timestamp,
  sourceRef,
  sourceKind,
  sourceScope,
  integrity,
  resolution,
  evidenceCheckPlan,
  selectedEvidenceChecks,
  selectedEvidenceCheckSources,
  selectedEvidenceCheckIds,
  evidenceInventoryResults,
  allEvidenceChecks,
  recommendations,
  policyDefaults,
  normalizedFiles,
  baselineCiFastPassed,
  repoStandards,
  policyResults,
  governanceState,
  config,
  rootDir,
  options,
}) {
  const { affectedNodes, affectedEvidenceChecks, unmatchedFiles, matchedNodes, fileNodes } = evidenceCheckPlan;
  return {
    record_schema_version: recordSchemaVersion,
    run_id: runId,
    timestamp,
    source_ref: sourceRef,
    source_kind: sourceKind,
    source_scope: sourceScope,
    integrity,
    resolved_phase: resolution.resolvedPhase,
    resolved_workstream: resolution.resolvedWorkstream,
    matched_artifacts: resolution.matchedArtifacts,
    components: affectedNodes,
    component_details: matchedNodes ?? [],
    file_nodes: fileNodes ?? {},
    triggered_evidence_checks: affectedEvidenceChecks,
    selected_evidence_check_ids: selectedEvidenceCheckIds,
    selected_evidence_check_labels: selectedEvidenceChecks.map((evidenceCheck) => evidenceCheck.label),
    selected_evidence_checks: selectedEvidenceChecks,
    evidence_check_resolution_source: evidenceCheckPlan.resolutionSource,
    evidence_inventory_results: evidenceInventoryResults,
    readiness_coverage: buildReadinessCoverage({
      evidenceChecks: allEvidenceChecks,
      evidenceInventoryResults,
    }),
    external_tool_results: buildExternalToolResults({
      evidenceChecks: selectedEvidenceCheckSources,
      rootDir,
    }),
    uncovered_path_result: evidenceCheckPlan.uncoveredPathResult,
    baseline_ci_fast_passed: baselineCiFastPassed,
    recommendations,
    false_positive_review: policyDefaults.false_positive_review,
    promotion_candidate: policyDefaults.promotion_candidate,
    override_or_bypass: policyDefaults.override_or_bypass,
    owner: options.owner ?? null,
    files: normalizedFiles,
    unresolved_files: unmatchedFiles,
    promotion_allowed: resolution.promotionAllowed,
    producer: buildProducerSnapshot({ recordSchemaVersion, config, policyDefaults }),
    repo_map: buildRepoMapSnapshot({ config, allEvidenceChecks, evidenceCheckPlan }),
    repo_standards: {
      name: repoStandards.name,
      version: repoStandards.version,
      rule_count: repoStandards.rules.length,
    },
    policy_results: policyResults,
    ...(governanceState ? { governance_state: governanceState } : {}),
  };
}

export async function buildEvidenceRecord({
  files,
  options = {},
  config,
  repoStandards,
  rootDir,
}) {
  const recordSchemaVersion = config.recordSchemaVersion ?? config.graph?.version;
  const runId = options.runId ?? `veritas-${Date.now()}`;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalizedFiles = files.map((file) => normalizeRepoPath(file, rootDir));
  const evidenceCheckPlan =
    options.evidenceCheckPlan ??
    resolveEvidenceCheckPlan({
      files,
      config,
      rootDir,
      explicitEvidenceCheckCommand: options.explicitEvidenceCheckCommand,
    });
  const recommendations = buildEvidenceRecommendations(evidenceCheckPlan);
  const resolution = resolveWorkstream(options, config, normalizedFiles);
  const baselineCiFastPassed = parseBaselineCiFastStatus(
    options.baselineCiFastStatus,
  );
  const policyDefaults = resolvePolicyDefaults(config);
  const resolvedRepoStandards = requireRepoStandards(repoStandards);
  const { governanceState, policyResults } = resolvePolicyResultSet({
    repoStandards: resolvedRepoStandards,
    rootDir,
    normalizedFiles,
    config,
    options,
  });
  const selectedEvidenceCheckSources = resolveSelectedEvidenceCheckSources(config, evidenceCheckPlan);
  const selectedEvidenceChecks = buildSelectedEvidenceChecks({
    evidenceChecks: selectedEvidenceCheckSources,
    evidenceCheckResults: options.evidenceCheckResults,
  });
  const selectedEvidenceCheckIds = selectedEvidenceChecks.map((evidenceCheck) => evidenceCheck.id);
  const evidenceInventoryResults = loadEvidenceInventoryResults(config, rootDir, selectedEvidenceCheckIds);
  const allEvidenceChecks = buildAllEvidenceChecks(config, selectedEvidenceCheckIds);
  const sourceRef = resolveSourceRef({
    explicitSourceRef: options.sourceRef,
    rootDir,
    sourceKind: options.sourceKind,
  });
  const sourceKind = options.sourceKind ?? 'explicit-files';
  const sourceScope = options.sourceScope ?? ['explicit'];
  const integrity = buildEvidenceIntegrity({
    rootDir,
    normalizedFiles,
    sourceRef,
    sourceKind,
    sourceScope,
    config,
    repoStandards: resolvedRepoStandards,
    options,
  });

  const record = buildBaseEvidenceRecord({
    recordSchemaVersion,
    runId,
    timestamp,
    sourceRef,
    sourceKind,
    sourceScope,
    integrity,
    resolution,
    evidenceCheckPlan,
    selectedEvidenceChecks,
    selectedEvidenceCheckSources,
    selectedEvidenceCheckIds,
    evidenceInventoryResults,
    allEvidenceChecks,
    recommendations,
    policyDefaults,
    normalizedFiles,
    baselineCiFastPassed,
    repoStandards: resolvedRepoStandards,
    policyResults,
    governanceState,
    config,
    rootDir,
    options,
  });
  const surface = await produceSurfaceStateForVeritasRecord(record, {
    rootDir,
    repoMapConfig: config,
  });
  return {
    ...record,
    surface,
  };
}
