import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSurfaceTrustInput,
  buildSurfaceTrustReportSummary,
} from '../../src/surface/projection.mjs';
import { buildFeedbackSummary } from '../../src/report/format.mjs';
import { SURFACE_TRUST_POLICIES } from '../../src/surface/policies.mjs';

function baseRecord(overrides = {}) {
  return {
    framework_version: 1,
    run_id: 'surface-report-consumption-test',
    timestamp: '2026-05-10T12:00:00.000Z',
    source_ref: 'test-ref',
    source_kind: 'working-tree',
    source_scope: ['unstaged'],
    resolved_phase: 'Phase 5',
    resolved_workstream: 'Surface report consumption',
    affected_nodes: [],
    affected_lanes: [],
    selected_proof_lanes: [],
    policy_results: [],
    proof_family_results: [],
    external_tool_results: [],
    verification_budget: null,
    selected_proof_commands: [],
    proof_resolution_source: 'default',
    baseline_ci_fast_passed: null,
    uncovered_path_result: 'clear',
    files: ['src/example.mjs'],
    unresolved_files: [],
    adapter: {
      name: 'veritas',
      kind: 'repo-adapter',
      report_transport: 'local-json',
    },
    policy_pack: {
      name: 'test-policy-pack',
      version: '1',
      rule_count: 1,
    },
    recommendations: [],
    ...overrides,
  };
}

test('Surface trust report summary is persisted with stale and disputed statuses', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-surface-report-consumption-'));
  const record = baseRecord({
    policy_results: [{
      rule_id: 'warn-rule',
      classification: 'promotable-policy',
      stage: 'warn',
      implemented: true,
      passed: false,
      summary: 'Warn rule failed.',
      message: 'Warn rule produced a policy warning.',
      findings: [],
    }],
    proof_family_results: [{
      id: 'stale-family',
      lane_id: 'ci-fast',
      source_proof_lane_id: 'ci-fast',
      manifest_path: '.veritas/proof-families/stale.json',
      owner: 'verification',
      selected: true,
      disposition: 'required',
      verification_weight: 'blocking',
      blocking_status: 'required',
      regression_severity: 'high',
      false_positive_risk: 'low',
      replacement_test_available: true,
      review_trigger: 'weekly review',
      last_reviewed: '2026-04-25T12:00:00.000Z',
      evidence_basis: 'reviewed',
      freshness_status: 'current',
      recent_catch_evidence: 'present',
      rationale: 'Old review should be stale under Surface freshness policy.',
    }],
  });
  writeFileSync(join(rootDir, 'veritas.claims.json'), `${JSON.stringify({
    schemaVersion: 1,
    producer: 'veritas',
    claims: [{
      id: 'veritas.surface-report-consumption-test.policy.warn-rule',
      surface: 'veritas.policy-results',
      claimType: 'veritas-policy-result',
      fieldOrBehavior: 'warn-rule',
      subjectType: 'veritas-policy-rule',
      subjectId: 'test-policy-pack:warn-rule',
      impactLevel: 'medium',
      verificationPolicyId: 'veritas.policy-result',
      metadata: { ruleId: 'warn-rule' },
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
    }, {
      id: 'veritas.surface-report-consumption-test.proof-family.stale-family',
      surface: 'veritas.proof-families',
      claimType: 'veritas-proof-family',
      fieldOrBehavior: 'stale-family',
      subjectType: 'repo-proof-family',
      subjectId: 'veritas:stale-family',
      impactLevel: 'high',
      verificationPolicyId: 'veritas.proof-family',
      metadata: { familyId: 'stale-family' },
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
    }],
    policies: [SURFACE_TRUST_POLICIES.policyResult, SURFACE_TRUST_POLICIES.proofFamily],
  }, null, 2)}\n`);

  const input = await buildSurfaceTrustInput(record, { rootDir });
  const report = buildSurfaceTrustReportSummary({ input, record });
  const statuses = Object.fromEntries(report.claims.map((claim) => [claim.id, claim.status]));

  assert.equal(statuses['veritas.surface-report-consumption-test.policy.warn-rule'], 'disputed');
  assert.equal(statuses['veritas.surface-report-consumption-test.proof-family.stale-family'], 'stale');
  assert.ok(report.faultLinesByClaimId['veritas.surface-report-consumption-test.proof-family.stale-family']);

  const feedback = buildFeedbackSummary({
    record: {
      ...record,
      surface: { input, report },
    },
  });
  assert.match(feedback, /WARN  surface-status: claim "veritas\.surface-report-consumption-test\.policy\.warn-rule" is DISPUTED/);
  assert.match(feedback, /WARN  surface-status: claim "veritas\.surface-report-consumption-test\.proof-family\.stale-family" is STALE/);
  rmSync(rootDir, { recursive: true, force: true });
});
