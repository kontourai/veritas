/**
 * Veritas ships 16 JSON Schemas. Until this change no runtime code loaded any of them
 * (`grep -rn "schemas/" src/` returned nothing), so a config could be structurally wrong
 * against its own published schema and Veritas would evaluate it silently (veritas#196).
 *
 * The cross-file `$ref` cases below are the important ones: an unexercised cross-file ref
 * is exactly the failure mode where a validator resolves to nothing and every subsequent
 * "validation" is a no-op that passes everything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  REPO_MAP_SCHEMA,
  REPO_STANDARDS_SCHEMA,
  getSchemaValidator,
  listShippedSchemaFiles,
  loadRepoMap,
  loadRepoStandards,
  validateAgainstSchema,
  validateRepoConfig,
} from '../src/index.mjs';
import { buildStarterRepoMap, buildStarterRepoStandards } from '../src/bootstrap/starter-artifacts.mjs';
import { repoRootDir } from './helpers.mjs';

function readRepoJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRootDir, relativePath), 'utf8'));
}

function withCapturedStderr(fn) {
  const chunks = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    return { result: fn(), stderr: chunks.join('') };
  } finally {
    process.stderr.write = original;
  }
}

function writeConfigFixture(prefix, { repoMap, repoStandards }) {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(rootDir, '.veritas/repo-standards'), { recursive: true });
  if (repoMap) {
    writeFileSync(join(rootDir, '.veritas/repo-map.json'), `${JSON.stringify(repoMap, null, 2)}\n`);
  }
  if (repoStandards) {
    writeFileSync(
      join(rootDir, '.veritas/repo-standards/default.repo-standards.json'),
      `${JSON.stringify(repoStandards, null, 2)}\n`,
    );
  }
  return rootDir;
}

/** The exact drift shape observed in a downstream consumer: `stage` instead of `enforcementLevel`. */
function driftedRepoStandards() {
  return {
    version: 1,
    name: 'drifted',
    rules: [
      {
        id: 'drifted-rule',
        kind: 'required-artifacts',
        classification: 'hard-invariant',
        stage: 'block',
        message: 'Drifted rule authored against a field the schema does not define.',
        match: { artifacts: ['docs/x.md'] },
      },
    ],
  };
}

test('every shipped schema compiles with its siblings registered', () => {
  const files = listShippedSchemaFiles();
  assert.ok(files.length >= 16, `expected the shipped schema set, got ${files.length}`);
  for (const file of files) {
    assert.doesNotThrow(() => getSchemaValidator(file), `${file} must compile`);
  }
});

test('cross-file $ref in the Repo Map schema resolves instead of passing everything', () => {
  const repoMap = readRepoJson('repo-maps/work-agent.repo-map.json');
  assert.equal(validateAgainstSchema(REPO_MAP_SCHEMA, repoMap).valid, true);

  // `resolverPrecedence` is required only by ./veritas-graph.schema.json. If that
  // cross-file ref were dead, this would still validate.
  delete repoMap.graph.resolverPrecedence;
  const result = validateAgainstSchema(REPO_MAP_SCHEMA, repoMap);
  assert.equal(result.valid, false, 'the ./veritas-graph.schema.json $ref is not being applied');
  assert.ok(result.errors.some((error) => error.includes('resolverPrecedence')), result.errors.join('\n'));
});

test('cross-file $ref in the standards feedback draft schema resolves', () => {
  const draft = {
    version: 1,
    run_id: 'run-1',
    authority_settings_id: 'authority-1',
    mode: 'draft',
    evidence: {},
    governance: {},
    reviewer_confidence_scale: [],
    prefilled_outcome: {},
    prefilled_measurements: {},
    notes: [],
    missing_confirmation_fields: [],
  };
  const result = validateAgainstSchema('veritas-standards-feedback-draft.schema.json', draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.startsWith('/evidence')),
    `the ./veritas-standards-feedback.schema.json $ref is not being applied: ${result.errors.join('\n')}`,
  );
});

test('cross-file $ref in the marker suite report schema resolves', () => {
  const report = {
    suite_id: 'suite-1',
    title: 'Suite',
    scenario_count: 1,
    pair_count: 1,
    metrics: {},
    benchmarks: [
      {
        benchmark_id: 'b1',
        title: 'B1',
        marker_class: 'class',
        repo_surface: 'surface',
        trial_count: 1,
        metrics: {},
        trials: [{ trial_id: 't1', comparison: {} }],
      },
    ],
  };
  const result = validateAgainstSchema('veritas-marker-suite-report.schema.json', report);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.startsWith('/benchmarks/0/trials/0/comparison')),
    `the ./veritas-marker-score.schema.json $ref is not being applied: ${result.errors.join('\n')}`,
  );
});

test('loadRepoStandards warns on schema-invalid config and still returns it', () => {
  const rootDir = writeConfigFixture('veritas-schema-warn-', { repoStandards: driftedRepoStandards() });
  const path = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');

  const { result, stderr } = withCapturedStderr(() => loadRepoStandards(path));

  assert.equal(result.rules[0].id, 'drifted-rule', 'loading must stay non-fatal by default');
  assert.match(stderr, /does not validate against veritas-repo-standards\.schema\.json/);
  assert.match(stderr, /must have required property 'enforcementLevel'/);
  assert.match(stderr, /must NOT have additional properties \(stage\)/);
  assert.match(stderr, /veritas readiness --check config/);
});

test('loadRepoStandards warns once per file rather than on every load', () => {
  const rootDir = writeConfigFixture('veritas-schema-dedupe-', { repoStandards: driftedRepoStandards() });
  const path = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');

  const { stderr } = withCapturedStderr(() => {
    loadRepoStandards(path);
    loadRepoStandards(path);
    loadRepoStandards(path);
  });

  const occurrences = stderr.split('does not validate against').length - 1;
  assert.equal(occurrences, 1, `expected one warning, got ${occurrences}`);
});

test('strict mode turns an invalid config into a load failure', () => {
  const rootDir = writeConfigFixture('veritas-schema-strict-', { repoStandards: driftedRepoStandards() });
  const path = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');

  assert.throws(
    () => loadRepoStandards(path, { strict: true }),
    /does not validate against veritas-repo-standards\.schema\.json/,
  );
});

test('a valid config loads without warning', () => {
  const rootDir = writeConfigFixture('veritas-schema-clean-', {
    repoStandards: readRepoJson('repo-standards/work-agent-convergence.repo-standards.json'),
    repoMap: readRepoJson('repo-maps/work-agent.repo-map.json'),
  });

  const { stderr } = withCapturedStderr(() => {
    loadRepoStandards(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'));
    loadRepoMap(join(rootDir, '.veritas/repo-map.json'));
  });

  assert.equal(stderr, '');
});

test('validateRepoConfig reports per-artifact status', () => {
  const rootDir = writeConfigFixture('veritas-schema-report-', {
    repoStandards: driftedRepoStandards(),
    repoMap: readRepoJson('repo-maps/work-agent.repo-map.json'),
  });

  const report = validateRepoConfig({
    rootDir,
    repoMapPath: join(rootDir, '.veritas/repo-map.json'),
    repoStandardsPath: join(rootDir, '.veritas/repo-standards/default.repo-standards.json'),
  });

  assert.equal(report.valid, false);
  const byLabel = Object.fromEntries(report.results.map((result) => [result.label, result]));
  assert.equal(byLabel['Repo Map'].status, 'valid');
  assert.equal(byLabel['Repo Standards'].status, 'invalid');
  assert.equal(byLabel['Repo Standards'].schema, REPO_STANDARDS_SCHEMA);
});

test('readiness --check config exits 1 on a drifted config and 0 on a clean one', () => {
  const driftedRoot = writeConfigFixture('veritas-standards-cli-bad-', {
    repoStandards: driftedRepoStandards(),
    repoMap: readRepoJson('repo-maps/work-agent.repo-map.json'),
  });
  const cleanRoot = writeConfigFixture('veritas-standards-cli-good-', {
    repoStandards: readRepoJson('repo-standards/work-agent-convergence.repo-standards.json'),
    repoMap: readRepoJson('repo-maps/work-agent.repo-map.json'),
  });
  const bin = join(repoRootDir, 'bin/veritas.mjs');

  const drifted = spawnSync(process.execPath, [bin, 'readiness', '--check', 'config', '--root', driftedRoot], {
    encoding: 'utf8',
  });
  assert.equal(drifted.status, 1, drifted.stdout + drifted.stderr);
  assert.match(drifted.stdout, /^FAIL Repo Standards/m);
  assert.match(drifted.stdout, /^PASS Repo Map/m);

  const clean = execFileSync(process.execPath, [bin, 'readiness', '--check', 'config', '--root', cleanRoot], {
    encoding: 'utf8',
  });
  assert.match(clean, /^PASS Repo Standards/m);
  assert.doesNotMatch(clean, /^FAIL/m);
});

test('readiness --check config --format json is machine readable', () => {
  const rootDir = writeConfigFixture('veritas-standards-cli-json-', {
    repoStandards: driftedRepoStandards(),
    repoMap: readRepoJson('repo-maps/work-agent.repo-map.json'),
  });
  const result = spawnSync(
    process.execPath,
    [join(repoRootDir, 'bin/veritas.mjs'), 'readiness', '--check', 'config', '--root', rootDir, '--format', 'json'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, false);
  const standards = report.results.find((entry) => entry.label === 'Repo Standards');
  assert.equal(standards.status, 'invalid');
  assert.ok(standards.errors.length > 0);
});

test("this repo's own tracked governance config validates against the shipped schemas", () => {
  // Veritas governs itself. Loading the schemas is only worth anything if the product's
  // own config passes the check it now performs on everyone else's.
  const report = validateRepoConfig({
    rootDir: repoRootDir,
    repoMapPath: join(repoRootDir, '.veritas/repo-map.json'),
    repoStandardsPath: join(repoRootDir, '.veritas/repo-standards/default.repo-standards.json'),
  });
  const failures = report.results
    .filter((result) => result.status === 'invalid')
    .map((result) => `${result.file}\n  ${result.errors.join('\n  ')}`);
  assert.deepEqual(failures, []);
});

test('the config `veritas init` generates validates against the shipped schemas', () => {
  // A warning that fires on the artifact Veritas itself just wrote would train every new
  // user to ignore it.
  const repoMap = buildStarterRepoMap({ projectName: 'starter-fixture', evidenceCheck: 'npm test' });
  const repoStandards = buildStarterRepoStandards({ projectName: 'starter-fixture' });

  const mapResult = validateAgainstSchema(REPO_MAP_SCHEMA, repoMap);
  assert.deepEqual(mapResult.errors, []);
  assert.equal(mapResult.valid, true);

  const standardsResult = validateAgainstSchema(REPO_STANDARDS_SCHEMA, repoStandards);
  assert.deepEqual(standardsResult.errors, []);
  assert.equal(standardsResult.valid, true);
});
