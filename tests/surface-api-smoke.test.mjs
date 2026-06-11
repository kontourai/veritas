import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommitValidityPolicy,
  buildHumanAttestationEvidence,
  buildTrustReport,
  TrustBundleBuilder,
  validateTrustBundle,
} from '@kontourai/surface';

test('Veritas-consumed Surface public API symbols resolve at runtime', () => {
  assert.equal(typeof buildTrustReport, 'function');
  assert.equal(typeof validateTrustBundle, 'function');
  assert.equal(typeof TrustBundleBuilder, 'function');
  assert.equal(typeof buildHumanAttestationEvidence, 'function');
  assert.equal(typeof buildCommitValidityPolicy, 'function');
});
