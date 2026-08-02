import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { writeBootstrapStarterKit } from '../src/bootstrap.mjs';
import { evidenceCheckDefinitionDigest } from '../src/evidence/index.mjs';
import { runMergeReadiness } from '../src/readiness/run.mjs';
import { buildRequiredEvidenceChecks } from '../src/report/evidence-checks.mjs';
import { buildFeedbackSummary } from '../src/report/format.mjs';
import { commitAll, initCommittedRepo, repoRootDir } from './helpers.mjs';

test('Merge Readiness run coordinates evidence, report, and draft behind one interface', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-run-fixture',
    evidenceCheck: 'npm test',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap Veritas');

  const result = await runMergeReadiness(
    {
      rootDir,
      runId: 'readiness-run-test',
      workingTree: true,
      force: true,
    },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.equal(result.currentStatus, 'pass');
  assert.deepEqual(result.evidenceCheckLabels, ['npm test']);
  assert.equal(result.evidenceCheckResults[0].passed, true);
  assert.deepEqual(result.reportResult.record.required_evidence_checks.map((check) => check.state), ['passed']);
  assert.equal(result.reportResult.record.run_id, 'readiness-run-test');
  assert.equal(result.draftResult.record.run_id, 'readiness-run-test');
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/runs/history.jsonl')), false);
  const evidenceSchema = JSON.parse(readFileSync(join(repoRootDir, 'schemas/veritas-evidence.schema.json'), 'utf8'));
  const validateEvidence = new Ajv({ strict: false, allErrors: true }).compile(evidenceSchema);
  assert.equal(validateEvidence(result.reportResult.record), true, JSON.stringify(validateEvidence.errors));
  const recordWithUnexpectedRuntimeField = structuredClone(result.reportResult.record);
  recordWithUnexpectedRuntimeField.selected_evidence_checks[0].evidence_check_result.unexpected_runtime_field = true;
  assert.equal(validateEvidence(recordWithUnexpectedRuntimeField), false);
  assert.ok(validateEvidence.errors.some((error) => error.keyword === 'additionalProperties'));
});

test('skipped or no-execution required evidence is diagnostic-only and rejects canonical readiness', async () => {
  for (const [label, rawOptions, runtime] of [
    ['skip flag', { skipEvidenceCheck: true }, {}],
    ['runtime no-execution', {}, { runEvidenceChecks: false }],
  ]) {
    const testId = label.replaceAll(' ', '-');
    const rootDir = initCommittedRepo(`veritas-readiness-${testId}-`);
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "process.exit(0)"' },
    }, null, 2));
    writeBootstrapStarterKit({
      rootDir,
      projectName: `readiness-${label}-fixture`,
      evidenceCheck: 'npm test',
      force: true,
    });
    commitAll(rootDir, `Bootstrap ${label} fixture`);

    const result = await runMergeReadiness(
      { rootDir, runId: `readiness-${testId}-test`, workingTree: true, force: true, ...rawOptions },
      { rootDir },
      [],
      { appendHistory: false, ...runtime },
    );

    assert.equal(result.currentStatus, 'fail', `${label} must not pass canonical readiness`);
    assert.deepEqual(result.reportResult.record.required_evidence_checks.map((check) => check.state), ['skipped']);
    const readinessClaim = result.reportResult.record.trust.bundle.claims.find(
      (claim) => claim.claimType === 'software-readiness-verdict',
    );
    assert.ok(readinessClaim);
    assert.equal(readinessClaim.value.verdict, 'not-ready');
    assert.equal(readinessClaim.status, 'rejected');
    const readinessReportClaim = result.reportResult.record.trust.report.claims.find(
      (claim) => claim.id === readinessClaim.id,
    );
    assert.equal(readinessReportClaim.status, 'rejected');
    const readinessEvidence = result.reportResult.record.trust.bundle.evidence.find(
      (evidence) => evidence.claimId === readinessClaim.id,
    );
    assert.ok(readinessEvidence.metadata.evidenceChecks.required.some((check) => check.state === 'skipped'));
    assert.ok(readinessEvidence.metadata.transparencyGapHints.some((gap) => gap.blocking && gap.message.includes('skipped')));
    assert.ok(
      result.reportResult.record.trust.report.transparencyGapsByClaimId[readinessClaim.id]
        .some((gap) => gap.message.includes('skipped')),
    );
    const { validateTrustBundleSchema } = await import('../src/surface/trust-bundle-validator.mjs');
    const validation = validateTrustBundleSchema(result.reportResult.record.trust.bundle);
    assert.equal(validation.valid, true, `${label} trust bundle must remain Hachure-valid`);
  }
});

test('readiness CLI returns failure for skipped required evidence while retaining its diagnostic report', () => {
  const rootDir = initCommittedRepo('veritas-readiness-cli-skip-required-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-cli-skip-required-fixture',
    evidenceCheck: 'npm test',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap Veritas');

  assert.throws(
    () => execFileSync(
      process.execPath,
      [join(repoRootDir, 'bin/veritas.mjs'), 'readiness', '--root', rootDir, '--working-tree', '--skip-evidence-check'],
      { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' },
    ),
    (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stdout, /FAIL\s+required-evidence-check:required-evidence-check: skipped/);
      assert.match(error.stdout, /report: \.kontourai\/veritas\/evidence\//);
      return true;
    },
  );
});

test('a failed optional diagnostic cannot block or prevent required Evidence Checks from running', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-optional-diagnostic-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-optional-diagnostic-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks = [
    { id: 'optional-diagnostic', command: 'node -e "process.exit(17)"', method: 'validation' },
    { id: 'required-completion', command: 'node -e "process.exit(0)"', method: 'validation' },
  ];
  repoMap.evidence.defaultEvidenceCheckIds = ['optional-diagnostic'];
  repoMap.evidence.requiredEvidenceCheckIds = ['required-completion'];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap optional diagnostic fixture');

  const result = await runMergeReadiness(
    { rootDir, runId: 'optional-diagnostic-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.deepEqual(result.evidenceCheckPlan.evidenceChecks.map((check) => check.id), ['optional-diagnostic', 'required-completion']);
  assert.deepEqual(result.evidenceCheckResults.map((check) => check.id), ['required-completion', 'optional-diagnostic']);
  assert.equal(result.evidenceCheckResults[1].passed, false);
  assert.equal(result.evidenceCheckFailure, null);
  assert.deepEqual(result.reportResult.record.required_evidence_checks.map((check) => check.state), ['passed']);
  assert.equal(result.currentStatus, 'pass');
  assert.match(buildFeedbackSummary({
    record: result.reportResult.record,
    evidenceCheckRan: true,
    evidenceCheckResults: result.evidenceCheckResults,
  }), /WARN  evidence-check: node -e "process.exit\(17\)"/);
  const readinessClaim = result.reportResult.record.trust.bundle.claims.find(
    (claim) => claim.claimType === 'software-readiness-verdict',
  );
  assert.equal(readinessClaim.status, 'verified');
});

test('feedback counts a required evidence failure once', () => {
  const feedback = buildFeedbackSummary({
    evidenceCheckRan: true,
    evidenceCheckFailure: {
      id: 'required-completion',
      label: 'node -e "process.exit(1)"',
      message: 'Evidence Check command failed with exit code 1',
    },
    record: {
      files: [],
      components: [],
      policy_results: [],
      required_evidence_checks: [
        { id: 'required-completion', label: 'node -e "process.exit(1)"', state: 'failed' },
      ],
    },
  });

  assert.match(feedback, /1 failure/);
  assert.doesNotMatch(feedback, /FAIL  evidence-check:/);
  assert.match(feedback, /FAIL  required-evidence-check:required-completion: failed/);
});

test('required evidence result association rejects the same ID with a different definition', () => {
  const config = {
    evidence: {
      evidenceChecks: [{
        id: 'required-completion',
        command: 'node -e "process.exit(0)"',
        method: 'validation',
      }],
      requiredEvidenceCheckIds: ['required-completion'],
    },
  };
  const required = buildRequiredEvidenceChecks({
    config,
    evidenceCheckPlan: { evidenceChecks: config.evidence.evidenceChecks },
    evidenceCheckResults: [{
      id: 'required-completion',
      definition_digest: '1'.repeat(64),
      passed: true,
    }],
  });

  assert.deepEqual(required.map((check) => check.state), ['missing']);
});

test('Merge Readiness reports a typed evidence-check timeout and phase progress', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-timeout-');
  const markerPath = join(rootDir, 'descendant-ran');
  const childScriptPath = join(rootDir, 'descendant.mjs');
  writeFileSync(
    childScriptPath,
    "import { writeFileSync } from 'node:fs'; setTimeout(() => writeFileSync(process.argv[2], 'ran'), 300);\n",
  );
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-timeout-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks[0] = {
    ...repoMap.evidence.evidenceChecks[0],
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(childScriptPath)} ${JSON.stringify(markerPath)} & wait`,
    timeoutMs: 50,
  };
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap Veritas timeout fixture');

  const phases = [];
  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-timeout-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false, onReadinessPhase: (phase) => phases.push(phase) },
  );

  assert.equal(result.currentStatus, 'fail');
  assert.equal(result.evidenceCheckResults[0].timedOut, true);
  assert.equal(result.evidenceCheckResults[0].passed, false);
  assert.deepEqual(result.reportResult.record.required_evidence_checks.map((check) => check.state), ['timedout']);
  assert.deepEqual(result.evidenceCheckFailure, {
    phase: 'evidence-check',
    reason: 'timeout',
    id: result.evidenceCheckResults[0].id,
    definition_digest: result.evidenceCheckResults[0].definition_digest,
    runner: 'bash',
    label: result.evidenceCheckResults[0].label,
    message: 'Evidence Check command timed out after 50ms',
    stdout: '',
    stderr: '',
    exitCode: null,
  });
  assert.deepEqual(phases.map((phase) => phase.phase), [
    'scope-resolution', 'evidence-check', 'report', 'finalization', 'complete',
  ]);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(existsSync(markerPath), false, 'timed-out evidence check descendant must not continue');
});

test('Merge Readiness reports a typed MCP evidence-check timeout and phase progress', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-mcp-timeout-');
  const serverPath = join(rootDir, 'mcp-server.mjs');
  const sdkRoot = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  writeFileSync(serverPath, `
import { Server } from '${pathToFileURL(join(sdkRoot, 'server/index.js')).href}';
import { StdioServerTransport } from '${pathToFileURL(join(sdkRoot, 'server/stdio.js')).href}';
import { CallToolRequestSchema } from '${pathToFileURL(join(sdkRoot, 'types.js')).href}';

const server = new Server({ name: 'veritas-readiness-timeout-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(CallToolRequestSchema, async () => new Promise(() => {}));
await server.connect(new StdioServerTransport());
`);
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-mcp-timeout-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks[0] = {
    ...repoMap.evidence.evidenceChecks[0],
    runner: 'mcp',
    server: {
      command: process.execPath,
      args: [serverPath],
      env: { MCP_SECRET: 'server-env-secret-never-export' },
    },
    tool: 'scan',
    input: { api_key: 'input-secret-never-export' },
    timeoutMs: 50,
  };
  delete repoMap.evidence.evidenceChecks[0].command;
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap Veritas MCP timeout fixture');

  const phases = [];
  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-mcp-timeout-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false, onReadinessPhase: (phase) => phases.push(phase) },
  );

  const evidenceCheck = repoMap.evidence.evidenceChecks[0];
  assert.equal(result.currentStatus, 'fail');
  assert.equal(result.evidenceCheckResults.length, 1);
  assert.equal(result.evidenceCheckResults[0].timedOut, true);
  assert.deepEqual(result.evidenceCheckFailure, {
    phase: 'evidence-check',
    reason: 'timeout',
    id: evidenceCheck.id,
    definition_digest: evidenceCheckDefinitionDigest(evidenceCheck),
    runner: 'mcp',
    label: `scan@${process.execPath}`,
    message: 'MCP Evidence Check timed out after 50ms',
  });
  assert.deepEqual(result.reportResult.record.required_evidence_checks.map((check) => check.state), ['timedout']);
  assert.match(result.evidenceCheckFailure.definition_digest, /^[a-f0-9]{64}$/);
  const serializedResult = JSON.stringify(result);
  const evidenceArtifact = readFileSync(join(rootDir, result.reportResult.artifactPath), 'utf8');
  for (const secret of ['server-env-secret-never-export', 'input-secret-never-export']) {
    assert.doesNotMatch(serializedResult, new RegExp(secret));
    assert.doesNotMatch(evidenceArtifact, new RegExp(secret));
  }
  assert.throws(
    () => execFileSync(
      process.execPath,
      [join(repoRootDir, 'bin/veritas.mjs'), 'readiness', '--root', rootDir, '--working-tree', '--format', 'json'],
      { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' },
    ),
    (error) => {
      assert.equal(error.status, 1);
      assert.doesNotMatch(error.stdout, /server-env-secret-never-export|input-secret-never-export/);
      return true;
    },
  );
  assert.deepEqual(phases.map((phase) => phase.phase), [
    'scope-resolution', 'evidence-check', 'report', 'finalization', 'complete',
  ]);
});

test('Merge Readiness records every required MCP timeout', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-multi-mcp-timeout-');
  const serverPath = join(rootDir, 'mcp-server.mjs');
  const sdkRoot = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  writeFileSync(serverPath, `
import { Server } from '${pathToFileURL(join(sdkRoot, 'server/index.js')).href}';
import { StdioServerTransport } from '${pathToFileURL(join(sdkRoot, 'server/stdio.js')).href}';
import { CallToolRequestSchema } from '${pathToFileURL(join(sdkRoot, 'types.js')).href}';
const server = new Server({ name: 'veritas-readiness-multi-timeout-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(CallToolRequestSchema, async () => new Promise(() => {}));
await server.connect(new StdioServerTransport());
`);
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-multi-timeout-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks = [
    {
      id: 'required-timeout-one', runner: 'mcp', server: { command: process.execPath, args: [serverPath, 'one'] }, tool: 'scan', input: {}, method: 'validation', timeoutMs: 50,
    },
    {
      id: 'required-timeout-two', runner: 'mcp', server: { command: process.execPath, args: [serverPath, 'two'] }, tool: 'scan', input: {}, method: 'validation', timeoutMs: 50,
    },
  ];
  repoMap.evidence.requiredEvidenceCheckIds = ['required-timeout-one', 'required-timeout-two'];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap required multi-timeout fixture');

  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-multi-timeout-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.deepEqual(result.evidenceCheckResults.map((check) => check.id), ['required-timeout-one', 'required-timeout-two']);
  assert.deepEqual(result.evidenceCheckResults.map((check) => check.timedOut), [true, true]);
  assert.equal(result.evidenceCheckFailure.id, 'required-timeout-one');
  assert.deepEqual(result.reportResult.record.required_evidence_checks.map((check) => check.state), ['timedout', 'timedout']);
  assert.equal(result.currentStatus, 'fail');
});

test('MCP result content redacts configured server and input secrets', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-mcp-redaction-');
  const serverPath = join(rootDir, 'mcp-server.mjs');
  const sdkRoot = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  writeFileSync(serverPath, `
import { Server } from '${pathToFileURL(join(sdkRoot, 'server/index.js')).href}';
import { StdioServerTransport } from '${pathToFileURL(join(sdkRoot, 'server/stdio.js')).href}';
import { CallToolRequestSchema } from '${pathToFileURL(join(sdkRoot, 'types.js')).href}';
const server = new Server({ name: 'veritas-readiness-redaction-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: process.env.MCP_SECRET + ':' + request.params.arguments.api_key }],
  isError: true,
}));
await server.connect(new StdioServerTransport());
`);
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-mcp-redaction-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks[0] = {
    ...repoMap.evidence.evidenceChecks[0],
    runner: 'mcp',
    server: {
      command: process.execPath,
      args: [serverPath],
      env: { MCP_SECRET: 'server-output-secret-never-export' },
    },
    tool: 'scan',
    input: { api_key: 'input-output-secret-never-export' },
    timeoutMs: 1_000,
  };
  delete repoMap.evidence.evidenceChecks[0].command;
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap MCP redaction fixture');

  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-mcp-redaction-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.equal(result.evidenceCheckResults[0].passed, false);
  assert.equal(result.evidenceCheckResults[0].content[0].text, '[REDACTED]:[REDACTED]');
  const serializedResult = JSON.stringify(result);
  const evidenceArtifact = readFileSync(join(rootDir, result.reportResult.artifactPath), 'utf8');
  for (const secret of ['server-output-secret-never-export', 'input-output-secret-never-export']) {
    assert.doesNotMatch(serializedResult, new RegExp(secret));
    assert.doesNotMatch(evidenceArtifact, new RegExp(secret));
  }
});

test('Merge Readiness terminates a Flow Agents-shaped redirected descendant in diff scope', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-diff-scope-timeout-');
  const markerPath = join(rootDir, 'redirected-descendant-ran');
  const childScriptPath = join(rootDir, 'redirected-descendant.mjs');
  writeFileSync(
    childScriptPath,
    "import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); setTimeout(() => writeFileSync(process.argv[2], 'ran'), 700);\n",
  );
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-diff-scope-timeout-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = JSON.parse(readFileSync(repoMapPath, 'utf8'));
  repoMap.evidence.evidenceChecks[0] = {
    ...repoMap.evidence.evidenceChecks[0],
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(childScriptPath)} ${JSON.stringify(markerPath)} >/dev/null 2>&1 & wait`,
    timeoutMs: 100,
  };
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap diff-scoped timeout fixture');
  writeFileSync(join(rootDir, 'README.md'), '# changed scope\n');
  commitAll(rootDir, 'Change Flow Agents-shaped scoped input');

  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-diff-scope-timeout-test', changedFrom: 'HEAD~1', changedTo: 'HEAD', force: true },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.equal(result.currentStatus, 'fail');
  assert.equal(result.evidenceCheckFailure?.reason, 'timeout');
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(existsSync(markerPath), false, 'redirected descendant must not outlive diff-scoped readiness');
});

test('Merge Readiness bounds Git diff scope resolution by the workflow deadline', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-scope-resolution-timeout-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-scope-resolution-timeout-fixture',
    evidenceCheck: 'node -e "process.exit(0)"',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap scope timeout fixture');
  writeFileSync(join(rootDir, 'README.md'), '# changed scope\n');
  commitAll(rootDir, 'Add changed scope input');

  const fakeBin = join(rootDir, 'fake-bin');
  const fakeGit = join(fakeBin, 'git');
  mkdirSync(fakeBin);
  writeFileSync(fakeGit, '#!/bin/sh\nexec /bin/sleep 1\n');
  chmodSync(fakeGit, 0o755);

  const originalPath = process.env.PATH;
  const startedAt = Date.now();
  process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;
  try {
    await assert.rejects(
      runMergeReadiness(
        {
          rootDir,
          runId: 'readiness-scope-resolution-timeout-test',
          changedFrom: 'HEAD~1',
          changedTo: 'HEAD',
          force: true,
        },
        { rootDir },
        [],
        { appendHistory: false, workflowTimeoutMs: 50 },
      ),
      (error) => {
        assert.equal(error.code, 'VERITAS_READINESS_WORKFLOW_TIMEOUT');
        assert.equal(error.phase, 'scope-resolution');
        assert.equal(error.reason, 'timeout');
        return true;
      },
    );
  } finally {
    process.env.PATH = originalPath;
  }
  assert.ok(Date.now() - startedAt < 300, 'slow Git scope resolution must honor the workflow deadline');
});
