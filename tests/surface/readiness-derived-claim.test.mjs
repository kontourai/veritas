import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrustReport, validateTrustBundle } from '@kontourai/surface';
import { SURFACE_TRUST_POLICIES } from '../../src/surface/policies.mjs';

const OBSERVED_AT = '2026-06-02T12:00:00.000Z';
const SOURCE_REF = 'generic-change-readiness-fixture';

function readinessDerivedFixture({ blocked = false, advisoryFailed = false } = {}) {
  const runId = blocked
    ? 'readiness-derived-blocked'
    : advisoryFailed
      ? 'readiness-derived-advisory-failed'
      : 'readiness-derived-pass';
  const blockingPolicyClaims = [
    policyResultClaim({
      runId,
      ruleId: 'required-tests-pass',
      value: {
        requirement: 'Required tests pass before merge readiness is granted.',
        passed: !blocked,
        enforcementLevel: 'Require',
      },
    }),
    policyResultClaim({
      runId,
      ruleId: 'required-review-evidence-present',
      value: {
        requirement: 'Required review evidence is present before merge readiness is granted.',
        passed: true,
        enforcementLevel: 'Require',
      },
    }),
  ];
  const advisoryPolicyClaims = advisoryFailed
    ? [
        policyResultClaim({
          runId,
          ruleId: 'docs-advisory-present',
          value: {
            requirement: 'Advisory documentation evidence can improve review confidence.',
            passed: false,
            enforcementLevel: 'Guide',
          },
        }),
      ]
    : [];
  const policyClaims = [...blockingPolicyClaims, ...advisoryPolicyClaims];
  const readinessClaim = {
    id: `veritas.${runId}.readiness-verdict.${SOURCE_REF}`,
    subjectType: 'repository-change',
    subjectId: `generic-repository:${SOURCE_REF}`,
    surface: 'veritas.readiness',
    claimType: 'software-readiness-verdict',
    fieldOrBehavior: 'mergeReadiness',
    value: {
      verdict: blocked ? 'not-ready' : 'ready',
      promotionAllowed: !blocked,
      sourceRef: SOURCE_REF,
    },
    status: 'verified',
    impactLevel: 'high',
    verificationPolicyId: SURFACE_TRUST_POLICIES.readinessVerdict.id,
    derivedFrom: blockingPolicyClaims.map((claim) => claim.id),
    derivationEdges: blockingPolicyClaims.map((claim) => ({
      inputClaimId: claim.id,
      method: 'rule-application',
      role: 'blocking-requirement',
      supportStrength: 'strong',
      rationale: `Veritas merge readiness applies ${claim.fieldOrBehavior} as a blocking requirement.`,
    })),
    currentIntegrityRef: SOURCE_REF,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    metadata: {
      producer: 'veritas',
      source: 'readiness',
      policyCoverage: {
        derivedRequirementClaimIds: blockingPolicyClaims.map((claim) => claim.id),
      },
    },
  };

  const claims = [...policyClaims, readinessClaim];
  const evidence = [
    ...policyClaims.map((claim) => policyResultEvidence({
      claim,
      passing: claim.value.passed,
      blocking: claim.value.enforcementLevel === 'Require',
    })),
    {
      id: `${readinessClaim.id}.evidence`,
      claimId: readinessClaim.id,
      evidenceType: 'policy_rule',
      method: 'validation',
      sourceRef: SOURCE_REF,
      excerptOrSummary: 'Veritas readiness producer evaluated merge readiness from requirement results.',
      observedAt: OBSERVED_AT,
      collectedBy: 'veritas',
      integrityRef: SOURCE_REF,
      passing: true,
      blocking: true,
    },
  ];
  const events = [
    ...policyClaims.map((claim) => ({
      id: `${claim.id}.${claim.value.passed ? 'verified' : 'rejected'}`,
      claimId: claim.id,
      status: claim.value.passed ? 'verified' : 'rejected',
      actor: 'veritas',
      method: 'requirements evaluation',
      evidenceIds: [`${claim.id}.evidence`],
      createdAt: OBSERVED_AT,
      verifiedAt: OBSERVED_AT,
    })),
    {
      id: `${readinessClaim.id}.verified`,
      claimId: readinessClaim.id,
      status: 'verified',
      actor: 'veritas',
      method: 'readiness derivation',
      evidenceIds: [`${readinessClaim.id}.evidence`],
      createdAt: OBSERVED_AT,
      verifiedAt: OBSERVED_AT,
    },
  ];

  return {
    name: runId,
    trust: {
      bundle: {
        schemaVersion: 3,
        source: `veritas:${runId}`,
        claims,
        evidence,
        policies: [
          SURFACE_TRUST_POLICIES.policyResult,
          SURFACE_TRUST_POLICIES.readinessVerdict,
        ],
        events,
      },
    },
  };
}

function policyResultClaim({ runId, ruleId, value }) {
  return {
    id: `veritas.${runId}.policy.${ruleId}`,
    subjectType: 'policy-rule',
    subjectId: `generic-repo-standards:${ruleId}`,
    surface: 'veritas.policy-results',
    claimType: 'veritas-policy-result',
    fieldOrBehavior: ruleId,
    value,
    impactLevel: 'high',
    verificationPolicyId: SURFACE_TRUST_POLICIES.policyResult.id,
    currentIntegrityRef: SOURCE_REF,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    metadata: {
      ruleId,
      enforcementLevel: value.enforcementLevel,
      classification: 'promotable-policy',
    },
  };
}

function policyResultEvidence({ claim, passing, blocking }) {
  return {
    id: `${claim.id}.evidence`,
    claimId: claim.id,
    evidenceType: 'policy_rule',
    method: 'validation',
    sourceRef: SOURCE_REF,
    sourceLocator: `requirements.${claim.fieldOrBehavior}`,
    excerptOrSummary: `Requirement ${claim.fieldOrBehavior} ${passing ? 'passed' : 'failed'} during readiness evaluation.`,
    observedAt: OBSERVED_AT,
    collectedBy: 'veritas',
    integrityRef: SOURCE_REF,
    passing,
    blocking,
  };
}

function buildReportFromFixture(fixture) {
  const input = validateTrustBundle(fixture.trust.bundle);
  const report = buildTrustReport(input, {
    id: `${fixture.name}-surface-report`,
    now: new Date(OBSERVED_AT),
  });
  return { input, report };
}

function readinessClaimFrom(inputOrReport) {
  const claim = inputOrReport.claims.find((item) => item.claimType === 'software-readiness-verdict');
  assert.ok(claim, 'expected software-readiness-verdict claim');
  return claim;
}

function assertReadinessDerivationShape(input) {
  const readinessClaim = readinessClaimFrom(input);
  assert.equal(readinessClaim.claimType, 'software-readiness-verdict');
  assert.equal(readinessClaim.surface, 'veritas.readiness');
  assert.ok(Array.isArray(readinessClaim.derivedFrom));
  assert.ok(readinessClaim.derivedFrom.length > 0);
  assert.ok(Array.isArray(readinessClaim.derivationEdges));
  assert.deepEqual(
    readinessClaim.derivationEdges.map((edge) => edge.inputClaimId),
    readinessClaim.derivedFrom,
  );

  const policyResultIds = new Set(
    input.claims
      .filter((claim) => claim.claimType === 'veritas-policy-result')
      .map((claim) => claim.id),
  );
  for (const inputClaimId of readinessClaim.derivedFrom) {
    assert.equal(
      policyResultIds.has(inputClaimId),
      true,
      `expected derivation input ${inputClaimId} to exist as a veritas-policy-result claim`,
    );
  }
}

test('passing readiness fixture stays verified through Surface derivation', () => {
  const fixture = readinessDerivedFixture();
  const { input, report } = buildReportFromFixture(fixture);

  assertReadinessDerivationShape(input);
  const readinessReportClaim = readinessClaimFrom(report);
  assert.equal(readinessReportClaim.status, 'verified');
  assert.equal(readinessReportClaim.producerStatus, undefined);
  assert.equal(report.changeRecords.some((record) => record.claimId === readinessReportClaim.id), false);
});

test('failed advisory policy result does not downgrade readiness through Surface derivation', () => {
  const fixture = readinessDerivedFixture({ advisoryFailed: true });
  const { input, report } = buildReportFromFixture(fixture);

  assertReadinessDerivationShape(input);
  const advisoryInputClaim = input.claims.find((claim) => claim.metadata?.ruleId === 'docs-advisory-present');
  assert.ok(advisoryInputClaim, 'expected advisory policy result claim to remain visible');
  const readinessInputClaim = readinessClaimFrom(input);
  assert.equal(readinessInputClaim.derivedFrom.includes(advisoryInputClaim.id), false);

  const readinessReportClaim = readinessClaimFrom(report);
  assert.equal(readinessReportClaim.status, 'verified');
  assert.equal(readinessReportClaim.producerStatus, undefined);
  const advisoryReportClaim = report.claims.find((claim) => claim.id === advisoryInputClaim.id);
  assert.ok(advisoryReportClaim, 'expected advisory policy result claim in Surface report');
  assert.equal(advisoryReportClaim.status, 'rejected');
  assert.equal(report.changeRecords.some((record) => record.claimId === readinessReportClaim.id), false);
});

test('blocked readiness fixture is weakest-link downgraded through Surface derivation', () => {
  const fixture = readinessDerivedFixture({ blocked: true });
  const { input, report } = buildReportFromFixture(fixture);

  assertReadinessDerivationShape(input);
  const readinessInputClaim = readinessClaimFrom(input);
  const readinessReportClaim = readinessClaimFrom(report);
  assert.equal(readinessInputClaim.status, 'verified');
  assert.equal(readinessReportClaim.status, 'rejected');
  assert.equal(readinessReportClaim.producerStatus, 'verified');

  const blockingRecord = report.changeRecords.find((record) =>
    record.claimId === readinessReportClaim.id &&
    record.reason === 'input-rejected' &&
    record.action === 'blocked'
  );
  assert.ok(blockingRecord, 'expected Surface derivation change record for rejected input');
  assert.equal(
    blockingRecord.inputClaimIds.some((inputClaimId) => readinessInputClaim.derivedFrom.includes(inputClaimId)),
    true,
  );
  assert.equal(report.summary.recomputeNeededClaims.includes(readinessReportClaim.id), false);
});
