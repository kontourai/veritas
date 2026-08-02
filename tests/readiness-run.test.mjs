import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { writeBootstrapStarterKit } from '../src/bootstrap.mjs';
import { runMergeReadiness } from '../src/readiness/run.mjs';
import { runEvidenceCheckPlan } from '../src/readiness/evidence-check-runner.mjs';
import { buildRequiredEvidenceChecks } from '../src/report/evidence-checks.mjs';
import { buildEvidenceIntegrity } from '../src/report/integrity.mjs';
import { generateVeritasReport } from '../src/report/index.mjs';
import { buildFeedbackSummary } from '../src/report/format.mjs';
import { requiredEvidenceChecksFor } from '../src/surface/readiness.mjs';
import { readinessRuntimeEnvelope, runReadinessCheckCli } from '../src/cli/readiness-check.mjs';
import { commitAll, initCommittedRepo, parseCliJson, repoRootDir } from './helpers.mjs';

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
  assert.deepEqual(requiredEvidenceChecksFor(result.reportResult.record).map((check) => check.state), ['passed']);
  assert.equal(Object.hasOwn(result.reportResult.record, 'required_evidence_checks'), false);
  assert.equal(JSON.stringify(result.reportResult.record).includes('"timedOut"'), false);
  assert.equal(result.reportResult.record.run_id, 'readiness-run-test');
  assert.equal(result.draftResult.record.run_id, 'readiness-run-test');
  assert.equal(existsSync(join(rootDir, '.kontourai/veritas/runs/history.jsonl')), false);
  const evidenceSchema = JSON.parse(readFileSync(join(repoRootDir, 'schemas/veritas-evidence.schema.json'), 'utf8'));
  const validateEvidence = new Ajv({ strict: false, allErrors: true }).compile(evidenceSchema);
  assert.equal(validateEvidence(result.reportResult.record), true, JSON.stringify(validateEvidence.errors));
  const baseEvidenceSchema = JSON.parse(execFileSync(
    'git',
    ['show', 'origin/main:schemas/veritas-evidence.schema.json'],
    { cwd: repoRootDir, encoding: 'utf8' },
  ));
  const validateBaseEvidence = new Ajv({ strict: false, allErrors: true }).compile(baseEvidenceSchema);
  assert.equal(validateBaseEvidence(result.reportResult.record), false);
  assert.deepEqual(
    validateBaseEvidence.errors.map((error) => error.instancePath),
    ['/trust/bundle/schemaVersion'],
    'the exact base schema must reject only its known stale Surface schemaVersion constant',
  );
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
    assert.equal(result.evidenceCheckExecutionSkipped, true);
    assert.deepEqual(requiredEvidenceChecksFor(result.reportResult.record).map((check) => check.state), ['skipped']);
    assert.deepEqual(
      readinessRuntimeEnvelope(result.reportResult.record, result.currentStatus).requiredEvidenceChecks.map((check) => check.state),
      ['skipped'],
      `${label} must retain required-check state for the CLI JSON envelope`,
    );
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

test('readiness CLI JSON retains required evidence state when an embedded runtime performs no execution', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-cli-runtime-no-execution-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-cli-runtime-no-execution-fixture',
    evidenceCheck: 'npm test',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap Veritas');

  let stdout = '';
  const originalWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };
  try {
    await runReadinessCheckCli(
      ['--root', rootDir, '--working-tree', '--format', 'json'],
      { rootDir, readinessRuntime: { appendHistory: false, runEvidenceChecks: false } },
    );
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }

  const output = parseCliJson(stdout);
  assert.equal(output.evidenceCheckRan, false);
  assert.equal(output.readiness.status, 'fail');
  assert.equal(output.readiness.verdict, 'not-ready');
  assert.deepEqual(output.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]), [
    ['required-evidence-check', 'skipped'],
  ]);
  assert.match(output.readiness.remediation[0].message, /Required Evidence Check required-evidence-check is skipped/);
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
      [join(repoRootDir, 'bin/veritas.mjs'), 'readiness', '--root', rootDir, '--working-tree', '--skip-evidence-check', '--format', 'json'],
      { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' },
    ),
    (error) => {
      assert.equal(error.status, 1);
      const output = parseCliJson(error.stdout);
      assert.equal(output.readiness.status, 'fail');
      assert.equal(output.readiness.verdict, 'not-ready');
      assert.deepEqual(output.readiness.requiredEvidenceChecks.map((check) => [check.id, check.state]), [
        ['required-evidence-check', 'skipped'],
      ]);
      assert.match(output.readiness.remediation[0].message, /Required Evidence Check required-evidence-check is skipped/);
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
  assert.deepEqual(requiredEvidenceChecksFor(result.reportResult.record).map((check) => check.state), ['passed']);
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
      passed: true,
    }],
  });

  assert.deepEqual(required.map((check) => check.state), ['missing']);
});

test('execution uses a private immutable definition after caller mutation', async () => {
  const definition = {
    id: 'required-completion',
    command: 'node -e "process.exit(1)"',
    runner: 'bash',
    server: { command: 'original-server', args: ['original-arg'], env: { SECRET: 'original-secret' } },
    input: { token: 'original-input' },
    method: 'validation',
  };
  const outcome = await runEvidenceCheckPlan({
    evidenceChecks: [definition],
    requiredEvidenceCheckIds: [definition.id],
    rootDir: repoRootDir,
    runtime: {
      onEvidenceCheckOutput: () => {
        definition.command = 'node -e "process.exit(0)"';
        definition.server.args[0] = 'forged-arg';
        definition.server.env.SECRET = 'forged-secret';
        definition.input.token = 'forged-input';
      },
    },
  });

  assert.equal(definition.command, 'node -e "process.exit(0)"');
  assert.equal(definition.server.args[0], 'forged-arg');
  assert.equal(definition.server.env.SECRET, 'forged-secret');
  assert.equal(definition.input.token, 'forged-input');

  const required = buildRequiredEvidenceChecks({
    config: { evidence: { evidenceChecks: [definition], requiredEvidenceCheckIds: [definition.id] } },
    evidenceCheckPlan: { evidenceChecks: [definition] },
    evidenceCheckResults: outcome.evidenceCheckResults,
    evidenceCheckFailure: outcome.evidenceCheckFailure,
  });
  assert.deepEqual(required.map((check) => check.state), ['missing']);
});

test('repo-map integrity cannot distinguish low-entropy MCP secret candidates', () => {
  const integrityFor = (secret) => buildEvidenceIntegrity({
    rootDir: repoRootDir,
    normalizedFiles: [],
    sourceRef: 'test-source',
    sourceKind: 'explicit-files',
    sourceScope: ['explicit'],
    config: {
      name: 'redacted-integrity-fixture',
      evidence: {
        evidenceChecks: [{
          id: 'mcp-check',
          runner: 'mcp',
          server: { command: 'node', args: ['server.mjs', secret], env: { TOKEN: secret } },
          tool: 'scan',
          input: { token: secret },
          method: 'validation',
        }],
      },
    },
    repoStandards: { name: 'fixture' },
    options: {},
  }).configRefs.repoMap.hash;

  const candidates = ['alpha', 'bravo', 'charlie', 'delta'];
  assert.equal(new Set(candidates.map(integrityFor)).size, 1);
});

test('required evidence cannot be forged by reflective copies or callback mutation', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-private-association-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-private-association-fixture',
    evidenceCheck: 'node -e "process.exit(1)"',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap private association fixture');

  let observed = null;
  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-private-association-test', workingTree: true, force: true },
    { rootDir },
    [],
    {
      appendHistory: false,
      onEvidenceCheckOutput: (snapshot) => {
        observed = snapshot;
        assert.equal(Object.isFrozen(snapshot), true);
        assert.throws(() => { snapshot.passed = true; }, TypeError);
        assert.throws(() => { snapshot.extra = 'forged'; }, TypeError);
        throw new Error('diagnostic observer must not change readiness');
      },
    },
  );

  assert.ok(observed);
  assert.equal(result.evidenceCheckResults[0].passed, false);
  assert.equal(result.evidenceCheckFailure?.reason, 'failed');
  assert.equal(result.currentStatus, 'fail');

  const original = result.evidenceCheckResults[0];
  assert.deepEqual(Object.getOwnPropertySymbols(original), []);
  const symbolCopied = { ...original };
  for (const symbol of Object.getOwnPropertySymbols(original)) symbolCopied[symbol] = original[symbol];
  symbolCopied[Symbol('forged-execution-binding')] = true;
  const variants = [
    { ...original, passed: true, command: 'different definition' },
    structuredClone(original),
    JSON.parse(JSON.stringify(original)),
    symbolCopied,
    new Proxy({ ...original }, {}),
  ];
  const config = {
    evidence: {
      evidenceChecks: [{
        id: original.id,
        command: 'node -e "process.exit(0)"',
        method: 'validation',
      }],
      requiredEvidenceCheckIds: [original.id],
    },
  };
  for (const forgedResult of variants) {
    forgedResult.passed = true;
    const required = buildRequiredEvidenceChecks({
      config,
      evidenceCheckPlan: { evidenceChecks: config.evidence.evidenceChecks },
      evidenceCheckResults: [forgedResult],
    });
    assert.deepEqual(required.map((check) => check.state), ['missing']);
  }
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
  assert.deepEqual(requiredEvidenceChecksFor(result.reportResult.record).map((check) => check.state), ['timedout']);
  assert.deepEqual(result.evidenceCheckFailure, {
    phase: 'evidence-check',
    reason: 'timeout',
    id: result.evidenceCheckResults[0].id,
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

  assert.equal(result.currentStatus, 'fail');
  assert.equal(result.evidenceCheckResults.length, 1);
  assert.equal(result.evidenceCheckResults[0].timedOut, true);
  assert.deepEqual(result.evidenceCheckFailure, {
    phase: 'evidence-check',
    reason: 'timeout',
    id: 'required-evidence-check',
    runner: 'mcp',
    label: 'mcp:required-evidence-check',
    message: 'MCP Evidence Check timed out after 50ms',
  });
  assert.deepEqual(requiredEvidenceChecksFor(result.reportResult.record).map((check) => check.state), ['timedout']);
  const serializedResult = JSON.stringify(result);
  const evidenceArtifact = readFileSync(join(rootDir, result.reportResult.artifactPath), 'utf8');
  for (const secret of ['server-env-secret-never-export', 'input-secret-never-export']) {
    assert.ok(!serializedResult.includes(secret));
    assert.ok(!evidenceArtifact.includes(secret));
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
      assert.doesNotMatch(error.stderr, /server-env-secret-never-export|input-secret-never-export/);
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
  assert.deepEqual(requiredEvidenceChecksFor(result.reportResult.record).map((check) => check.state), ['timedout', 'timedout']);
  assert.equal(result.currentStatus, 'fail');
});

test('MCP execution exports only structural diagnostics', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-mcp-redaction-');
  const serverPath = join(rootDir, 'mcp-server.mjs');
  const sdkRoot = resolve('node_modules/@modelcontextprotocol/sdk/dist/esm');
  writeFileSync(serverPath, `
import { Server } from '${pathToFileURL(join(sdkRoot, 'server/index.js')).href}';
import { StdioServerTransport } from '${pathToFileURL(join(sdkRoot, 'server/stdio.js')).href}';
import { CallToolRequestSchema } from '${pathToFileURL(join(sdkRoot, 'types.js')).href}';
const server = new Server({ name: 'veritas-readiness-redaction-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const raw = [process.argv[2], process.env.MCP_ENV_SECRET_KEY, request.params.arguments.nested_input_secret_key, request.params.arguments.nested.extra_value].join('|');
  const payload = [raw, Buffer.from(raw).toString('base64'), Buffer.from(raw).toString('hex'), [...raw].reverse().join(''), raw + raw].join('|');
  process.stderr.write(payload.join('|') + '\\n');
  if (request.params.name === 'throw') throw new Error(payload.join('|'));
  return { content: [{ type: 'text', text: payload.join('|') }], isError: true };
});
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
  const serverArgsSecret = 'mcp-server-arg-secret';
  const environmentKey = 'MCP_ENV_SECRET_KEY';
  const environmentSecret = 'alpha';
  const nestedInputKey = 'nested_input_secret_key';
  const nestedInputSecret = 'input-secret-never-export';
  const nestedValue = 'nested-value-never-export';
  const sharedMcpDefinition = {
    runner: 'mcp',
    server: {
      command: process.execPath,
      args: [serverPath, serverArgsSecret],
      env: { [environmentKey]: environmentSecret },
    },
    input: { [nestedInputKey]: nestedInputSecret, nested: { extra_value: nestedValue } },
    method: 'validation',
    timeoutMs: 1_000,
  };
  repoMap.evidence.evidenceChecks = [
    { id: 'mcp-content', tool: 'content', ...sharedMcpDefinition },
    { id: 'mcp-error', tool: 'throw', ...sharedMcpDefinition },
  ];
  repoMap.evidence.requiredEvidenceCheckIds = ['mcp-content', 'mcp-error'];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);
  commitAll(rootDir, 'Bootstrap MCP redaction fixture');

  const result = await runMergeReadiness(
    { rootDir, runId: 'readiness-mcp-redaction-test', workingTree: true, force: true },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.deepEqual(result.evidenceCheckResults.map((check) => check.id), ['mcp-content', 'mcp-error']);
  assert.ok(result.evidenceCheckResults.every((check) => check.passed === false));
  assert.ok(result.evidenceCheckResults.every((check) => !Object.hasOwn(check, 'content')));
  const serializedResult = JSON.stringify(result);
  const directReport = await generateVeritasReport(
    { rootDir, runId: 'readiness-mcp-redaction-direct-report', workingTree: true, force: true },
    { rootDir },
    [],
  );
  const directReportSerialized = JSON.stringify(directReport);
  assert.doesNotMatch(serializedResult, /definition_digest|definition_identity/);
  const evidenceArtifact = readFileSync(join(rootDir, result.reportResult.artifactPath), 'utf8');
  const raw = [serverArgsSecret, environmentSecret, nestedInputSecret, nestedValue].join('|');
  const forbidden = [
    serverArgsSecret,
    environmentKey,
    environmentSecret,
    nestedInputKey,
    nestedInputSecret,
    nestedValue,
    Buffer.from(raw).toString('base64'),
    Buffer.from(raw).toString('hex'),
    [...raw].reverse().join(''),
    raw + raw,
  ];
  for (const secret of forbidden) {
    assert.ok(!serializedResult.includes(secret), `run result leaked ${secret}`);
    assert.ok(!directReportSerialized.includes(secret), `generateVeritasReport leaked ${secret}`);
    assert.ok(!evidenceArtifact.includes(secret), `evidence artifact leaked ${secret}`);
  }
  assert.ok(!['alpha', 'bravo', 'charlie', 'delta'].some((candidate) => serializedResult.includes(candidate)));
  assert.throws(
    () => execFileSync(
      process.execPath,
      [join(repoRootDir, 'bin/veritas.mjs'), 'readiness', '--root', rootDir, '--working-tree', '--format', 'json'],
      { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' },
    ),
    (error) => {
      assert.equal(error.status, 1);
      const cliOutput = `${error.stdout}${error.stderr}`;
      for (const secret of forbidden) assert.ok(!cliOutput.includes(secret), `CLI leaked ${secret}`);
      return true;
    },
  );
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
