// @kontourai/veritas/engine — the frozen evaluation-engine library API.
//
// This subpath exports ONLY the engine-classified surface from the engine/surface seam
// (docs/architecture/engine-surface-seam.md, flow-agents#646): rule evaluation, repo
// classify/routing, evidence checks, merge-readiness, report/record building, surface-claim
// projection, attestation READ, and the supporting loaders/paths/util. It deliberately does NOT
// export product surface (init scaffold, hook setup, runtime integrations, standards-feedback
// authoring, attestation authoring, conformance dashboard, CLI runners) — that surface is owned
// by the flow-agents veritas-governance kit and is being removed from this package (#650).
//
// Consume this subpath for a stable, standalone importable engine. The package root (`.`) still
// re-exports everything during the migration, so existing root imports keep working; new
// embedders should target `@kontourai/veritas/engine`.

// --- Loaders (repo map / standards / authority / evidence artifact) ---
export {
  loadJson,
  loadRepoMap,
  loadRepoStandards,
  loadAuthoritySettings,
  loadEvidenceArtifact,
} from './load.mjs';

// --- Path safety / normalization ---
export { normalizeRepoPath } from './paths.mjs';

// --- Argument parsing for the engine's own commands (readiness / report / coverage) ---
export {
  parseTokens,
  parseArgs,
  parseCoverageArgs,
  parseReadinessArgs,
} from './args.mjs';

// --- Repo map classify / evidence-check routing ---
export { classifyNodes } from './repo/classify.mjs';
export {
  resolveEvidenceCheckPlan,
  resolveWorkstream,
} from './repo/routing.mjs';

// --- Evidence checks, external tools, coverage ---
export {
  readEvidenceCheckRoutes,
  readEvidenceChecks,
  readDefaultEvidenceCheckIds,
  readRequiredEvidenceCheckIds,
  commandsForEvidenceCheckIds,
  evidenceCheckRecordsForCommands,
  loadEvidenceInventoryResults,
  buildReadinessCoverage,
  buildExternalToolResults,
  readUncoveredPathPolicy,
  routeMatchesAnyComponent,
  serializeEvidenceCheckRoutes,
} from './evidence/index.mjs';

// --- Rule evaluation ---
export {
  evaluateRequiredArtifactsRule,
  evaluateGovernanceBlockRule,
  evaluateDiffRequiredRule,
  evaluateForbiddenPatternRule,
  evaluateRequiredPatternRule,
  evaluateHeaderRequiredRule,
  evaluatePrimitiveFirstGovernanceRule,
  evaluateWorkAreaBoundaryRule,
  evaluatePolicyRule,
  evaluateRepoStandards,
  RULE_EVALUATORS,
} from './rules/evaluate.mjs';

// --- Merge-readiness orchestration ---
export {
  hasReadinessOutcomeInputs,
  runMergeReadiness,
} from './readiness/run.mjs';

// --- Report / record building + artifacts (engine subset; surface-feedback formatters excluded) ---
export {
  parseBaselineCiFastStatus,
  formatTriState,
  buildEvidenceRecord,
  writeEvidenceArtifact,
  writeSurfaceClaimInputs,
  listChangedFiles,
  listWorkingTreeFiles,
  resolveReportInputs,
  buildMarkdownSummary,
  feedbackStatusForPolicyResult,
  buildFeedbackSummary,
  feedbackHasFailures,
  resolveVeritasPaths,
  generateVeritasReport,
  resolveEvidenceCheckCommands,
} from './report/index.mjs';

// --- Boundaries / explain LOGIC (the `veritas explain` producer; CLI runners stay in the bin) ---
export {
  buildExplainText,
  checkBoundaries,
} from './explain.mjs';

// --- Content-boundary evaluator (an evaluator, not the dashboard) ---
export {
  FLOW_AGENTS_RUNTIME_PREFIX,
  TRACKED_RUNTIME_ARTIFACT_LABEL,
  enumerateContentBoundaryFiles,
  evaluateContentBoundary,
  formatContentBoundaryResult,
  runContentBoundary,
} from './conformance/content-boundary.mjs';

// --- Surface-claim projection (produce trust state from a record) ---
export { produceSurfaceStateForVeritasRecord } from './surface/producer.mjs';
export * from './surface/projection.mjs';
export * from './surface/extension.mjs';

// --- Readiness verdict derivation over a record (blocking-failure-first semantics, frozen at
//     #646 Slice 1; promoted to a public engine export here per the seam doc's Slice-5 note) ---
export {
  readinessVerdict,
  readinessSurfaceStatus,
  readinessVerdictSummary,
  readinessPolicyResultSummary,
  readinessEvidenceCheckSummary,
  readinessIntegrityScope,
  readinessTransparencyGapHints,
} from './surface/readiness.mjs';

// --- Attestation READ (status inspection; authoring stays surface, excluded) ---
export {
  readAttestationHead,
  readCurrentAttestation,
  inspectAttestationStatus,
  buildAttestationPolicyResult,
} from './attestations.mjs';

// --- Claim-store READ (projection input; write/CRUD stays surface, excluded) ---
export {
  loadVeritasClaimStore,
  validateClaimStore,
} from './claims/store.mjs';

// --- Plugin loading / evidence collection (evaluation-input infrastructure) ---
export * from './plugins/loader.mjs';
export * from './plugins/registry.mjs';

// --- Pattern / string utilities ---
export {
  matchesPatterns,
  matchesPatternsForAnyFile,
} from './util/patterns.mjs';
export { uniqueStrings } from './util/strings.mjs';
