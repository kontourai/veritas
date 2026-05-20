import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runClaimCli } from '../src/index.mjs';
import { buildSurfaceTrustInput } from '../src/surface/projection.mjs';
import { SURFACE_TRUST_POLICIES } from '../src/surface/policies.mjs';

function tempRoot(prefix = 'veritas-claims-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('veritas claim add writes veritas.claims.json', async () => {
  const rootDir = tempRoot();
  try {
    await runClaimCli([
      'add',
      '--id', 'repo.proof.npm-test',
      '--type', 'software-proof',
      '--surface', 'veritas.proof',
      '--subject-type', 'repository',
      '--subject-id', 'repo',
      '--field', 'npm test',
      '--metadata', '{"command":"npm test"}',
    ], { rootDir });
    const store = JSON.parse(readFileSync(join(rootDir, 'veritas.claims.json'), 'utf8'));
    assert.equal(store.producer, 'veritas');
    assert.equal(store.claims[0].id, 'repo.proof.npm-test');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('Surface projection reads authored claims from veritas.claims.json', async () => {
  const rootDir = tempRoot();
  try {
    writeFileSync(join(rootDir, 'veritas.claims.json'), `${JSON.stringify({
      schemaVersion: 1,
      producer: 'veritas',
      claims: [{
        id: 'repo.proof.npm-test',
        surface: 'veritas.proof',
        claimType: 'software-proof',
        fieldOrBehavior: 'npm test',
        subjectType: 'repository',
        subjectId: 'repo',
        impactLevel: 'high',
        verificationPolicyId: 'veritas.proof',
        metadata: { command: 'npm test' },
        createdAt: '2026-05-19T00:00:00.000Z',
        updatedAt: '2026-05-19T00:00:00.000Z',
      }],
      policies: [SURFACE_TRUST_POLICIES.proof],
    }, null, 2)}\n`);
    const input = await buildSurfaceTrustInput({
      run_id: 'claim-store-projection',
      timestamp: '2026-05-19T00:00:00.000Z',
      source_ref: 'abc123',
      source_kind: 'explicit-files',
      source_scope: ['explicit'],
      components: [],
      selected_proofs: [{
        id: 'test',
        command: 'npm test',
        method: 'validation',
        proof_result: {
          command: 'npm test',
          passed: true,
          exitCode: 0,
          signal: null,
          stdout: '2 tests passed\n',
          stderr: '',
          output: '2 tests passed\n',
        },
      }],
      policy_results: [],
      baseline_ci_fast_passed: true,
    }, { rootDir });

    assert.deepEqual(input.claims.map((claim) => claim.id), ['repo.proof.npm-test']);
    assert.equal(input.claims[0].value, 'all checks pass');
    assert.equal(input.evidence[0].claimId, 'repo.proof.npm-test');
    assert.equal(input.evidence[0].metadata.observedResult.status, 'passed');
    assert.equal(input.evidence[0].metadata.commandOutput.stdout, '2 tests passed\n');
    assert.equal(input.events[0].status, 'verified');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('Surface projection requires an authored claim store', async () => {
  const rootDir = tempRoot();
  try {
    await assert.rejects(
      () => buildSurfaceTrustInput({
        run_id: 'missing-claim-store',
        timestamp: '2026-05-19T00:00:00.000Z',
        source_ref: 'abc123',
        source_kind: 'explicit-files',
        source_scope: ['explicit'],
        components: [],
        selected_proofs: [],
        policy_results: [],
      }, { rootDir }),
      /veritas\.claims\.json is required/,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
