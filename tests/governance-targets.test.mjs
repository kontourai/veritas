import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { initCommittedRepo, mkdirp, readJsonFromAbsolute, repoRootDir } from './helpers.mjs';

// `apply governance-blocks` and the `ai-instruction-files-synced` readiness rule must agree on
// which AI instruction files carry the governance block (#292). Both commands run through the
// published bin against a repository `init` wrote, so the seam is the real CLI routing and the
// real readiness record, not the resolver alone.

const veritasBin = join(repoRootDir, 'bin/veritas.mjs');
const RULE_ID = 'ai-instruction-files-synced';

function runVeritas(rootDir, args) {
  const result = spawnSync('node', [veritasBin, ...args], { cwd: rootDir, encoding: 'utf8' });
  return result;
}

function initRepo(t, { mapTargets, ruleTargets, files = {} }) {
  const rootDir = initCommittedRepo(t, 'veritas-governance-targets-');
  const init = runVeritas(rootDir, ['init', '--non-interactive']);
  assert.equal(init.status, 0, init.stderr);

  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = readJsonFromAbsolute(repoMapPath);
  if (mapTargets === undefined) {
    delete repoMap.activation;
  } else {
    repoMap.activation = { aiInstructionFiles: mapTargets };
  }
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);

  const standardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const standards = readJsonFromAbsolute(standardsPath);
  standards.rules = ruleTargets === undefined
    ? standards.rules.filter((rule) => rule.id !== RULE_ID)
    : standards.rules.map((rule) => (rule.id === RULE_ID ? { ...rule, match: { 'governance-block': ruleTargets } } : rule));
  writeFileSync(standardsPath, `${JSON.stringify(standards, null, 2)}\n`);

  for (const [path, content] of Object.entries(files)) {
    mkdirp(join(rootDir, path, '..'));
    writeFileSync(join(rootDir, path), content);
  }
  return rootDir;
}

function readinessRuleResult(rootDir) {
  const run = runVeritas(rootDir, ['readiness', '--format', 'json', '--run-id', `targets-${Date.now()}`]);
  assert.ok(run.stdout.length > 0, `readiness printed nothing: ${run.stderr}`);
  const { reportArtifactPath } = JSON.parse(run.stdout);
  const report = readJsonFromAbsolute(join(rootDir, reportArtifactPath));
  return report.policy_results.find((result) => result.rule_id === RULE_ID) ?? null;
}

function applyBlocks(rootDir) {
  const run = runVeritas(rootDir, ['apply', 'governance-blocks']);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const AGENTS = { path: 'AGENTS.md', tool: 'codex', required: true };
const CURSOR = { path: '.cursorrules', tool: 'cursor', required: false };

test('an explicit empty aiInstructionFiles means no instruction files: apply writes nothing and says so', (t) => {
  // The shape `init` writes for a repository that has no instruction files.
  const rootDir = initRepo(t, { mapTargets: [], ruleTargets: [] });

  assert.equal(readinessRuleResult(rootDir).passed, true);
  const result = applyBlocks(rootDir);

  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped, []);
  assert.match(result.message, /list none\. Nothing was written\./);
  assert.equal(existsSync(join(rootDir, 'AGENTS.md')), false);
  assert.equal(existsSync(join(rootDir, 'CLAUDE.md')), false);
});

test('an explicit empty aiInstructionFiles is none even without a governance-block requirement', (t) => {
  const rootDir = initRepo(t, { mapTargets: [], ruleTargets: undefined });

  const result = applyBlocks(rootDir);

  assert.deepEqual(result.applied, []);
  assert.match(result.message, /Nothing was written\./);
  assert.equal(existsSync(join(rootDir, 'AGENTS.md')), false);
});

test('an empty governance-block requirement is none even without a Repo Map list', (t) => {
  const rootDir = initRepo(t, { mapTargets: undefined, ruleTargets: [] });

  const result = applyBlocks(rootDir);

  assert.deepEqual(result.applied, []);
  assert.match(result.message, /Nothing was written\./);
  assert.equal(existsSync(join(rootDir, 'CLAUDE.md')), false);
});

test('an explicit empty list leaves an existing instruction file without a block untouched', (t) => {
  const rootDir = initRepo(t, { mapTargets: [], ruleTargets: [], files: { 'AGENTS.md': '# Local guidance\n' } });

  const result = applyBlocks(rootDir);

  assert.deepEqual(result.applied, []);
  assert.equal(readFileSync(join(rootDir, 'AGENTS.md'), 'utf8'), '# Local guidance\n');
  assert.equal(existsSync(join(rootDir, 'CLAUDE.md')), false);
});

// Each case starts with no instruction files. Readiness reports a missing file for every target it
// requires, apply must create exactly those files, and readiness must pass afterwards.
const AGREEMENT_CASES = [
  {
    name: 'Repo Map lists a file the rule does not',
    mapTargets: [AGENTS],
    ruleTargets: [],
    expected: ['AGENTS.md'],
  },
  {
    name: 'rule lists a file an explicit empty Repo Map does not',
    mapTargets: [],
    ruleTargets: ['AGENTS.md'],
    expected: ['AGENTS.md'],
  },
  {
    name: 'a missing optional Repo Map target is neither required nor created',
    mapTargets: [AGENTS, CURSOR],
    ruleTargets: [],
    expected: ['AGENTS.md'],
  },
  {
    name: 'the starter selection, with both lists naming the same files',
    mapTargets: [AGENTS, { path: 'CLAUDE.md', tool: 'claude-code', required: true }],
    ruleTargets: ['AGENTS.md', 'CLAUDE.md'],
    expected: ['AGENTS.md', 'CLAUDE.md'],
  },
];

for (const { name, mapTargets, ruleTargets, expected } of AGREEMENT_CASES) {
  test(`apply writes the files readiness checks: ${name}`, (t) => {
    const rootDir = initRepo(t, { mapTargets, ruleTargets });

    const before = readinessRuleResult(rootDir);
    const required = before.findings
      .filter((finding) => finding.kind === 'missing-governance-file')
      .map((finding) => finding.artifact)
      .sort();
    assert.deepEqual(required, expected, 'readiness requires these files');

    const result = applyBlocks(rootDir);
    const created = result.applied.filter((entry) => entry.created).map((entry) => entry.path).sort();
    assert.deepEqual(created, expected, 'apply creates exactly the files readiness requires');
    assert.equal(result.message, undefined);

    assert.equal(readinessRuleResult(rootDir).passed, true, 'readiness passes after apply');
  });
}

test('readiness also checks an existing optional Repo Map target that apply would rewrite', (t) => {
  const stale = '<!-- veritas:governance-block:start -->\nstale\n<!-- veritas:governance-block:end -->\n';
  const rootDir = initRepo(t, { mapTargets: [CURSOR], ruleTargets: [], files: { '.cursorrules': stale } });

  const before = readinessRuleResult(rootDir);
  assert.deepEqual(
    before.findings.map(({ kind, artifact }) => ({ kind, artifact })),
    [{ kind: 'stale-governance-block', artifact: '.cursorrules' }],
  );

  const result = applyBlocks(rootDir);
  assert.deepEqual(result.applied.map((entry) => entry.path), ['.cursorrules']);
  assert.equal(readinessRuleResult(rootDir).passed, true);
});

test('with neither list configured, apply keeps the built-in default targets', (t) => {
  const rootDir = initRepo(t, { mapTargets: undefined, ruleTargets: undefined });

  assert.equal(readinessRuleResult(rootDir), null, 'no governance-block rule is evaluated');
  const result = applyBlocks(rootDir);

  assert.deepEqual(result.applied.map((entry) => entry.path).sort(), ['AGENTS.md', 'CLAUDE.md']);
});
