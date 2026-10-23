import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRepoStandards } from '../src/load.mjs';
import { evaluateRepoStandards } from '../src/rules/evaluate.mjs';
import { validateAgainstSchema } from '../src/schema-validation.mjs';
import { validateRepoConfig } from '../src/cli/config-check.mjs';
import { tempDir } from './temp-dir.mjs';
import { repoRootDir } from './helpers.mjs';

test('RepoStandards resource preserves legacy rule evaluation and raw authored identity', (t) => {
  const rootDir = tempDir(t, 'veritas-resource-');
  const path = join(rootDir, 'standards.json');
  const rule = { id: 'no-debug', kind: 'forbidden-pattern', classification: 'promotable-policy', enforcementLevel: 'Require', message: 'Remove debug output.', match: { files: ['target.js'], pattern: 'console.log' } };
  const legacy = { version: 1, name: 'hygiene', rules: [rule] };
  const resource = { apiVersion: 'veritas.kontour.ai/v1alpha1', kind: 'RepoStandards', metadata: { name: 'hygiene' }, spec: { requirements: legacy.rules } };
  writeFileSync(path, JSON.stringify(resource));
  writeFileSync(join(rootDir, 'target.js'), 'console.log("debug");');
  const loaded = loadRepoStandards(path, { strict: true });
  assert.deepEqual(loaded, legacy);
  const config = validateRepoConfig({ rootDir, repoMapPath: join(rootDir, 'absent-map.json'), repoStandardsPath: path });
  assert.equal(config.results[1].schema, 'veritas-repo-standards-resource.schema.json');
  assert.equal(config.results[1].status, 'valid');
  assert.equal(evaluateRepoStandards(loaded, { rootDir, changedFiles: ['target.js'] })[0].passed, false);
  assert.equal(loadRepoStandards(path, { includeRaw: true }).raw, readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...resource, apiVersion: 'veritas.kontour.ai/v99' }));
  assert.throws(() => loadRepoStandards(path), /must be equal to constant/);
  resource.status = { passed: true };
  assert.equal(validateAgainstSchema('veritas-repo-standards-resource.schema.json', resource).valid, false);
});

test('shipped hygiene resource is accepted by the published schema', () => {
  const resource = JSON.parse(readFileSync(join(repoRootDir, 'examples/code-hygiene/repo-standards.json')));
  const result = validateAgainstSchema('veritas-repo-standards-resource.schema.json', resource);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
