import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessVerdict, readinessSurfaceStatus } from '../../src/surface/readiness.mjs';

function baseRecord(overrides = {}) {
  return {
    promotion_allowed: true,
    uncovered_path_result: 'pass',
    policy_results: [],
    selected_evidence_checks: [],
    external_tool_results: [],
    ...overrides,
  };
}

test('promotion_allowed:true with a failing Require policy is not-ready/rejected', () => {
  const record = baseRecord({
    promotion_allowed: true,
    policy_results: [
      { rule_id: 'required-tests-pass', passed: false, enforcementLevel: 'Require' },
    ],
  });

  assert.equal(readinessVerdict(record), 'not-ready');
  assert.equal(readinessSurfaceStatus(record), 'rejected');
});

test('promotion_allowed:true with a clean record stays ready/verified', () => {
  const record = baseRecord({
    promotion_allowed: true,
    policy_results: [
      { rule_id: 'required-tests-pass', passed: true, enforcementLevel: 'Require' },
    ],
  });

  assert.equal(readinessVerdict(record), 'ready');
  assert.equal(readinessSurfaceStatus(record), 'verified');
});

test('promotion_allowed:false with a blocking failure is still not-ready/rejected', () => {
  const record = baseRecord({
    promotion_allowed: false,
    uncovered_path_result: 'fail',
  });

  assert.equal(readinessVerdict(record), 'not-ready');
  assert.equal(readinessSurfaceStatus(record), 'rejected');
});

test('promotion_allowed:false with no blocking failure is needs-review/disputed', () => {
  const record = baseRecord({ promotion_allowed: false });

  assert.equal(readinessVerdict(record), 'needs-review');
  assert.equal(readinessSurfaceStatus(record), 'disputed');
});
