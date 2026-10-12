import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvidenceCheckPlan } from '../src/readiness/evidence-check-runner.mjs';
import { repoRootDir } from './helpers.mjs';

test('real Veritas command observations consume the shared contract without changing schema v1 JSON', async () => {
  const outcome = await runEvidenceCheckPlan({
    rootDir: repoRootDir,
    evidenceChecks: [{ id: 'success', command: 'exit 0' }, { id: 'failure', command: 'exit 7' }],
  });
  const [success, failure] = outcome.evidenceCheckResults;
  assert.equal(success.checkObservation.status, 'pass');
  assert.equal(failure.checkObservation.status, 'fail');
  assert.equal(success.passed, true);
  assert.equal(failure.passed, false);
  for (const result of [success, failure]) {
    assert.equal(result.checkObservation.basis.kind, 'veritas-check-definition');
    assert.equal(result.checkObservation.id, result.id);
    assert.ok(Object.isFrozen(result.checkObservation));
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(result)), 'checkObservation'), false);
  }
});

test('a real spawn error retains an unavailable shared observation and blocks required evidence', async () => {
  const outcome = await runEvidenceCheckPlan({
    rootDir: '/path/that/does/not/exist/veritas-check-fixture',
    evidenceChecks: [{ id: 'missing-cwd', command: 'exit 0' }],
  });
  assert.equal(outcome.evidenceCheckResults[0].checkObservation.status, 'not_verified');
  assert.equal(outcome.evidenceCheckResults[0].passed, false);
  assert.ok(outcome.evidenceCheckFailure);
});
