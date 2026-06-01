import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  approvalResolverRejectionReason,
  buildApprovalResolverRequest,
  isApprovalResolverResultAccepted,
  normalizeApprovalRefPolicy,
  normalizeApprovalResolverResult,
  resolveOfflineApprovalReference,
  summarizeApprovalResolverResult,
} from '../src/index.mjs';

function writeOfflineApprovalRecord(rootDir, id, record) {
  const dir = join(rootDir, '.veritas/authority/approval-records');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.approval.json`), `${JSON.stringify({
    schemaVersion: 1,
    id,
    status: 'approved',
    approvalRef: `veritas-approval:${id}`,
    provider: 'veritas-offline',
    authorityRef: id,
    approvedBy: 'change-manager',
    approvedAt: '2026-06-01T00:00:00.000Z',
    ...record,
  }, null, 2)}\n`);
}

test('approval resolver contract builds a provider-neutral request', () => {
  const request = buildApprovalResolverRequest({
    approvalRef: 'servicenow:change/CHG12345',
    attestationKind: 'policy-change',
    actor: 'brian',
    repo: { owner: 'kontourai', name: 'veritas' },
    protectedStandards: {
      repoStandardsHash: 'sha256:standards',
      repoMapHash: 'sha256:map',
      authoritySettingsHash: 'sha256:authority',
    },
    requestedAt: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(request.schemaVersion, 1);
  assert.equal(request.approvalRef, 'servicenow:change/CHG12345');
  assert.equal(request.attestationKind, 'policy-change');
  assert.equal(request.actor, 'brian');
  assert.equal(request.protectedStandards.repoMapHash, 'sha256:map');
});

test('approval resolver results normalize approved and rejected states', () => {
  const approved = normalizeApprovalResolverResult({
    status: 'approved',
    approvalRef: 'servicenow:change/CHG12345',
    provider: 'servicenow',
    authorityRef: 'CHG12345',
    approvedBy: 'change-manager',
    approvedAt: '2026-06-01T00:00:00.000Z',
    evidenceHash: 'sha256:approval',
  }, { resolvedAt: '2026-06-01T00:05:00.000Z' });

  assert.equal(approved.approved, true);
  assert.equal(approved.failureReason, null);
  assert.equal(isApprovalResolverResultAccepted(approved), true);

  const rejected = summarizeApprovalResolverResult({
    status: 'rejected',
    approvalRef: 'servicenow:change/CHG99999',
    provider: 'servicenow',
    failureReason: 'change is not approved',
  }, { resolvedAt: '2026-06-01T00:05:00.000Z' });

  assert.equal(rejected.approved, false);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.failureReason, 'change is not approved');
  assert.equal(isApprovalResolverResultAccepted(rejected), false);
});

test('approval resolver result acceptance treats expired approvals as unavailable', () => {
  const result = normalizeApprovalResolverResult({
    status: 'approved',
    expiresAt: '2026-06-01T00:00:00.000Z',
  }, { resolvedAt: '2026-06-02T00:00:00.000Z' });

  assert.equal(isApprovalResolverResultAccepted(result), false);
  assert.equal(approvalResolverRejectionReason(result), 'expired');
});

test('approval reference policy modes classify resolution requirements', () => {
  assert.deepEqual(normalizeApprovalRefPolicy({
    mode: 'prefix',
    allowed_prefixes: ['servicenow:change/'],
  }), {
    mode: 'prefix',
    allowedPrefixes: ['servicenow:change/'],
    requiresResolution: false,
    strict: false,
  });

  assert.equal(normalizeApprovalRefPolicy({ mode: 'resolved' }).requiresResolution, true);
  assert.equal(normalizeApprovalRefPolicy({ mode: 'resolved-strict' }).strict, true);
  assert.throws(
    () => normalizeApprovalRefPolicy({ mode: 'anything-goes' }),
    /Unsupported attestation approval reference policy mode/,
  );
});

test('offline approval resolver reads repo-local approval records', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-offline-approval-'));
  writeOfflineApprovalRecord(rootDir, 'chg-123', {
    scope: {
      attestationKinds: ['bootstrap'],
    },
  });
  const request = buildApprovalResolverRequest({
    approvalRef: 'veritas-approval:chg-123',
    attestationKind: 'bootstrap',
    requestedAt: '2026-06-01T00:00:00.000Z',
  });

  const result = resolveOfflineApprovalReference({
    rootDir,
    approvalRef: 'veritas-approval:chg-123',
    request,
    resolvedAt: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(result.status, 'approved');
  assert.equal(result.provider, 'veritas-offline');
  assert.equal(result.authorityRef, 'chg-123');
  assert.match(result.evidenceHash, /^sha256:/);
});

test('offline approval resolver rejects escaped file references and out-of-scope records', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-offline-approval-'));
  writeOfflineApprovalRecord(rootDir, 'wrong-kind', {
    scope: {
      attestationKinds: ['policy-change'],
    },
  });

  assert.throws(
    () => resolveOfflineApprovalReference({
      rootDir,
      approvalRef: 'file:../outside.json',
    }),
    /approval record path must stay inside/,
  );

  const result = resolveOfflineApprovalReference({
    rootDir,
    approvalRef: 'veritas-approval:wrong-kind',
    request: buildApprovalResolverRequest({
      approvalRef: 'veritas-approval:wrong-kind',
      attestationKind: 'bootstrap',
      requestedAt: '2026-06-01T00:00:00.000Z',
    }),
    resolvedAt: '2026-06-01T00:00:00.000Z',
  });
  assert.equal(result.status, 'out-of-scope');
  assert.equal(approvalResolverRejectionReason(result), 'out-of-scope');
});
