import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTrustReport, validateTrustInput } from '@kontourai/surface';
import { generateVeritasReport } from '../src/index.mjs';
import { frameworkRootDir } from './helpers.mjs';

test('Veritas surface.input validates against Surface and has policy coverage', () => {
  const result = generateVeritasReport(
    {
      rootDir: frameworkRootDir,
      workingTree: true,
      runId: 'surface-projection-test',
    },
    { rootDir: frameworkRootDir },
  );

  const input = validateTrustInput(result.record.surface.input);
  const report = buildTrustReport(input, {
    id: 'surface-projection-test',
    now: new Date(result.record.timestamp),
  });

  assert.equal(input.source, 'veritas:surface-projection-test');
  assert.equal(input.policies.some((policy) => policy.id === 'veritas.external-tool-result'), true);
  assert.equal(report.claims.length, input.claims.length);

  for (const claim of report.claims) {
    assert.ok(
      report.proofRequirementsByClaimId[claim.id],
      `expected policy coverage for ${claim.id}`,
    );
  }
});

test('Surface validation failure writes rejected input artifact and uses config exit code', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-surface-invalid-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  assert.throws(
    () => generateVeritasReport(
      {
        rootDir,
        adapterPath: join(frameworkRootDir, '.veritas/repo.adapter.json'),
        policyPackPath: join(frameworkRootDir, '.veritas/policy-packs/default.policy-pack.json'),
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
      assert.match(error.message, /Surface TrustInput validation failed/);
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
  assert.equal(rejectedInput.claims[0].createdAt, 'not-a-date');
});
