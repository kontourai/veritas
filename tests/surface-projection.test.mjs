import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TrustBundleBuilder, buildTrustReport, validateTrustBundle } from '@kontourai/surface';
import { buildSurfaceTrustBundle, generateVeritasReport, initClaimStore } from '../src/index.mjs';
import { repoRootDir } from './helpers.mjs';

test('Veritas trust.bundle validates against Surface and has policy coverage', async () => {
  const claimsPath = join(repoRootDir, 'veritas.claims.json');
  const originalClaims = existsSync(claimsPath) ? readFileSync(claimsPath, 'utf8') : null;
  await initClaimStore({ rootDir: repoRootDir, repoName: 'veritas-framework', force: true });
  let result;
  try {
    result = await generateVeritasReport(
      {
        rootDir: repoRootDir,
        workingTree: true,
        runId: 'surface-projection-test',
      },
      { rootDir: repoRootDir },
    );
  } finally {
    if (originalClaims !== null) {
      writeFileSync(claimsPath, originalClaims, 'utf8');
    } else {
      rmSync(claimsPath, { force: true });
    }
  }

  const input = validateTrustBundle(result.record.trust.bundle);
  const report = buildTrustReport(input, {
    id: 'surface-projection-test',
    now: new Date(result.record.timestamp),
  });

  assert.equal(input.source, 'veritas:surface-projection-test');
  assert.equal(input.id, undefined);
  assert.equal(input.generatedAt, undefined);
  assert.equal(input.summary, undefined);
  assert.equal(input.transparencyGaps, undefined);
  assert.equal(input.evidenceRequirementsByClaimId, undefined);
  assert.equal(input.policies.some((policy) => policy.id === 'veritas.governance-artifact'), true);
  assert.equal(input.policies.some((policy) => policy.id === 'veritas.readiness-verdict'), true);
  assert.equal(report.claims.length, input.claims.length);
  const readinessClaim = input.claims.find((claim) => claim.claimType === 'software-readiness-verdict');
  assert.ok(readinessClaim, 'expected Surface readiness verdict claim');
  assert.equal(readinessClaim.subjectType, 'repository-change');
  assert.equal(readinessClaim.surface, 'veritas.readiness');
  assert.equal(readinessClaim.verificationPolicyId, 'veritas.readiness-verdict');
  assert.equal(['ready', 'not-ready', 'needs-review'].includes(readinessClaim.value.verdict), true);
  assert.ok(readinessClaim.currentIntegrityRef);
  assert.ok(readinessClaim.metadata.policyCoverage);
  assert.ok(readinessClaim.metadata.integrity.sourceRef);
  assert.ok(Array.isArray(readinessClaim.metadata.integrity.fileRefs));
  assert.ok(readinessClaim.metadata.integrity.configRefs);
  const readinessEvidence = input.evidence.find((item) => item.claimId === readinessClaim.id);
  assert.ok(readinessEvidence, 'expected readiness verdict evidence');
  assert.ok(readinessEvidence.metadata.integrity.sourceRef);
  assert.ok(input.events.some((event) =>
    event.claimId === readinessClaim.id &&
    event.evidenceIds.includes(readinessEvidence.id)
  ));
  assert.ok(report.claims.some((claim) => claim.id === readinessClaim.id));
  if (typeof TrustBundleBuilder.prototype.addClaimGroup === 'function') {
    assert.ok(input.claimGroups?.some((claimGroup) => claimGroup.kind === 'requirement-set'));
    assert.ok(report.claimGroupRollups.some((claimGroup) => claimGroup.id.startsWith('veritas.requirements.')));
  }

  for (const claim of report.claims) {
    assert.ok(
      report.evidenceRequirementsByClaimId[claim.id],
      `expected policy coverage for ${claim.id}`,
    );
  }
});

test('buildSurfaceTrustBundle projects readiness derivation links to blocking policy result claims', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-surface-derived-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  await initClaimStore({ rootDir, repoName: 'surface-derived-projection-test', force: true });

  const input = validateTrustBundle(await buildSurfaceTrustBundle({
    run_id: 'surface-derived-projection-test',
    timestamp: '2026-06-02T12:00:00.000Z',
    source_ref: 'derived-projection-source',
    source_kind: 'explicit-files',
    source_scope: ['package.json'],
    resolved_phase: 'Implementation',
    resolved_workstream: 'Derived readiness projection',
    components: [],
    triggered_evidence_checks: [],
    selected_evidence_checks: [],
    policy_results: [
      {
        rule_id: 'required-tests-pass',
        passed: true,
        stage: 'block',
        classification: 'hard-invariant',
        implemented: true,
        summary: 'Required tests passed.',
        message: 'Required tests passed.',
      },
      {
        rule_id: 'docs-advisory-present',
        passed: false,
        stage: 'warn',
        classification: 'advisory',
        implemented: true,
        summary: 'Advisory documentation check failed.',
        message: 'Advisory documentation check failed.',
      },
    ],
    evidence_inventory_results: [],
    external_tool_results: [],
    readiness_coverage: null,
    selected_evidence_check_ids: [],
    selected_evidence_check_labels: [],
    evidence_check_resolution_source: 'default',
    baseline_ci_fast_passed: null,
    uncovered_path_result: 'clear',
    promotion_allowed: true,
    files: ['package.json'],
    unresolved_files: [],
    repo_map: { name: 'surface-derived-map', kind: 'repo-map', report_transport: 'local-json' },
    repo_standards: { name: 'surface-derived-standards', version: '1', rule_count: 2 },
    integrity: {
      sourceRef: 'derived-projection-source',
      fileRefs: [{ path: 'package.json', sha256: 'test-sha' }],
      configRefs: [],
    },
  }, { rootDir }));

  const readinessClaim = input.claims.find((claim) => claim.claimType === 'software-readiness-verdict');
  assert.ok(readinessClaim, 'expected projected readiness verdict claim');
  assert.ok(Array.isArray(readinessClaim.derivedFrom), 'expected readiness derivedFrom links');
  assert.equal(readinessClaim.derivedFrom.length, 1);
  assert.ok(Array.isArray(readinessClaim.derivationEdges), 'expected readiness derivationEdges');
  assert.deepEqual(
    readinessClaim.derivationEdges.map((edge) => edge.inputClaimId),
    readinessClaim.derivedFrom,
  );

  const policyResultClaims = input.claims.filter((claim) => claim.claimType === 'veritas-policy-result');
  const policyResultIds = new Set(policyResultClaims.map((claim) => claim.id));
  const advisoryPolicyResult = policyResultClaims.find((claim) => claim.metadata?.ruleId === 'docs-advisory-present');
  assert.ok(advisoryPolicyResult, 'expected advisory policy result claim to remain visible');
  assert.equal(readinessClaim.derivedFrom.includes(advisoryPolicyResult.id), false);
  for (const inputClaimId of readinessClaim.derivedFrom) {
    assert.equal(
      policyResultIds.has(inputClaimId),
      true,
      `expected derivation input ${inputClaimId} to exist as a projected veritas-policy-result claim`,
    );
  }
  assert.deepEqual(readinessClaim.metadata.policyCoverage.derivedRequirementClaimIds, readinessClaim.derivedFrom);
  assert.equal(readinessClaim.derivationEdges.some((edge) => edge.role === 'blocking-requirement'), true);
  assert.equal(readinessClaim.derivationEdges.some((edge) => edge.role === 'advisory-requirement'), false);
});

test('Surface validation failure writes rejected input artifact and uses config exit code', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-surface-invalid-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  await initClaimStore({ rootDir, repoName: 'invalid-surface-projection-test', force: true });

  await assert.rejects(
    () => generateVeritasReport(
      {
        rootDir,
        repoMapPath: join(repoRootDir, '.veritas/repo-map.json'),
        repoStandardsPath: join(repoRootDir, '.veritas/repo-standards/default.repo-standards.json'),
        runId: 'invalid-surface-projection-test',
        sourceRef: 'test-source-ref',
        sourceKind: 'explicit-files',
        sourceScope: ['explicit'],
        timestamp: 'not-a-date',
      },
      { rootDir },
      ['package.json'],
    ),
    (error) => {
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /Surface TrustBundle validation failed/);
      assert.match(error.message, /Rejected input: \.veritas\/external\/surface-validation-failures\/invalid-surface-projection-test\.json/);
      return true;
    },
  );

  const failurePath = join(
    rootDir,
    '.veritas/external/surface-validation-failures/invalid-surface-projection-test.json',
  );
  assert.equal(existsSync(failurePath), true);
  const rejectedInput = JSON.parse(readFileSync(failurePath, 'utf8'));
  assert.equal(rejectedInput.source, 'veritas:invalid-surface-projection-test');
  assert.equal(Array.isArray(rejectedInput.claims), true);
});

test('emitted trust.bundle validates against hachure@0.4.0 schema (schemaVersion 3)', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-hachure-schema-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  await initClaimStore({ rootDir, repoName: 'hachure-schema-test', force: true });

  const bundle = await buildSurfaceTrustBundle({
    run_id: 'hachure-schema-test',
    timestamp: '2026-06-15T12:00:00.000Z',
    source_ref: 'hachure-schema-source',
    source_kind: 'explicit-files',
    source_scope: ['package.json'],
    resolved_phase: 'Implementation',
    resolved_workstream: 'Hachure schema validation test',
    components: [],
    triggered_evidence_checks: [],
    selected_evidence_checks: [],
    policy_results: [],
    evidence_inventory_results: [],
    external_tool_results: [],
    readiness_coverage: null,
    selected_evidence_check_ids: [],
    selected_evidence_check_labels: [],
    evidence_check_resolution_source: 'default',
    baseline_ci_fast_passed: null,
    uncovered_path_result: 'clear',
    promotion_allowed: true,
    files: ['package.json'],
    unresolved_files: [],
    repo_map: { name: 'hachure-schema-test-map', kind: 'repo-map', report_transport: 'local-json' },
    repo_standards: { name: 'hachure-schema-test-standards', version: '1', rule_count: 0 },
    integrity: {
      sourceRef: 'hachure-schema-source',
      fileRefs: [{ path: 'package.json', sha256: 'test-sha' }],
      configRefs: [],
    },
  }, { rootDir });

  // Import the Hachure validator directly to confirm the bundle passes
  const { validateTrustBundleSchema } = await import('../src/surface/trust-bundle-validator.mjs');
  const result = validateTrustBundleSchema(bundle);
  assert.equal(result.valid, true, `Hachure schema validation failed: ${result.errors.join('; ')}`);
  assert.equal(bundle.schemaVersion, 3, 'emitted bundle must use schemaVersion 3');

  rmSync(rootDir, { recursive: true, force: true });
});
