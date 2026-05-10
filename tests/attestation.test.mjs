import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAttestation,
  buildExplainText,
  inspectAttestationStatus,
  writeBootstrapStarterKit,
} from '../src/index.mjs';
import {
  commitAll,
  frameworkRootDir,
  initCommittedRepo,
  parseCliJson,
  readJsonFromAbsolute,
} from './helpers.mjs';

function bootstrapVeritasRepo(prefix = 'veritas-attest-') {
  const rootDir = initCommittedRepo(prefix);
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'attestation-fixture',
    proofLane: 'npm test',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap Veritas');
  return rootDir;
}

test('bootstrap attestation records Zone 1 hashes and status detects drift', () => {
  const rootDir = bootstrapVeritasRepo();
  const result = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    attestedAt: '2026-05-10T00:00:00.000Z',
  });

  assert.match(result.path, /\.veritas\/attestations\/.+\.attestation\.json$/);
  const current = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(current.state, 'current');
  assert.equal(current.expired, false);

  const policyPath = join(rootDir, '.veritas/policy-packs/default.policy-pack.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.description = `${policy.description} Changed after attestation.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

  const drifted = inspectAttestationStatus(rootDir, { now: '2026-05-11T00:00:00.000Z' });
  assert.equal(drifted.state, 'drifted');
  assert.deepEqual(drifted.drift.map((item) => item.field), ['policyPackHash']);
});

test('policy-change attestation chains to prior attestation and refreshes drift', () => {
  const rootDir = bootstrapVeritasRepo();
  const bootstrap = createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Initial human approval.',
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const policyPath = join(rootDir, '.veritas/policy-packs/default.policy-pack.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.description = `${policy.description} Human-reviewed update.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const change = createAttestation({
    rootDir,
    kind: 'policy-change',
    actor: 'brian',
    notes: 'Reviewed policy description change.',
    attestedAt: '2026-05-12T00:00:00.000Z',
  });

  assert.equal(change.attestation.priorAttestationId, bootstrap.attestation.id);
  assert.equal(inspectAttestationStatus(rootDir).state, 'current');
});

test('expired attestation is warned but not drifted', () => {
  const rootDir = bootstrapVeritasRepo();
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Short validity.',
    validUntilDays: 1,
    attestedAt: '2026-05-10T00:00:00.000Z',
  });
  const status = inspectAttestationStatus(rootDir, { now: '2026-05-12T00:00:00.000Z' });
  assert.equal(status.state, 'current');
  assert.equal(status.expired, true);
});

test('shadow run prints a warning for expired attestation', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-expired-shadow-');
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'Short validity.',
    validUntilDays: 1,
    attestedAt: '2020-01-01T00:00:00.000Z',
  });
  const cli = join(frameworkRootDir, 'bin/veritas.mjs');
  const output = execFileSync('node', [
    cli,
    'run',
    '--root',
    rootDir,
    '--skip-proof',
    '--working-tree',
  ], { cwd: rootDir, encoding: 'utf8' });
  assert.match(output, /WARN\s+policy-changes-require-attestation/);
  assert.match(output, /expired/i);
});

test('attestation rule is visible to explain context', () => {
  const rootDir = bootstrapVeritasRepo('veritas-attest-explain-');
  const text = buildExplainText({
    rootDir,
    adapter: readJsonFromAbsolute(join(rootDir, '.veritas/repo.adapter.json')),
    policyPack: readJsonFromAbsolute(join(rootDir, '.veritas/policy-packs/default.policy-pack.json')),
    ruleId: 'policy-changes-require-attestation',
  });
  assert.match(text, /Rule: policy-changes-require-attestation/);
  assert.match(text, /Shadow runs fail on drift until a human records a fresh attestation/);
});

test('attestation refuses CI or bot actors', () => {
  const rootDir = bootstrapVeritasRepo();
  assert.throws(
    () => createAttestation({ rootDir, kind: 'bootstrap', actor: 'github-actions[bot]' }),
    /non-human actor/,
  );
});

test('CLI bootstrap writes tracked attestation and shadow run fails on Zone 1 drift until policy-change attestation', () => {
  const rootDir = bootstrapVeritasRepo();
  const cli = join(frameworkRootDir, 'bin/veritas.mjs');
  const bootstrapOutput = execFileSync('node', [
    cli,
    'attest',
    'bootstrap',
    '--root',
    rootDir,
    '--actor',
    'brian',
    '--non-interactive',
  ], { cwd: rootDir, encoding: 'utf8' });
  const bootstrap = parseCliJson(bootstrapOutput);
  assert.equal(readJsonFromAbsolute(join(rootDir, '.veritas/attestations/HEAD')).currentAttestationId, bootstrap.attestation.id);

  const policyPath = join(rootDir, '.veritas/policy-packs/default.policy-pack.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.description = `${policy.description} Drift for shadow run.`;
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

  assert.throws(
    () => execFileSync('node', [
      cli,
      'run',
      '--root',
      rootDir,
      '--skip-proof',
      '--working-tree',
    ], { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' }),
    (error) => {
      assert.match(error.stdout.toString(), /FAIL\s+policy-changes-require-attestation/);
      return true;
    },
  );

  execFileSync('node', [
    cli,
    'attest',
    'policy-change',
    '--root',
    rootDir,
    '--actor',
    'brian',
    '--message',
    'Reviewed policy drift.',
  ], { cwd: rootDir, encoding: 'utf8' });
  const shadowOutput = execFileSync('node', [
    cli,
    'run',
    '--root',
    rootDir,
    '--skip-proof',
    '--working-tree',
  ], { cwd: rootDir, encoding: 'utf8' });
  assert.match(shadowOutput, /PASS\s+policy-changes-require-attestation/);
});
