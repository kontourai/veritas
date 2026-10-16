import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrustReport } from '@kontourai/surface';
import { buildGovernanceArtifactClaims, createAttestation } from '../../src/index.mjs';
import { cleanGitEnv, commitAll, initCommittedRepo, repoRootDir } from '../helpers.mjs';

// The Surface claim an attestation carries must be only as strong as the
// approval check that ran (issue #180). Before this change a made-up approval
// reference in the default `reference-only` mode produced status `verified`,
// reviewerAuthority `human` and evidenceStrength `strong`.

const VERITAS = join(repoRootDir, 'bin/veritas.mjs');

const UNRESOLVED_CONFIDENCE = {
  sourceQuality: 'weak',
  reviewerAuthority: 'none',
  evidenceStrength: 'weak',
  impactLevel: 'high',
};
const RESOLVED_CONFIDENCE = {
  sourceQuality: 'strong',
  reviewerAuthority: 'human',
  evidenceStrength: 'strong',
  impactLevel: 'high',
};
const NOT_RESOLVED_TEXT = /approval reference was not resolved against an approval record/;

function veritas(rootDir, args) {
  const env = cleanGitEnv();
  delete env.VERITAS_ACTOR;
  return spawnSync(process.execPath, [VERITAS, ...args], { cwd: rootDir, encoding: 'utf8', env });
}

function assertExit(result, status, label) {
  assert.equal(result.status, status, `${label}\n${result.stdout}\n${result.stderr}`);
}

function initVeritasRepo(t, prefix) {
  const rootDir = initCommittedRepo(t, prefix);
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2)}\n`);
  commitAll(rootDir, 'Add package');
  assertExit(veritas(rootDir, ['init', '--non-interactive']), 0, 'veritas init');
  commitAll(rootDir, 'Initialize Veritas');
  return rootDir;
}

function setApprovalRefPolicy(rootDir, policy) {
  const path = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  settings.review_preferences.attestation_approval_ref_policy = policy;
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function writeApprovalRecord(rootDir, id) {
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
    approvedAt: '2026-01-01T00:00:00.000Z',
    scope: { attestationKinds: ['bootstrap'] },
  }, null, 2)}\n`);
}

function attestBootstrap(rootDir, approvalRef) {
  assertExit(
    veritas(rootDir, ['attest', 'bootstrap', '--actor', 'alice', '--approval-ref', approvalRef, '--non-interactive']),
    0,
    'veritas attest bootstrap',
  );
  const { currentAttestationId } = JSON.parse(readFileSync(join(rootDir, '.veritas/attestations/HEAD'), 'utf8'));
  return JSON.parse(readFileSync(join(rootDir, `.veritas/attestations/${currentAttestationId}.attestation.json`), 'utf8'));
}

// The status Surface itself derives from the record's projection: a consumer
// that folds the claim, evidence and event sees this, not the claim's own field.
function surfaceDerivedStatus(surface) {
  const report = buildTrustReport({
    schemaVersion: 5,
    source: 'attestation-claim-strength-test',
    claims: [surface.claim],
    evidence: [surface.evidence],
    events: [surface.event],
    policies: [],
  });
  return report.claims.find((claim) => claim.id === surface.claim.id).status;
}

function runReadiness(rootDir) {
  commitAll(rootDir, 'Record attestation');
  const result = veritas(rootDir, ['readiness', '--working-tree']);
  const evidenceDir = join(rootDir, '.kontourai/veritas/evidence');
  const files = readdirSync(evidenceDir).filter((file) => file.endsWith('.json'));
  assert.equal(files.length, 1, files.join(', '));
  return { result, record: JSON.parse(readFileSync(join(evidenceDir, files[0]), 'utf8')) };
}

function readinessSummary({ result, record }) {
  const reportClaims = record.trust.report.claims;
  const verdict = reportClaims.find((claim) => claim.id.includes('.readiness-verdict.'));
  const governance = reportClaims.find((claim) => claim.id.endsWith('.governance'));
  return {
    exitStatus: result.status,
    attestationRulePassed: /^PASS\s+policy-changes-require-attestation:/m.test(result.stdout),
    verdictStatus: verdict?.status,
    governanceStatus: governance?.status,
  };
}

function governanceAttestationEvidence(record) {
  return record.trust.bundle.evidence.find((item) => /\.governance\..+\.attestation\.evidence$/.test(item.id));
}

function projectedGovernanceClaims(record) {
  const claims = [];
  buildGovernanceArtifactClaims({ record, claims, evidence: [], events: [] });
  return {
    currency: claims.find((claim) => claim.fieldOrBehavior === 'attestationCurrency'),
    artifacts: claims.filter((claim) => claim.fieldOrBehavior !== 'attestationCurrency'),
  };
}

const READY = {
  exitStatus: 0,
  attestationRulePassed: true,
  verdictStatus: 'verified',
  governanceStatus: 'verified',
};

test('a made-up approval reference in the default mode is not projected as verified human approval', (t) => {
  const rootDir = initVeritasRepo(t, 'veritas-claim-strength-default-');
  const attestation = attestBootstrap(rootDir, 'made-up-123');

  assert.equal(attestation.metadata.approvalRefPolicy.mode, 'reference-only');
  assert.equal(attestation.metadata.approvalResolution, null);
  const { claim, event, evidence } = attestation.surface;
  assert.equal(claim.status, 'proposed');
  assert.deepEqual(claim.confidenceBasis, UNRESOLVED_CONFIDENCE);
  assert.equal(event.status, 'proposed');
  assert.equal(event.verifiedAt, undefined);
  assert.match(evidence.excerptOrSummary, NOT_RESOLVED_TEXT);
  // On main Surface derived `verified` here from the record's verified event.
  assert.equal(surfaceDerivedStatus(attestation.surface), 'proposed');

  const readiness = runReadiness(rootDir);
  // The weaker claim does not gate: readiness is exactly as it was.
  assert.deepEqual(readinessSummary(readiness), READY, readiness.result.stdout + readiness.result.stderr);
  const currencyEvidence = governanceAttestationEvidence(readiness.record);
  assert.match(currencyEvidence.excerptOrSummary, NOT_RESOLVED_TEXT);
  assert.doesNotMatch(currencyEvidence.excerptOrSummary, /Authority-backed/);

  const { currency, artifacts } = projectedGovernanceClaims(readiness.record);
  assert.equal(currency.status, 'verified');
  assert.equal(currency.confidenceBasis.sourceQuality, 'weak');
  assert.equal(currency.confidenceBasis.reviewerAuthority, 'none');
  assert.equal(currency.confidenceBasis.evidenceStrength, 'weak');
  assert.equal(artifacts.length, 3);
  for (const artifact of artifacts) {
    assert.equal(artifact.status, 'verified', artifact.id);
    assert.equal(artifact.confidenceBasis.reviewerAuthority, 'none', artifact.id);
  }
});

test('a prefix-matched approval reference that was never resolved stays a proposed claim', (t) => {
  const rootDir = initVeritasRepo(t, 'veritas-claim-strength-prefix-');
  setApprovalRefPolicy(rootDir, { mode: 'prefix', allowed_prefixes: ['change/'] });
  commitAll(rootDir, 'Require approval reference prefix');
  const attestation = attestBootstrap(rootDir, 'change/123');

  assert.equal(attestation.metadata.approvalRefPolicy.mode, 'prefix');
  assert.equal(attestation.metadata.approvalRefPolicy.matchedPrefix, 'change/');
  assert.equal(attestation.surface.claim.status, 'proposed');
  assert.deepEqual(attestation.surface.claim.confidenceBasis, UNRESOLVED_CONFIDENCE);
  assert.equal(surfaceDerivedStatus(attestation.surface), 'proposed');
});

test('an approval resolved against an offline approval record keeps the strong verified claim', (t) => {
  const rootDir = initVeritasRepo(t, 'veritas-claim-strength-resolved-');
  setApprovalRefPolicy(rootDir, { mode: 'resolved', allowed_prefixes: ['veritas-approval:'] });
  writeApprovalRecord(rootDir, 'chg-180');
  commitAll(rootDir, 'Resolve approval references');
  const attestation = attestBootstrap(rootDir, 'veritas-approval:chg-180');

  assert.equal(attestation.metadata.approvalRefPolicy.mode, 'resolved');
  assert.equal(attestation.metadata.approvalResolution.status, 'approved');
  const { claim, event, evidence } = attestation.surface;
  assert.equal(claim.status, 'verified');
  assert.deepEqual(claim.confidenceBasis, RESOLVED_CONFIDENCE);
  assert.equal(event.status, 'verified');
  assert.equal(event.verifiedAt, attestation.attestedAt);
  assert.match(evidence.excerptOrSummary, /^Authority-backed bootstrap attestation/);
  assert.equal(surfaceDerivedStatus(attestation.surface), 'verified');

  const readiness = runReadiness(rootDir);
  assert.deepEqual(readinessSummary(readiness), READY, readiness.result.stdout + readiness.result.stderr);
  assert.match(governanceAttestationEvidence(readiness.record).excerptOrSummary, /^Authority-backed attestation currency is verified/);

  const { currency, artifacts } = projectedGovernanceClaims(readiness.record);
  assert.equal(currency.status, 'verified');
  assert.equal(currency.confidenceBasis.sourceQuality, 'strong');
  assert.equal(currency.confidenceBasis.reviewerAuthority, 'human');
  assert.equal(currency.confidenceBasis.evidenceStrength, 'strong');
  assert.equal(artifacts.length, 3);
  for (const artifact of artifacts) {
    assert.equal(artifact.confidenceBasis.reviewerAuthority, 'authority', artifact.id);
  }
});

test('an approved resolver result supplied under reference-only mode is not treated as resolved', (t) => {
  // reference-only never checks a supplied resolver result (not even its
  // expiry), so recording it must not upgrade the claim.
  const rootDir = initVeritasRepo(t, 'veritas-claim-strength-unchecked-result-');
  const { attestation } = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'alice',
    approvalRef: 'veritas-approval:chg-180',
    approvalResolverResult: { status: 'approved', approvalRef: 'veritas-approval:chg-180' },
  });
  assert.equal(attestation.metadata.approvalRefPolicy.requiresResolution, false);
  assert.equal(attestation.metadata.approvalResolution.approved, true);
  assert.equal(attestation.surface.claim.status, 'proposed');
  assert.deepEqual(attestation.surface.claim.confidenceBasis, UNRESOLVED_CONFIDENCE);
});

test('a resolver result for a different reference does not back the cited reference', (t) => {
  // resolved mode checks that a supplied result is approved and unexpired, not
  // that it is for the reference the attestation cites.
  const rootDir = initVeritasRepo(t, 'veritas-claim-strength-mismatched-result-');
  setApprovalRefPolicy(rootDir, { mode: 'resolved', allowed_prefixes: [] });
  commitAll(rootDir, 'Resolve approval references');
  const { attestation } = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'alice',
    approvalRef: 'made-up-123',
    approvalResolverResult: { status: 'approved', approvalRef: 'something-else' },
  });
  assert.equal(attestation.metadata.approvalRefPolicy.requiresResolution, true);
  assert.equal(attestation.metadata.approvalResolution.approved, true);
  assert.equal(attestation.metadata.approvalResolution.approvalRef, 'something-else');
  assert.equal(attestation.surface.claim.status, 'proposed');
  assert.deepEqual(attestation.surface.claim.confidenceBasis, UNRESOLVED_CONFIDENCE);

  const readiness = runReadiness(rootDir);
  assert.deepEqual(readinessSummary(readiness), READY, readiness.result.stdout + readiness.result.stderr);
  assert.match(governanceAttestationEvidence(readiness.record).excerptOrSummary, NOT_RESOLVED_TEXT);
  const { currency, artifacts } = projectedGovernanceClaims(readiness.record);
  assert.equal(currency.confidenceBasis.reviewerAuthority, 'none');
  for (const artifact of artifacts) assert.equal(artifact.confidenceBasis.reviewerAuthority, 'none', artifact.id);
});

// Rewrites a reference-only record's approval metadata so that, read on its
// own, it looks resolved: mode, requiresResolution, and an approved result for
// the cited reference. Only record integrity can tell it apart.
function forgeResolvedApprovalMetadata(rootDir, attestation, { stripIntegrity }) {
  const path = join(rootDir, `.veritas/attestations/${attestation.id}.attestation.json`);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.metadata.approvalRefPolicy = { mode: 'resolved', matchedPrefix: null, requiresResolution: true };
  record.metadata.approvalResolution = {
    schemaVersion: 1,
    status: 'approved',
    approved: true,
    approvalRef: record.metadata.approvalRef,
    provider: 'veritas-offline',
    authorityRef: 'forged',
    approvedBy: 'change-manager',
    approvedAt: record.attestedAt,
    expiresAt: null,
    scope: null,
    evidenceHash: null,
    resolvedAt: record.attestedAt,
    failureReason: null,
  };
  if (stripIntegrity) delete record.recordIntegrity;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

const INTEGRITY_GAP_TEXT = /not authority-backed because its record integrity is not verified/;

for (const { name, stripIntegrity, state, integrity, exitStatus } of [
  { name: 'an edited record', stripIntegrity: false, state: 'tampered', integrity: 'mismatch', exitStatus: 1 },
  { name: 'a record with recordIntegrity deleted', stripIntegrity: true, state: 'current', integrity: 'unbound', exitStatus: 0 },
]) {
  test(`forged resolved approval metadata in ${name} is not projected as authority-backed`, (t) => {
    const rootDir = initVeritasRepo(t, 'veritas-claim-strength-forged-');
    const attestation = attestBootstrap(rootDir, 'made-up-123');
    forgeResolvedApprovalMetadata(rootDir, attestation, { stripIntegrity });

    const readiness = runReadiness(rootDir);
    assert.equal(readiness.result.status, exitStatus, readiness.result.stdout + readiness.result.stderr);
    assert.equal(readiness.record.governance_state.state, state);
    assert.equal(readiness.record.governance_state.recordIntegrity.status, integrity);
    assert.equal(readiness.record.governance_state.attestation.metadata.approvalRefPolicy.requiresResolution, true);
    const currencyEvidence = governanceAttestationEvidence(readiness.record);
    assert.match(currencyEvidence.excerptOrSummary, INTEGRITY_GAP_TEXT);
    assert.doesNotMatch(currencyEvidence.excerptOrSummary, /Authority-backed/);

    const { currency, artifacts } = projectedGovernanceClaims(readiness.record);
    assert.equal(currency.confidenceBasis.sourceQuality, 'weak');
    assert.equal(currency.confidenceBasis.reviewerAuthority, 'none');
    assert.equal(currency.confidenceBasis.evidenceStrength, 'weak');
    for (const artifact of artifacts) assert.equal(artifact.confidenceBasis.reviewerAuthority, 'none', artifact.id);
  });
}
