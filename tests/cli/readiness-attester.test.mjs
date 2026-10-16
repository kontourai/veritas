import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReadinessAuthorityTraceRecord } from '../../src/surface/readiness-authority.mjs';
import { cleanGitEnv, commitAll, initCommittedRepo, repoRootDir } from '../helpers.mjs';

const VERITAS = join(repoRootDir, 'bin/veritas.mjs');

function cli(rootDir, args) {
  const env = cleanGitEnv();
  env.VERITAS_ACTOR = 'SYNTHETIC-environment';
  return spawnSync(process.execPath, [VERITAS, ...args], { cwd: rootDir, env, encoding: 'utf8' });
}

function assertExit(result, status) {
  assert.equal(result.status, status, result.stdout + result.stderr);
}

function verdictTrace(bundle) {
  const claim = bundle.claims.find((item) => item.claimType === 'software-readiness-verdict');
  assert.ok(claim, 'readiness verdict must be emitted');
  const traces = bundle.authorityTrace.filter((trace) => trace.claimIds.includes(claim.id));
  assert.equal(traces.length, 1);
  return traces[0];
}

function readinessTraces(rootDir, runId) {
  const result = cli(rootDir, ['readiness', '--working-tree', '--actor', 'SYNTHETIC-runner', '--run-id', runId, '--format', 'trust-bundle']);
  assertExit(result, 0);
  const record = JSON.parse(readFileSync(join(rootDir, `.kontourai/veritas/evidence/${runId}.json`), 'utf8'));
  return { record, traces: [verdictTrace(JSON.parse(result.stdout)), verdictTrace(record.trust.bundle)] };
}

function assertIdentity(traces, actorRef, actor, kind) {
  for (const trace of traces) {
    assert.equal(trace.actorRef, actorRef);
    assert.equal(trace.metadata.actor, actor);
    assert.equal(trace.metadata.kind, kind);
  }
}

test('CLI readiness emits and persists the current attester ID ahead of the run actor, then restores producer fallback', (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-readiness-attester-');
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })}\n`);
  // All governance and approvals below exist only in this disposable synthetic repository.
  assertExit(cli(rootDir, ['init', '--non-interactive']), 0);
  const settingsPath = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.review_preferences.attestation_approval_ref_policy = { mode: 'resolved', allowedPrefixes: ['veritas-approval:'] };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  const approvalDir = join(rootDir, '.veritas/authority/approval-records');
  mkdirSync(approvalDir, { recursive: true });
  writeFileSync(join(approvalDir, 'SYNTHETIC-approval.approval.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'SYNTHETIC-approval',
    status: 'approved',
    approvalRef: 'veritas-approval:SYNTHETIC-approval',
    provider: 'veritas-offline',
    authorityRef: 'SYNTHETIC-approval',
    approvedBy: 'SYNTHETIC-approver',
    approvedAt: new Date().toISOString(),
    scope: { attestationKinds: ['bootstrap'] },
  }, null, 2)}\n`);
  commitAll(rootDir, 'Synthetic governance fixture');

  const baseline = readinessTraces(rootDir, 'baseline');
  assertIdentity(baseline.traces, 'system:SYNTHETIC-runner', 'SYNTHETIC-runner', 'producer-fallback');
  assertExit(cli(rootDir, ['attest', 'bootstrap', '--actor', 'SYNTHETIC-attester', '--approval-ref', 'veritas-approval:SYNTHETIC-approval', '--non-interactive']), 0);
  const attested = readinessTraces(rootDir, 'attested');
  assert.equal(attested.record.governance_state.state, 'current');
  assert.equal(attested.record.governance_state.recordIntegrity.status, 'verified');
  assert.equal(attested.record.governance_state.attestation.actor.id, 'SYNTHETIC-attester');
  assertIdentity(attested.traces, 'actor:SYNTHETIC-attester', 'SYNTHETIC-attester', 'governance-attestation');
  for (const trace of attested.traces) {
    assert.equal(trace.authorityType, 'credential');
    assert.match(trace.authorityRef, /^attestation:/);
  }

  const { currentAttestationId } = attested.record.governance_state;
  const attestationPath = join(rootDir, `.veritas/attestations/${currentAttestationId}.attestation.json`);
  const malformed = JSON.parse(readFileSync(attestationPath, 'utf8'));
  malformed.actor.id = {};
  writeFileSync(attestationPath, `${JSON.stringify(malformed, null, 2)}\n`);
  const refused = cli(rootDir, ['readiness', '--working-tree', '--actor', 'SYNTHETIC-runner', '--run-id', 'malformed', '--format', 'trust-bundle']);
  assertExit(refused, 2);
  assert.match(refused.stderr, /attestation actor.*non-empty string id/i);
  assert.equal(refused.stdout.trim(), '', 'no bundle may be emitted with a substitute identity');
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/evidence/malformed.json')), false);

  rmSync(join(rootDir, '.veritas/attestations'), { recursive: true });
  const restored = readinessTraces(rootDir, 'restored');
  assertIdentity(restored.traces, 'system:SYNTHETIC-runner', 'SYNTHETIC-runner', 'producer-fallback');
});

for (const actor of [null, 'string-actor', {}, { id: '' }, { id: '   ' }, { id: '@@@' }, { id: 42 }, { id: {} }]) {
  test(`malformed attestation actor fails closed: ${JSON.stringify(actor)}`, () => {
    const record = { governance_state: { attestation: { actor } }, owner: 'SYNTHETIC-owner' };
    assert.throws(() => buildReadinessAuthorityTraceRecord(record, { id: 'claim' }, 'evidence', { actor: 'SYNTHETIC-runner' }), /attestation actor.*non-empty string id/i);
  });
}
