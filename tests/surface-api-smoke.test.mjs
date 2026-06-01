import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommitValidityPolicy,
  buildHumanAttestationEvidence,
  buildTrustReport,
  TrustInputBuilder,
  validateTrustInput,
} from '@kontourai/surface';

test('Veritas-consumed Surface public API symbols resolve at runtime', () => {
  assert.equal(typeof buildTrustReport, 'function');
  assert.equal(typeof validateTrustInput, 'function');
  assert.equal(typeof TrustInputBuilder, 'function');
  assert.equal(typeof buildHumanAttestationEvidence, 'function');
  assert.equal(typeof buildCommitValidityPolicy, 'function');
});
