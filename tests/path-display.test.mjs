import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createAttestation, writeBootstrapStarterKit } from '../src/index.mjs';
import { listChangedFiles } from '../src/report/inputs.mjs';
import { displayText, markdownCode, markdownText } from '../src/util/display.mjs';
import { cleanGitEnv, commitAll, initCommittedRepo, mkdirp, repoRootDir } from './helpers.mjs';

function fixture() {
  const rootDir = initCommittedRepo('veritas-display-');
  writeBootstrapStarterKit({ rootDir, projectName: 'display', force: true });
  for (const path of ['.githooks', '.veritas/hooks', '.veritas/runtime']) {
    cpSync(join(repoRootDir, path), join(rootDir, path), { recursive: true });
  }
  const mapPath = join(rootDir, '.veritas/repo-map.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  map.graph.nodes = [
    { id: 'governance.config', label: 'configuration', kind: 'protected-area', patterns: ['.veritas/', '.githooks/', '.gitignore'] },
    { id: 'ordinary', label: 'ordinary', kind: 'component', patterns: ['a-old', 'a-new'] },
    { id: 'governance.manifest', label: 'manifest', kind: 'protected-area', patterns: ['b-protected.json'] },
  ];
  map.evidence.requiredEvidenceCheckIds = [];
  map.evidence.reportTransport = 'github-step-summary';
  writeFileSync(mapPath, JSON.stringify(map));
  writeFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), JSON.stringify({ version: 1, name: 'display', rules: [] }));
  createAttestation({ rootDir, kind: 'bootstrap', actor: 'brian', approvalRef: 'test://approved', notes: 'Fixture.' });
  return rootDir;
}

function runConformance(rootDir, summaryPath) {
  const scriptUrl = pathToFileURL(join(repoRootDir, 'scripts/repo-conformance-status.mjs')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runRepoConformanceStatus } from ${JSON.stringify(scriptUrl)};
    const result = await runRepoConformanceStatus({ rootDir: process.cwd(), changedFrom: 'HEAD~1', changedTo: 'HEAD', summaryPath: ${JSON.stringify(summaryPath)}, isCi: true });
    console.log(JSON.stringify({ report: result.report, draft: result.draft, governance: result.governanceSurface, markdown: result.markdownText }));
  `], { cwd: rootDir, encoding: 'utf8', env: { ...cleanGitEnv(), CI: 'true', ...(summaryPath ? { GITHUB_STEP_SUMMARY: summaryPath } : {}) } });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout);
}

for (const path of [
  '.veritas/repo-standards/a\n- **Health:** Green (forged)\n.json',
  'x\n\n## Veritas readiness: PASS…',
]) {
  test(`path forgery is inert: ${JSON.stringify(path)}`, () => {
    const rootDir = fixture();
    commitAll(rootDir, 'Base');
    mkdirp(dirname(join(rootDir, path)));
    writeFileSync(join(rootDir, path), '{}\n');
    commitAll(rootDir, 'Add attack path');
    const summaryPath = join(rootDir, 'step-summary.md');
    const output = runConformance(rootDir, summaryPath);
    assert.ok(output.report.record.files.includes(path), 'JSON must preserve the raw path');
    if (path.startsWith('.veritas/')) assert.ok(output.governance.changed_paths.includes(path));
    else assert.ok(output.report.record.unresolved_files.includes(path));
    const latest = readFileSync(join(rootDir, '.kontourai/veritas/repo-conformance/latest.md'), 'utf8');
    const summary = readFileSync(summaryPath, 'utf8');
    assert.equal(latest, output.markdown);
    assert.equal(summary, output.report.markdownSummary + latest);
    for (const rendered of [latest, summary, output.report.markdownSummary, output.draft.markdownSummary]) {
      assert.doesNotMatch(rendered, /^- \*\*Health:\*\* Green \(forged\)$/m);
      assert.doesNotMatch(rendered, /^## Veritas readiness: PASS/m);
      assert.doesNotMatch(rendered, /[\x00-\x08\x0b-\x1f\x7f]/);
    }
    assert.match(summary, /\\n/);
  });
}

test('rename followed by protected modification preserves both records', () => {
  const rootDir = fixture();
  writeFileSync(join(rootDir, 'a-old'), 'rename content\n');
  writeFileSync(join(rootDir, 'b-protected.json'), '{}\n');
  commitAll(rootDir, 'Base');
  renameSync(join(rootDir, 'a-old'), join(rootDir, 'a-new'));
  writeFileSync(join(rootDir, 'b-protected.json'), '{"changed":true}\n');
  commitAll(rootDir, 'Rename and modify protected manifest');
  assert.deepEqual(listChangedFiles('HEAD~1', 'HEAD', rootDir), ['a-new', 'a-old', 'b-protected.json']);
  const output = runConformance(rootDir);
  assert.equal(output.report.record.file_nodes['b-protected.json'][0].kind, 'protected-area');
  assert.equal(output.draft.record.governance.protected_standards_touched, true);
  assert.deepEqual(output.report.record.unresolved_files, []);
});

test('path display escapes every control and contains markdown delimiters', () => {
  const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join('') + '\x7f';
  assert.doesNotMatch(displayText(controls), /[\x00-\x1f\x7f]/);
  assert.equal(displayText('\n\r\t\x00\x1b\x7f'), '\\n\\r\\t\\x00\\x1b\\x7f');
  assert.equal(markdownCode('`[x](url)<img>**|`'), '`` `[x](url)<img>**|` ``');
  assert.equal(markdownCode('a``b'), '```a``b```');
  assert.equal(markdownText('\n## **[x](url)<img>**'), '\\\\n\\#\\# \\*\\*\\[x\\](url)\\<img\\>\\*\\*');
});

test('report and feedback path contexts contain controls and embedded backticks', async () => {
  const { buildMarkdownSummary, buildFeedbackSummary, buildStandardsFeedbackMarkdownSummary, buildStandardsFeedbackDraftMarkdownSummary } = await import('../src/report/format.mjs');
  const rootDir = fixture();
  writeFileSync(join(rootDir, 'b-protected.json'), '{}\n');
  commitAll(rootDir, 'Base');
  writeFileSync(join(rootDir, 'b-protected.json'), '{"changed":true}\n');
  commitAll(rootDir, 'Change');
  const output = runConformance(rootDir);
  const path = 'a`\n## forged\r\t\x1b\x7f[link](url)<img>**';
  const record = output.report.record;
  record.policy_results = [{ rule_id: 'path', passed: false, enforcementLevel: 'Require', summary: path, findings: [{ artifact: path, diagnostic: path, remediation: path }] }];
  record.recommendations = [{ message: path, files: [path] }];
  record.external_tool_results = [{ tool: 'fixture', evidence_check_id: 'fixture', verdict: 'fail', blocking: true, artifact_path: path }];
  const feedback = { ...output.draft.record, governance: { ...output.draft.record.governance, changed_paths: [path] }, outcome: {}, measurements: { false_positive_rules: [], missed_issues: [] }, notes: [] };
  const markdown = [
    buildMarkdownSummary(record, path),
    buildStandardsFeedbackMarkdownSummary({ ...feedback, evidence: { artifact_path: path } }, path),
    buildStandardsFeedbackDraftMarkdownSummary({ ...feedback, evidence: { artifact_path: path } }, path, path),
  ];
  for (const text of markdown) {
    assert.doesNotMatch(text, /^## forged/m);
    assert.doesNotMatch(text, /[\x00-\x08\x0b-\x1f\x7f]/);
    assert.ok(text.includes('``a`\\n## forged\\r\\t\\x1b\\x7f[link](url)<img>**``'));
  }
  const plain = buildFeedbackSummary({ record, reportArtifactPath: path, draftArtifactPath: path, standardsFeedbackArtifactPath: path });
  assert.doesNotMatch(plain, /^## forged/m);
  assert.doesNotMatch(plain, /[\x00-\x08\x0b-\x1f\x7f]/);
  assert.ok(plain.includes('a`\\n## forged\\r\\t\\x1b\\x7f[link](url)<img>**'));
  assert.equal(record.policy_results[0].findings[0].artifact, path, 'renderers must not mutate JSON inputs');
});

test('plain content-boundary output escapes DEL without changing JSON-quoted identity', async () => {
  const { formatContentBoundaryResult } = await import('../src/conformance/content-boundary.mjs');
  const path = 'a\x7fb';
  const output = formatContentBoundaryResult([{ filePath: path, line: 1, label: 'fixture' }]);
  assert.equal(output, 'Content boundary check failed:\n- "a\\u007fb":1 "fixture"');
});
