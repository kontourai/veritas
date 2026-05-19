import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTrustReport, validateTrustInput } from '@kontourai/surface';
import { generateVeritasReport, initClaimStore } from '../src/index.mjs';
import { frameworkRootDir } from './helpers.mjs';

test('Veritas surface.input validates against Surface and has policy coverage', async () => {
  const claimsPath = join(frameworkRootDir, 'veritas.claims.json');
  const originalClaims = existsSync(claimsPath) ? readFileSync(claimsPath, 'utf8') : null;
  await initClaimStore({ rootDir: frameworkRootDir, repoName: 'veritas-framework', force: true });
  let result;
  try {
    result = await generateVeritasReport(
      {
        rootDir: frameworkRootDir,
        workingTree: true,
        runId: 'surface-projection-test',
      },
      { rootDir: frameworkRootDir },
    );
  } finally {
    if (originalClaims !== null) {
      writeFileSync(claimsPath, originalClaims, 'utf8');
    } else {
      rmSync(claimsPath, { force: true });
    }
  }

  const input = validateTrustInput(result.record.surface.input);
  const report = buildTrustReport(input, {
    id: 'surface-projection-test',
    now: new Date(result.record.timestamp),
  });

  assert.equal(input.source, 'veritas:surface-projection-test');
  assert.equal(input.policies.some((policy) => policy.id === 'veritas.governance-artifact'), true);
  assert.equal(report.claims.length, input.claims.length);

  for (const claim of report.claims) {
    assert.ok(
      report.proofRequirementsByClaimId[claim.id],
      `expected policy coverage for ${claim.id}`,
    );
  }
});

test('Surface validation failure writes rejected input artifact and uses config exit code', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-surface-invalid-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  await initClaimStore({ rootDir, repoName: 'invalid-surface-projection-test', force: true });

  await assert.rejects(
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
  assert.equal(Array.isArray(rejectedInput.claims), true);
});
