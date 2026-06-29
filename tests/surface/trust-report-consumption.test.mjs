import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  produceSurfaceStateForVeritasRecord,
} from '../../src/surface/producer.mjs';
import { buildFeedbackSummary } from '../../src/report/format.mjs';
import { SURFACE_TRUST_POLICIES } from '../../src/surface/policies.mjs';

function baseRecord(exceptions = {}) {
  return {
    record_schema_version: 1,
    run_id: 'surface-report-consumption-test',
    timestamp: '2026-05-10T12:00:00.000Z',
    source_ref: 'test-ref',
    source_kind: 'working-tree',
    source_scope: ['unstaged'],
    resolved_phase: 'Phase 5',
    resolved_workstream: 'Surface report consumption',
    components: [],
    triggered_evidence_checks: [],
    selected_evidence_checks: [],
    policy_results: [],
    evidence_inventory_results: [],
    external_tool_results: [],
    readiness_coverage: null,
    selected_evidence_check_ids: [],
    selected_evidence_check_labels: [],
    evidence_check_resolution_source: 'default',
    baseline_ci_fast_passed: null,
    uncovered_path_result: 'clear',
    files: ['src/example.mjs'],
    unresolved_files: [],
    repoMap: {
      name: 'veritas',
      kind: 'repo-map',
      report_transport: 'local-json',
    },
    repo_standards: {
      name: 'test-repo-standards',
      version: '1',
      rule_count: 1,
    },
    recommendations: [],
    ...exceptions,
  };
}

test('Surface trust report summary is persisted with stale and disputed statuses', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-surface-report-consumption-'));
  const record = baseRecord({
    policy_results: [{
      rule_id: 'warn-rule',
      classification: 'promotable-policy',
      enforcementLevel: 'Guide',
      implemented: true,
      passed: false,
      summary: 'Warn rule failed.',
      message: 'Warn rule produced a policy warning.',
      findings: [],
    }],
    evidence_inventory_results: [{
      id: 'stale-inventory',
      evidence_check_id: 'ci-fast',
      source_evidence_check_id: 'ci-fast',
      manifest_path: '.veritas/evidence-inventories/stale.json',
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
      subjectId: 'test-repo-standards:warn-rule',
      impactLevel: 'medium',
      verificationPolicyId: 'veritas.policy-result',
      metadata: { ruleId: 'warn-rule' },
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
    }, {
      id: 'veritas.surface-report-consumption-test.evidence-inventory.stale-inventory',
      surface: 'veritas.evidence-inventories',
      claimType: 'veritas-evidence-inventory',
      fieldOrBehavior: 'stale-inventory',
      subjectType: 'repo-evidence-inventory',
      subjectId: 'veritas:stale-inventory',
      impactLevel: 'high',
      verificationPolicyId: 'veritas.evidence-inventory',
      metadata: { suiteId: 'stale-inventory' },
      createdAt: '2026-05-10T12:00:00.000Z',
      updatedAt: '2026-05-10T12:00:00.000Z',
    }],
    policies: [SURFACE_TRUST_POLICIES.policyResult, SURFACE_TRUST_POLICIES.evidenceInventory],
  }, null, 2)}\n`);

  const surface = await produceSurfaceStateForVeritasRecord(record, { rootDir });
  const { bundle, report } = surface;
  const statuses = Object.fromEntries(report.claims.map((claim) => [claim.id, claim.status]));
  const readinessClaim = bundle.claims.find((claim) => claim.claimType === 'software-readiness-verdict');
  assert.ok(readinessClaim);

  assert.equal(statuses['veritas.surface-report-consumption-test.policy.warn-rule'], 'disputed');
  assert.equal(statuses['veritas.surface-report-consumption-test.evidence-inventory.stale-inventory'], 'stale');
  assert.ok(report.transparencyGapsByClaimId['veritas.surface-report-consumption-test.evidence-inventory.stale-inventory']);

  const feedback = buildFeedbackSummary({
    record: {
      ...record,
      trust: surface,
    },
  });
  assert.match(feedback, /WARN  surface-status: claim "veritas\.surface-report-consumption-test\.policy\.warn-rule" is DISPUTED/);
  assert.match(feedback, /WARN  surface-status: claim "veritas\.surface-report-consumption-test\.evidence-inventory\.stale-inventory" is STALE/);
  rmSync(rootDir, { recursive: true, force: true });
});
