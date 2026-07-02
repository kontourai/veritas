import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runClaimCli } from '../src/index.mjs';
import { buildSurfaceTrustBundle } from '../src/surface/projection.mjs';
import { SURFACE_TRUST_POLICIES } from '../src/surface/policies.mjs';

function tempRoot(prefix = 'veritas-claims-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('veritas claim add writes veritas.claims.json', async () => {
  const rootDir = tempRoot();
  try {
    await runClaimCli([
      'add',
      '--id', 'repo.evidence-check.npm-test',
      '--type', 'software-evidence-check',
      '--facet', 'veritas.evidence-check',
      '--subject-type', 'repository',
      '--subject-id', 'repo',
      '--field', 'npm test',
      '--metadata', '{"command":"npm test"}',
    ], { rootDir });
    const store = JSON.parse(readFileSync(join(rootDir, 'veritas.claims.json'), 'utf8'));
    assert.equal(store.producer, 'veritas');
    assert.equal(store.claims[0].id, 'repo.evidence-check.npm-test');
    assert.equal(store.claims[0].facet, 'veritas.evidence-check');
    assert.equal(store.claims[0].surface, undefined);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('Surface projection reads authored claims from veritas.claims.json using legacy `surface` field (read-tolerance shim)', async () => {
  const rootDir = tempRoot();
  try {
    writeFileSync(join(rootDir, 'veritas.claims.json'), `${JSON.stringify({
      schemaVersion: 1,
      producer: 'veritas',
      claims: [{
        id: 'repo.evidence-check.npm-test',
        surface: 'veritas.evidence-check',
        claimType: 'software-evidence-check',
        fieldOrBehavior: 'npm test',
        subjectType: 'repository',
        subjectId: 'repo',
        impactLevel: 'high',
        verificationPolicyId: 'veritas.evidence-check',
        metadata: { command: 'npm test' },
        createdAt: '2026-05-19T00:00:00.000Z',
        updatedAt: '2026-05-19T00:00:00.000Z',
      }],
      policies: [SURFACE_TRUST_POLICIES.evidenceCheck],
    }, null, 2)}\n`);
    const input = await buildSurfaceTrustBundle({
      run_id: 'claim-store-projection',
      timestamp: '2026-05-19T00:00:00.000Z',
      source_ref: 'abc123',
      source_kind: 'explicit-files',
      source_scope: ['explicit'],
      components: [],
      selected_evidence_checks: [{
        id: 'test',
        command: 'npm test',
        method: 'validation',
        evidence_check_result: {
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

    const authoredClaim = input.claims.find((claim) => claim.id === 'repo.evidence-check.npm-test');
    assert.ok(authoredClaim);
    assert.equal(authoredClaim.facet, 'veritas.evidence-check', 'legacy surface value must be read-tolerance-shimmed onto facet');
    assert.equal(authoredClaim.value, 'all checks pass');
    assert.equal(input.claims.some((claim) => claim.claimType === 'software-readiness-verdict'), true);
    const authoredEvidence = input.evidence.find((item) => item.claimId === 'repo.evidence-check.npm-test');
    assert.ok(authoredEvidence);
    assert.equal(authoredEvidence.metadata.observedResult.status, 'passed');
    assert.equal(authoredEvidence.metadata.commandOutput.stdout, '2 tests passed\n');
    assert.equal(input.events.some((event) => event.claimId === 'repo.evidence-check.npm-test' && event.status === 'verified'), true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('Surface projection reads authored claims from veritas.claims.json using current `facet` field', async () => {
  const rootDir = tempRoot();
  try {
    writeFileSync(join(rootDir, 'veritas.claims.json'), `${JSON.stringify({
      schemaVersion: 1,
      producer: 'veritas',
      claims: [{
        id: 'repo.evidence-check.npm-test',
        facet: 'veritas.evidence-check',
        claimType: 'software-evidence-check',
        fieldOrBehavior: 'npm test',
        subjectType: 'repository',
        subjectId: 'repo',
        impactLevel: 'high',
        verificationPolicyId: 'veritas.evidence-check',
        metadata: { command: 'npm test' },
        createdAt: '2026-05-19T00:00:00.000Z',
        updatedAt: '2026-05-19T00:00:00.000Z',
      }],
      policies: [SURFACE_TRUST_POLICIES.evidenceCheck],
    }, null, 2)}\n`);
    const input = await buildSurfaceTrustBundle({
      run_id: 'claim-store-projection-facet',
      timestamp: '2026-05-19T00:00:00.000Z',
      source_ref: 'abc123',
      source_kind: 'explicit-files',
      source_scope: ['explicit'],
      components: [],
      selected_evidence_checks: [{
        id: 'test',
        command: 'npm test',
        method: 'validation',
        evidence_check_result: {
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

    const authoredClaim = input.claims.find((claim) => claim.id === 'repo.evidence-check.npm-test');
    assert.ok(authoredClaim);
    assert.equal(authoredClaim.facet, 'veritas.evidence-check');
    assert.equal(authoredClaim.value, 'all checks pass');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('Surface projection requires an authored claim store', async () => {
  const rootDir = tempRoot();
  try {
    await assert.rejects(
      () => buildSurfaceTrustBundle({
        run_id: 'missing-claim-store',
        timestamp: '2026-05-19T00:00:00.000Z',
        source_ref: 'abc123',
        source_kind: 'explicit-files',
        source_scope: ['explicit'],
        components: [],
        selected_evidence_checks: [],
        policy_results: [],
      }, { rootDir }),
      /veritas\.claims\.json is required/,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
