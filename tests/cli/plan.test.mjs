import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateAgainstSchema } from '../../src/schema-validation.mjs';
import { writeBootstrapStarterKit } from '../../src/bootstrap.mjs';
import { initCommittedRepo, commitAll, repoRootDir } from '../helpers.mjs';

function fixture(t) {
  const rootDir = initCommittedRepo(t, 'veritas-plan-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --version' } }));
  writeBootstrapStarterKit({ rootDir, projectName: 'plan', evidenceCheck: 'node --version', force: true });
  const mapPath = join(rootDir, '.veritas/repo-map.json');
  const map = JSON.parse(readFileSync(mapPath));
  map.evidence.evidenceChecks.push({ id: 'hygiene', command: 'node forbidden-to-run.mjs', method: 'validation' });
  writeFileSync(mapPath, JSON.stringify(map));
  const standardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const standards = JSON.parse(readFileSync(standardsPath));
  standards.rules.push({ id: 'hygiene-policy', kind: 'evidence-check', classification: 'promotable-policy', enforcementLevel: 'Require',
    message: 'Explain suppressions.', match: { files: ['src/**', '!src/generated/**'] }, evidenceCheckIds: ['hygiene'],
    explain: { mustDo: ['Record the reason.'], exampleGood: '// reason: intentional compatibility' } });
  writeFileSync(standardsPath, JSON.stringify(standards));
  commitAll(rootDir, 'Plan fixture');
  return { rootDir, standardsPath };
}
function plan(rootDir, args) {
  return spawnSync(process.execPath, [join(repoRootDir, 'bin/veritas.mjs'), 'plan', '--root', rootDir, ...args], {
    encoding: 'utf8', windowsHide: true,
  });
}

test('plan briefs hypothetical files, selects real evidence requirements, and executes nothing', (t) => {
  const { rootDir } = fixture(t);
  const before = readdirSync(join(rootDir, '.kontourai/veritas/evidence'));
  const result = plan(rootDir, ['src/new.ts', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const resource = JSON.parse(result.stdout);
  assert.equal(resource.apiVersion, 'veritas.kontour.ai/v1alpha1');
  assert.equal(resource.kind, 'ChangePlan');
  const validation = validateAgainstSchema('veritas-change-plan.schema.json', resource);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const output = resource.status;
  assert.equal(output.executed, false);
  assert.equal(output.evidenceChecks.find((check) => check.id === 'hygiene').required, true);
  assert.deepEqual(output.guidance.find((rule) => rule.id === 'hygiene-policy').mustDo, ['Record the reason.']);
  assert.deepEqual(readdirSync(join(rootDir, '.kontourai/veritas/evidence')), before);
  const excluded = JSON.parse(plan(rootDir, ['src/generated/new.ts', '--json']).stdout).status;
  assert.equal(excluded.evidenceChecks.some((check) => check.id === 'hygiene'), false);
  const text = plan(rootDir, ['src/new.ts']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /REQUIRED hygiene/);
  assert.match(text.stdout, /Do: Record the reason/);
});

test('plan rejects malformed policy, unknown flags, outside paths and ambiguous scope', (t) => {
  const { rootDir, standardsPath } = fixture(t);
  for (const args of [['--typo'], ['../outside.ts'], ['src/new.ts', '--working-tree'], ['--changed-from', 'main']]) {
    assert.notEqual(plan(rootDir, args).status, 0, args.join(' '));
  }
  const standards = JSON.parse(readFileSync(standardsPath));
  delete standards.rules.at(-1).evidenceCheckIds;
  writeFileSync(standardsPath, JSON.stringify(standards));
  const result = plan(rootDir, ['src/new.ts', '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /evidenceCheckIds/);
});
