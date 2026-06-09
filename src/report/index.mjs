import {
  appendFileSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadRepoMap, loadRepoStandards } from '../load.mjs';
import { normalizeRepoPath } from '../paths.mjs';
import { uniqueStrings } from '../util/strings.mjs';
import { evaluateRepoStandards } from '../rules/evaluate.mjs';
import { produceSurfaceStateForVeritasRecord } from '../surface/producer.mjs';
import {
  writeSurfaceConsoleReadModel,
} from '../surface/console.mjs';
import {
  buildAttestationPolicyResult,
  inspectAttestationStatus,
} from '../attestations.mjs';
import {
  readEvidenceCheckRoutes,
  readEvidenceChecks,
  readDefaultEvidenceCheckIds,
  readRequiredEvidenceCheckIds,
  evidenceChecksByIds,
  evidenceCheckLabel,
  evidenceCheckRecordsForCommands,
  loadEvidenceInventoryResults,
  buildReadinessCoverage,
  buildExternalToolResults,
  serializeEvidenceCheckRoutes,
} from '../evidence/index.mjs';
import { buildEvidenceIntegrity, resolveSourceRef } from './integrity.mjs';
import {
  formatTriState,
  parseBaselineCiFastStatus,
  resolveEvidenceCheckPlan,
  resolveWorkstream,
} from './planning.mjs';
import {
  listChangedFiles,
  listWorkingTreeFiles,
  resolveReportInputs,
} from './inputs.mjs';
import {
  writeEvidenceArtifact,
  writeSurfaceClaimInputs,
} from './artifacts.mjs';
import {
  buildMarkdownSummary,
  feedbackStatusForPolicyResult,
  buildFeedbackSummary,
  feedbackHasFailures,
  buildStandardsFeedbackMarkdownSummary,
  buildStandardsFeedbackDraftMarkdownSummary,
} from './format.mjs';

function evidenceCheckResultById(evidenceCheckResults, id) {
  return (evidenceCheckResults ?? []).find((result) => result.id === id) ?? null;
}

function evidenceCheckResultSummary(result) {
  if (!result) return null;
  if (result.passed) return 'All evidence checks passed.';
  if (result.runner === 'mcp') {
    const text = result.content?.find((content) => content.type === 'text')?.text;
    return text
      ? `MCP tool error: ${text.split('\n')[0]}`
      : 'MCP tool returned an error.';
  }
  const status = result.exitCode !== null && result.exitCode !== undefined
    ? `exit code ${result.exitCode}`
    : `signal ${result.signal ?? 'unknown'}`;
  const firstOutputLine = String(result.stderr || result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstOutputLine
    ? `Evidence checks failed with ${status}: ${firstOutputLine}`
    : `Evidence checks failed with ${status}.`;
}

function requireRepoStandards(repoStandards) {
  if (!repoStandards) {
    throw new Error('buildEvidenceRecord requires a repoStandards');
  }
  return repoStandards;
}

function buildEvidenceRecommendations(evidenceCheckPlan) {
  const { unmatchedFiles } = evidenceCheckPlan;
  if (!unmatchedFiles.length) return [];

  const unresolvedMessage =
    evidenceCheckPlan.uncoveredPathResult === 'fail'
      ? 'Some files do not match a configured work area and fail the uncovered-path policy.'
      : evidenceCheckPlan.uncoveredPathResult === 'ignore'
        ? 'Some files do not match a configured work area and were ignored by policy.'
        : 'Some files do not match a configured work area and need manual review.';

  return [
    {
      kind: 'unmatched-files',
      severity: evidenceCheckPlan.uncoveredPathResult,
      message: unresolvedMessage,
      files: unmatchedFiles,
    },
  ];
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

function resolveSelectedEvidenceCheckSources(config, evidenceCheckPlan) {
  return evidenceCheckPlan.evidenceChecks ??
    evidenceCheckRecordsForCommands(config, evidenceCheckPlan.evidenceCheckCommands);
}

function buildSelectedEvidenceChecks({ evidenceChecks, evidenceCheckResults }) {
  return evidenceChecks.map((evidenceCheck) => {
    const label = evidenceCheckLabel(evidenceCheck);
    const runner = evidenceCheck.runner ?? 'bash';
    const evidenceCheckResult = evidenceCheckResultById(evidenceCheckResults, evidenceCheck.id);
    return {
      id: evidenceCheck.id,
      runner,
      label,
      ...(evidenceCheck.command ? { command: evidenceCheck.command } : {}),
      method: evidenceCheck.method,
      surface_claim_ids: uniqueStrings(evidenceCheck.surfaceClaimIds ?? []),
      summary: evidenceCheckResultSummary(evidenceCheckResult) ?? evidenceCheck.summary ?? `Evidence Check ${evidenceCheck.id}: ${label}`,
      ...(evidenceCheckResult ? { evidence_check_result: evidenceCheckResult } : {}),
    };
  });
}

function buildAllEvidenceChecks(config, selectedEvidenceCheckIds) {
  return readEvidenceChecks(config).map((evidenceCheck) => ({
    id: evidenceCheck.id,
    runner: evidenceCheck.runner ?? 'bash',
    label: evidenceCheckLabel(evidenceCheck),
    ...(evidenceCheck.command ? { command: evidenceCheck.command } : {}),
    method: evidenceCheck.method,
    surface_claim_ids: uniqueStrings(evidenceCheck.surfaceClaimIds ?? []),
    summary: evidenceCheck.summary ?? '',
    selected: selectedEvidenceCheckIds.includes(evidenceCheck.id),
  }));
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

export function mergeStandardsFeedbackRecordOptions(options, draft) {
  const falsePositiveRules = options.falsePositiveRules ?? [];
  const missedIssues = options.missedIssues ?? [];
  const notes = options.notes ?? [];

  return {
    acceptedWithoutMajorRewrite: options.acceptedWithoutMajorRewrite,
    requiredFollowup: options.requiredFollowup,
    reviewerConfidence:
      options.reviewerConfidence ?? draft?.prefilled_outcome?.reviewer_confidence,
    timeToGreenMinutes:
      options.timeToGreenMinutes ??
      (typeof draft?.prefilled_measurements?.time_to_green_minutes === 'number'
        ? draft.prefilled_measurements.time_to_green_minutes
        : undefined),
    exceptionCount:
      options.exceptionCount ?? draft?.prefilled_measurements?.exception_count,
    falsePositiveRules:
      falsePositiveRules.length > 0
        ? falsePositiveRules
        : (draft?.prefilled_measurements?.false_positive_rules ?? []),
    missedIssues:
      missedIssues.length > 0
        ? missedIssues
        : (draft?.prefilled_measurements?.missed_issues ?? []),
    notes: notes.length > 0 ? notes : (draft?.notes ?? []),
  };
}

// bootstrap/install domains live in dedicated modules

// hook/install runtime lives in dedicated modules

export function resolveVeritasPaths(options, defaults = {}) {
  const rootDir = options.rootDir ? resolve(options.rootDir) : defaults.rootDir;
  const defaultRepoMapPath =
    defaults.repoMapPath ??
    (rootDir ? resolve(rootDir, '.veritas/repo-map.json') : undefined);
  const defaultRepoStandardsPath =
    defaults.repoStandardsPath ??
    (rootDir
      ? resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json')
      : undefined);
  const defaultAuthoritySettingsPath =
    defaults.authoritySettingsPath ??
    (rootDir ? resolve(rootDir, '.veritas/authority/default.authority-settings.json') : undefined);

  return {
    rootDir,
    repoMapPath: options.repoMapPath
      ? resolve(rootDir ?? process.cwd(), options.repoMapPath)
      : defaultRepoMapPath,
    repoStandardsPath: options.repoStandardsPath
      ? resolve(rootDir ?? process.cwd(), options.repoStandardsPath)
      : defaultRepoStandardsPath,
    authoritySettingsPath: options.authoritySettingsPath
      ? resolve(rootDir ?? process.cwd(), options.authoritySettingsPath)
      : defaultAuthoritySettingsPath,
  };
}

export async function generateVeritasReport(options = {}, defaults = {}, explicitFiles = []) {
  const { rootDir, repoMapPath, repoStandardsPath, authoritySettingsPath } = resolveVeritasPaths(options, defaults);

  if (!rootDir || !repoMapPath || !repoStandardsPath) {
    throw new Error(
      'Veritas report requires rootDir, repoMapPath, and repoStandardsPath',
    );
  }

  const reportInputs = resolveReportInputs(explicitFiles, options, rootDir);
  const files = reportInputs.files;

  if (files.length === 0 && reportInputs.sourceKind === 'explicit-files') {
    throw new Error('veritas report requires at least one file path');
  }

  const config = loadRepoMap(repoMapPath);
  const repoStandards = loadRepoStandards(repoStandardsPath);
  const evidenceCheckPlan = resolveEvidenceCheckPlan({
    files,
    config,
    rootDir,
    explicitEvidenceCheckCommand: options.explicitEvidenceCheckCommand,
  });
  const attestationStatus = options.includeAttestationGate
    ? inspectAttestationStatus(rootDir, {
        repoStandardsPath,
        repoMapPath,
        authoritySettingsPath,
        now: options.attestationNow ?? options.timestamp,
      })
    : null;
  const record = await buildEvidenceRecord({
    files,
    options: {
      ...options,
      sourceRef: reportInputs.sourceRef,
      sourceKind: reportInputs.sourceKind,
      sourceScope: reportInputs.sourceScope,
      evidenceCheckPlan,
      integritySources: {
        repoMapPath,
        repoStandardsPath,
        authoritySettingsPath,
      },
      ...(attestationStatus ? { governanceState: attestationStatus } : {}),
    },
    config,
    repoStandards,
    rootDir,
  });
  const artifactPath = writeEvidenceArtifact(record, config, rootDir);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const claimInputPaths = writeSurfaceClaimInputs(record, rootDir);
  const consoleReadModelPath = writeSurfaceConsoleReadModel(record, rootDir, {
    evidenceArtifactPath: relativeArtifactPath,
    claimInputPaths,
  });
  const markdownSummary = buildMarkdownSummary(record, relativeArtifactPath);
  const resolvedSummaryPath =
    options.summaryPath ??
    (config.evidence.reportTransport === 'github-step-summary'
      ? process.env.GITHUB_STEP_SUMMARY
      : undefined);

  if (resolvedSummaryPath) {
    appendFileSync(resolvedSummaryPath, markdownSummary, 'utf8');
  }

  return {
    rootDir,
    config,
    record,
    artifactPath: relativeArtifactPath,
    claimInputPaths,
    consoleReadModelPath,
    markdownSummary,
  };
}

export function resolveEvidenceCheckCommands({ repoMapPath, files = [], rootDir, explicitEvidenceCheckCommand }) {
  if (!repoMapPath || !rootDir) {
    return {
      evidenceCheckCommands: explicitEvidenceCheckCommand ? [explicitEvidenceCheckCommand] : [],
      evidenceChecks: explicitEvidenceCheckCommand ? evidenceCheckRecordsForCommands({ evidence: { evidenceChecks: [{ id: 'explicit-evidence-check', runner: 'bash', command: explicitEvidenceCheckCommand, method: 'validation' }] } }, [explicitEvidenceCheckCommand]) : [],
      resolutionSource: explicitEvidenceCheckCommand ? 'explicit' : 'none',
      affectedNodes: [],
      affectedEvidenceChecks: [],
      triggeredEvidenceChecks: [],
      unmatchedFiles: [],
      uncoveredPathPolicy: 'warn',
      uncoveredPathResult: 'clear',
    };
  }
  const config = loadRepoMap(repoMapPath);
  return resolveEvidenceCheckPlan({
    files,
    config,
    rootDir,
    explicitEvidenceCheckCommand,
  });
}

export {
  formatTriState,
  listChangedFiles,
  listWorkingTreeFiles,
  parseBaselineCiFastStatus,
  resolveEvidenceCheckPlan,
  resolveReportInputs,
  resolveWorkstream,
  buildMarkdownSummary,
  feedbackStatusForPolicyResult,
  buildFeedbackSummary,
  feedbackHasFailures,
  buildStandardsFeedbackMarkdownSummary,
  buildStandardsFeedbackDraftMarkdownSummary,
  writeEvidenceArtifact,
  writeSurfaceClaimInputs,
};
