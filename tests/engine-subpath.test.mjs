import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as engine from '../src/engine.mjs';

// The `@kontourai/veritas/engine` subpath is the frozen engine-library API
// (docs/architecture/engine-surface-seam.md, flow-agents#646/#650). These tests pin its
// boundary: it must export the engine-classified API, and it must NOT export product surface
// that belongs to the flow-agents veritas-governance kit. A future edit that leaks a surface
// symbol (or drops an engine one) fails here.

// Engine capabilities the seam froze — every one must be importable from the subpath.
const ENGINE_API = [
  // rule evaluation
  'evaluateRepoStandards', 'evaluatePolicyRule', 'evaluateWorkAreaBoundaryRule', 'RULE_EVALUATORS',
  // repo classify / routing
  'classifyNodes', 'resolveEvidenceCheckPlan', 'resolveWorkstream',
  // evidence / coverage
  'readEvidenceChecks', 'buildReadinessCoverage', 'buildExternalToolResults',
  // merge-readiness
  'runMergeReadiness', 'hasReadinessOutcomeInputs',
  // report / record
  'generateVeritasReport', 'buildEvidenceRecord', 'writeEvidenceArtifact', 'resolveVeritasPaths',
  // surface-claim projection
  'produceSurfaceStateForVeritasRecord',
  // readiness verdict derivation (promoted to public here)
  'readinessVerdict', 'readinessSurfaceStatus',
  // attestation READ
  'inspectAttestationStatus', 'buildAttestationPolicyResult', 'readCurrentAttestation',
  // claim-store READ
  'loadVeritasClaimStore', 'validateClaimStore',
  // explain / boundaries logic
  'buildExplainText', 'checkBoundaries',
  // content-boundary evaluator
  'evaluateContentBoundary', 'runContentBoundary',
  // loaders / paths / util
  'loadRepoMap', 'loadRepoStandards', 'normalizeRepoPath', 'matchesPatterns', 'uniqueStrings',
];

// Product surface owned by the kit — must NOT leak into the frozen engine API.
const SURFACE_FORBIDDEN = [
  // init scaffold
  'writeBootstrapStarterKit', 'buildInitRecommendation', 'applyInitRecommendation', 'slugifyProjectName',
  // hook setup + installers
  'setupRepoHooks', 'applyGitHook', 'applyStopHook', 'applyClaudeCodePreToolUseHook',
  // runtime integrations
  'applyCodexHook', 'inspectRuntimeIntegrationStatus',
  // governance-block apply (write)
  'applyGovernanceBlocks', 'buildGovernanceBlock',
  // attestation authoring (write)
  'createAttestation', 'writePendingAttestationMarker', 'assertAttestationApprovalReference',
  // standards-feedback authoring
  'generateStandardsFeedbackRecord', 'generateAndWriteRecommendations', 'applyRecommendation',
  // conformance dashboard
  'buildRepoConformanceSnapshot', 'summarizeGovernanceTrend',
  // CLI runners
  'runInitCli', 'runSetupRepoHooksCli', 'runIntegrationsCli', 'runAttestCli',
];

test('engine subpath exports the frozen engine API', () => {
  const missing = ENGINE_API.filter((name) => typeof engine[name] === 'undefined');
  assert.deepEqual(missing, [], `engine subpath is missing engine exports: ${missing.join(', ')}`);
});

test('engine subpath does NOT leak product surface (kit-owned)', () => {
  const leaked = SURFACE_FORBIDDEN.filter((name) => typeof engine[name] !== 'undefined');
  assert.deepEqual(leaked, [], `engine subpath leaked surface exports (belong to the kit): ${leaked.join(', ')}`);
});

test('the three station imports resolve from the engine subpath', () => {
  for (const name of ['evaluateRepoStandards', 'loadRepoStandards', 'classifyNodes']) {
    assert.equal(typeof engine[name], 'function', `station import ${name} must be an engine export`);
  }
});

test('the public package root (`@kontourai/veritas`) is engine-only', async () => {
  // The package `exports` map points `.` at src/engine.mjs, so importing the package by name
  // must yield the engine API and NOT product surface (which the kit owns and which is reachable
  // only via the bin CLIs / relative imports, not the package name).
  const pkg = await import('@kontourai/veritas');
  const engineMissing = ENGINE_API.filter((name) => typeof pkg[name] === 'undefined');
  assert.deepEqual(engineMissing, [], `package root is missing engine exports: ${engineMissing.join(', ')}`);
  const surfaceLeaked = SURFACE_FORBIDDEN.filter((name) => typeof pkg[name] !== 'undefined');
  assert.deepEqual(surfaceLeaked, [], `package root leaked surface exports: ${surfaceLeaked.join(', ')}`);
  for (const name of ['evaluateRepoStandards', 'loadRepoStandards', 'classifyNodes']) {
    assert.equal(typeof pkg[name], 'function', `station import ${name} must resolve from the package root`);
  }
});
