import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectPluginEvidence,
  getPlugin,
  listPlugins,
  loadPluginsFromConfig,
  registerPlugin,
} from '../src/index.mjs';
import npmAuditPlugin from '../examples/plugins/npm-audit.mjs';
import { repoRootDir } from './helpers.mjs';

function plugin(name = `test-plugin-${Date.now()}`) {
  return {
    name,
    version: '1.0.0',
    author: { name: 'Test Author' },
    claimTypes: [{ id: `${name}-claim`, displayName: 'Test claim', description: 'test', defaultImpact: 'medium' }],
    importEvidence(rawOutput, claims, context) {
      if (!rawOutput) return [];
      return claims.map((claim) => ({
        id: `${context.runId}.${claim.id}.evidence`,
        claimId: claim.id,
        evidenceType: 'policy_rule',
        method: 'validation',
        sourceRef: context.sourceRef,
        excerptOrSummary: rawOutput.trim(),
        observedAt: context.timestamp,
        passing: true,
      }));
    },
  };
}

test('registerPlugin adds and retrieves a plugin', () => {
  const item = plugin('registry-plugin');
  registerPlugin(item);
  assert.equal(getPlugin('registry-plugin'), item);
  assert.ok(listPlugins().some((registered) => registered.name === 'registry-plugin'));
});

test('collectPluginEvidence calls importEvidence for matching claim types and attaches attribution', () => {
  const item = { ...plugin('collector-plugin'), _inputFile: 'collector-output.txt' };
  registerPlugin(item);
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-plugin-collector-'));
  writeFileSync(join(rootDir, 'collector-output.txt'), 'collector passed\n');
  const evidence = collectPluginEvidence({
    claims: [{
      id: 'claim.collector',
      claimType: 'collector-plugin-claim',
    }],
  }, {
    rootDir,
    runId: 'plugin-run',
    sourceRef: 'abc123',
    timestamp: '2026-05-19T00:00:00.000Z',
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].excerptOrSummary, 'collector passed');
  assert.equal(evidence[0].metadata._plugin.name, 'collector-plugin');
  assert.equal(evidence[0].metadata._plugin.author.name, 'Test Author');
});

test('collectPluginEvidence skips plugins with no matching claims and missing input files', () => {
  registerPlugin({ ...plugin('skip-plugin'), _inputFile: 'missing-output.txt' });
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-plugin-skip-'));
  const noMatch = collectPluginEvidence({ claims: [{ id: 'claim.other', claimType: 'other' }] }, {
    rootDir,
    runId: 'plugin-run',
    timestamp: '2026-05-19T00:00:00.000Z',
  });
  const missingInput = collectPluginEvidence({ claims: [{ id: 'claim.skip', claimType: 'skip-plugin-claim' }] }, {
    rootDir,
    runId: 'plugin-run',
    timestamp: '2026-05-19T00:00:00.000Z',
  });
  assert.deepEqual(noMatch, []);
  assert.deepEqual(missingInput, []);
});

test('loadPluginsFromConfig imports repo-relative plugin modules', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-plugin-load-'));
  writeFileSync(join(rootDir, 'plugin.mjs'), 'export default { name: "loaded-plugin", version: "1.0.0", author: { name: "Loader" }, claimTypes: [], importEvidence() { return []; } };\n');
  await loadPluginsFromConfig({ plugins: [{ package: './plugin.mjs', inputFile: 'tool.json' }] }, rootDir);
  assert.equal(getPlugin('loaded-plugin')._inputFile, 'tool.json');
});

test('reference npm-audit plugin scaffolds claims and imports evidence', () => {
  const claims = npmAuditPlugin.scaffoldClaims('demo-repo');
  assert.equal(claims[0].claimType, 'package-version-safety');
  const evidence = npmAuditPlugin.importEvidence(JSON.stringify({
    vulnerabilities: {
      lodash: { severity: 'high' },
      minimist: { severity: 'moderate' },
    },
  }), claims, {
    rootDir: process.cwd(),
    runId: 'npm-audit-run',
    sourceRef: 'abc123',
    timestamp: '2026-05-19T00:00:00.000Z',
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].passing, false);
  assert.match(evidence[0].excerptOrSummary, /1 high/);
});

test('veritas plugin list and claim scaffold use configured plugins', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-plugin-cli-'));
  mkdirSync(join(rootDir, '.veritas'), { recursive: true });
  writeFileSync(join(rootDir, 'plugin.mjs'), `
export default {
  name: 'cli-plugin',
  version: '1.0.0',
  author: { name: 'CLI Author' },
  claimTypes: [{ id: 'cli-claim', displayName: 'CLI claim', description: 'CLI', defaultImpact: 'medium' }],
  importEvidence() { return []; },
  scaffoldClaims(repoName) {
    const now = '2026-05-19T00:00:00.000Z';
    return [{ id: repoName + '.cli-claim', facet: 'cli.surface', claimType: 'cli-claim', fieldOrBehavior: 'cli check', subjectType: 'repository', subjectId: repoName, impactLevel: 'medium', createdAt: now, updatedAt: now }];
  },
  policyTemplates: { 'cli.policy': { claimType: 'cli-claim', requiredEvidence: ['policy_rule'], requiredMethods: ['validation'], requiresCorroboration: false, reviewAuthority: 'plugin', validityRule: { kind: 'manual' }, stalenessTriggers: [], conflictRules: [], impactLevel: 'medium' } },
};
`);
  writeFileSync(join(rootDir, '.veritas/repo-map.json'), JSON.stringify({
    name: 'cli-repo',
    plugins: [{ package: './plugin.mjs' }],
  }, null, 2));
  const list = execFileSync('node', [join(repoRootDir, 'bin/veritas.mjs'), 'plugin', 'list'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.match(list, /cli-plugin@1\.0\.0/);
  const scaffold = execFileSync('node', [join(repoRootDir, 'bin/veritas.mjs'), 'claim', 'scaffold', '--plugin', 'cli-plugin'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  assert.match(scaffold, /Scaffolded 1 claim/);
  const store = JSON.parse(readFileSync(join(rootDir, 'veritas.claims.json'), 'utf8'));
  assert.equal(store.claims[0].id, 'cli-repo.cli-claim');
});
