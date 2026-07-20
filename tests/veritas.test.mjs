import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  applyCiSnippet,
  applyCodexHook,
  applyGovernanceBlocks,
  applyGitHook,
  setupRepoHooks,
  inspectCodexHookTarget,
  inspectRuntimeIntegrationStatus,
  applyRuntimeHook,
  applyStopHook,
  applyPackageScripts,
  buildFeedbackSummary,
  buildEvidenceRecord,
  buildStandardsFeedbackDraft,
  buildStandardsFeedbackRecord,
  buildExplainText,
  buildGovernanceBlock,
  buildBaselineClaims,
  buildSuggestedCodexHookConfig,
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
  buildSuggestedCiSnippet,
  buildSuggestedPackageScripts,
  buildBootstrapStarterKitPlan,
  buildConformanceAlerts,
  compareMarkerBenchmarkRuns,
  classifyNodes,
  checkBoundaries,
  evaluateWorkAreaBoundaryRule,
  evaluateRepoStandards,
  feedbackStatusForPolicyResult,
  feedbackHasFailures,
  generateStandardsFeedbackRecord,
  generateStandardsFeedbackSummary,
  generateVeritasReport,
  generateMarkerBenchmarkComparison,
  generateMarkerBenchmarkSuiteReport,
  inferBootstrapRepoInsights,
  listWorkingTreeFiles,
  loadJson,
  loadRepoStandards,
  matchesPatterns,
  parseTokens,
  resolveEvidenceCheckCommands,
  resolveReportInputs,
  runVeritasReportCli,
  resolveWorkstream,
  writeBootstrapStarterKit,
} from '../src/index.mjs';
import { SURFACE_TRUST_POLICIES } from '../src/surface/policies.mjs';
import {
  repoRootDir,
  cleanGitEnv,
  execGitFixture,
  initCommittedRepo,
  installLocalVeritasBin,
  commitAll,
  mkdirp,
  parseCliJson,
  readJson,
  readJsonFromAbsolute,
  writeTempRepoMap,
  writeTempJson,
} from './helpers.mjs';

const testBinDir = mkdtempSync(join(tmpdir(), 'veritas-test-bin-'));
const realNpmPath = execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();

function executableBits(path) {
  return statSync(path).mode & 0o111;
}
writeFileSync(
  join(testBinDir, 'npm'),
  `#!/bin/sh
if [ "$1" = "exec" ] && [ "$2" = "--" ] && [ "$3" = "veritas" ]; then
  shift 3
  exec node ${JSON.stringify(join(repoRootDir, 'bin/veritas.mjs'))} "$@"
fi
exec ${JSON.stringify(realNpmPath)} "$@"
`,
  'utf8',
);
chmodSync(join(testBinDir, 'npm'), 0o755);
process.env.PATH = `${testBinDir}:${process.env.PATH}`;

function writeClaimStoreForRepoMap(rootDir, repoMap, repoStandards, options = {}) {
  const repoName = repoMap.name ?? 'repo';
  const evidenceCheckCommands = (repoMap.evidence?.evidenceChecks ?? []).map((lane) => lane.command).filter(Boolean);
  const { claims, policies } = buildBaselineClaims(repoName, {
    hasGovernance: options.hasGovernance ?? false,
    evidenceCheckCommands,
    workAreas: repoMap.graph?.nodes ?? [],
  });
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  for (const rule of repoStandards?.rules ?? []) {
    claims.push({
      id: `${repoName}.policy.${rule.id}`,
      facet: 'veritas.policy-results',
      claimType: 'veritas-policy-result',
      fieldOrBehavior: rule.id,
      subjectType: 'veritas-policy-rule',
      subjectId: `${repoStandards.name}:${rule.id}`,
      impactLevel: rule.enforcementLevel === 'Require' ? 'high' : 'medium',
      verificationPolicyId: SURFACE_TRUST_POLICIES.policyResult.id,
      metadata: { ruleId: rule.id },
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    });
    policyById.set(SURFACE_TRUST_POLICIES.policyResult.id, SURFACE_TRUST_POLICIES.policyResult);
  }
  for (const lane of repoMap.evidence?.evidenceChecks ?? []) {
    if (!lane.externalTool) continue;
    claims.push({
      id: `${repoName}.external-tool.${lane.externalTool.tool}.${lane.id}`,
      facet: 'veritas.external-tools',
      claimType: 'veritas-external-tool-result',
      fieldOrBehavior: lane.externalTool.tool,
      subjectType: 'external-tool-result',
      subjectId: `${repoName}:${lane.externalTool.tool}:${lane.id}`,
      impactLevel: lane.externalTool.blocking ? 'high' : 'medium',
      verificationPolicyId: SURFACE_TRUST_POLICIES.externalToolResult.id,
      metadata: { tool: lane.externalTool.tool, evidenceCheckId: lane.id },
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    });
    policyById.set(SURFACE_TRUST_POLICIES.externalToolResult.id, SURFACE_TRUST_POLICIES.externalToolResult);
  }
  for (const suiteId of options.evidenceInventoryIds ?? []) {
    claims.push({
      id: `${repoName}.evidence-inventory.${suiteId}`,
      facet: 'veritas.evidence-inventories',
      claimType: 'veritas-evidence-inventory',
      fieldOrBehavior: suiteId,
      subjectType: 'repo-evidence-inventory',
      subjectId: `${repoName}:${suiteId}`,
      impactLevel: 'medium',
      verificationPolicyId: SURFACE_TRUST_POLICIES.evidenceInventory.id,
      metadata: { suiteId },
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    });
    policyById.set(SURFACE_TRUST_POLICIES.evidenceInventory.id, SURFACE_TRUST_POLICIES.evidenceInventory);
  }
  if (options.readinessCoverage) {
    claims.push({
      id: `${repoName}.readiness-coverage`,
      facet: 'veritas.readiness-coverage',
      claimType: 'veritas-readiness-coverage',
      fieldOrBehavior: 'readiness coverage',
      subjectType: 'repo-readiness-coverage',
      subjectId: `${repoName}:readiness-coverage`,
      impactLevel: 'medium',
      verificationPolicyId: SURFACE_TRUST_POLICIES.readinessCoverage.id,
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    });
    policyById.set(SURFACE_TRUST_POLICIES.readinessCoverage.id, SURFACE_TRUST_POLICIES.readinessCoverage);
  }
  writeFileSync(join(rootDir, 'veritas.claims.json'), `${JSON.stringify({
    schemaVersion: 1,
    producer: 'veritas',
    claims,
    policies: [...policyById.values()],
  }, null, 2)}\n`);
}

function runLocalVeritas(args, options = {}) {
  return execFileSync(
    'node',
    [join(repoRootDir, 'bin/veritas.mjs'), ...args],
    { cwd: repoRootDir, encoding: 'utf8', ...options },
  );
}

async function generateReportCliResult(rootDir, runId, files = ['package.json']) {
  const result = await generateVeritasReport({ rootDir, runId, sourceRef: runId }, { rootDir }, files);
  return {
    artifactPath: result.artifactPath,
    markdownSummary: result.markdownSummary,
    ...result.record,
  };
}

test('loadJson adds artifact context to malformed JSON errors', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-load-json-'));
  const malformedPath = join(rootDir, 'broken-authority-settings.json');
  writeFileSync(malformedPath, '{invalid json}\n');

  assert.throws(
    () => loadJson(malformedPath, 'authority settings'),
    /Failed to load authority settings at .*broken-authority-settings\.json:/,
  );
});

test('parseTokens supports the shared CLI token types', () => {
  const { options, rest } = parseTokens(
    [
      '--root',
      '/tmp/demo',
      '--force',
      '--time-to-green-minutes',
      '7',
      '--accepted-without-major-rewrite',
      'false',
      '--missed-issue',
      'first',
      '--missed-issue',
      'second',
      'leftover.txt',
    ],
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--force': { type: 'flag', key: 'force' },
      '--time-to-green-minutes': { type: 'number', key: 'timeToGreenMinutes' },
      '--accepted-without-major-rewrite': {
        type: 'boolean-string',
        key: 'acceptedWithoutMajorRewrite',
      },
      '--missed-issue': { type: 'array', key: 'missedIssues' },
    },
    {
      defaults: {
        missedIssues: [],
      },
    },
  );

  assert.deepEqual(options, {
    rootDir: '/tmp/demo',
    force: true,
    timeToGreenMinutes: 7,
    acceptedWithoutMajorRewrite: false,
    missedIssues: ['first', 'second'],
  });
  assert.deepEqual(rest, ['leftover.txt']);
});

test('core classifies nodes and builds evidence from a Repo Map', async () => {
  const repoMap = readJson('../repo-maps/work-agent.repo-map.json');
  const repoStandards = loadRepoStandards(
    new URL('../repo-standards/work-agent-convergence.repo-standards.json', import.meta.url),
  );
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  writeClaimStoreForRepoMap(rootDir, repoMap, repoStandards);

  const classification = classifyNodes(
    ['package.json', '.github/workflows/ci.yml'],
    repoMap,
    rootDir,
  );
  assert.deepEqual(classification.affectedNodes, [
    'delivery.github',
    'governance.root-manifests',
  ]);

  const resolution = resolveWorkstream({}, repoMap, [
    'docs/plans/plan-entity-hierarchy.md',
  ]);
  assert.deepEqual(resolution.matchedArtifacts, ['docs/plans/**']);

  const explicitResolution = resolveWorkstream(
    { workstream: 'explicit-demo' },
    repoMap,
    ['package.json'],
  );
  assert.equal(explicitResolution.resolvedPhase, 'Phase 1 (Harden & Onboard)');
  assert.equal(explicitResolution.resolvedWorkstream, 'explicit-demo');

  const record = await buildEvidenceRecord({
    files: ['package.json'],
    options: { baselineCiFastStatus: 'failed' },
    config: repoMap,
    repoStandards,
    rootDir,
  });
  assert.equal(record.record_schema_version, 1);
  assert.equal(record.producer.record_schema_version, 1);
  assert.equal(record.baseline_ci_fast_passed, false);
  assert.equal(record.source_kind, 'explicit-files');
  assert.deepEqual(record.source_scope, ['explicit']);
  assert.equal(record.integrity.sourceRef, record.source_ref);
  assert.equal(record.integrity.fileRefs[0].path, 'package.json');
  assert.match(record.integrity.fileRefs[0].hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(record.integrity.configRefs.repoMap.hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(record.integrity.configRefs.repoStandards.hash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(record.selected_evidence_check_labels, ['npm run ci:fast']);
  assert.deepEqual(record.selected_evidence_check_ids, ['required-evidence-check']);
  assert.deepEqual(record.selected_evidence_checks.map((lane) => lane.command), ['npm run ci:fast']);
  assert.equal(record.evidence_check_resolution_source, 'required');
  assert.equal(record.repo_map.name, 'work-agent');
  assert.deepEqual(record.repo_standards, {
    name: 'work-agent-convergence',
    version: 1,
    rule_count: 4,
  });
  assert.equal(record.policy_results.length, 4);
  assert.equal(record.policy_results[0].rule_id, 'required-repo-artifacts');
  assert.equal(record.policy_results[0].implemented, true);
  assert.equal(record.policy_results[0].passed, false);
  assert.equal(record.trust.bundle.schemaVersion, 5);
  assert.equal(record.trust.bundle.source, `veritas:${record.run_id}`);
  assert.ok(record.trust.bundle.claims.some((claim) => claim.facet === 'veritas.affected-surface'));
  assert.ok(record.trust.bundle.claims.some((claim) => claim.facet === 'veritas.evidence-check'));
  assert.ok(record.trust.bundle.claims.some((claim) => claim.facet === 'veritas.policy-results'));
  assert.ok(record.trust.bundle.evidence.some((item) =>
    item.integrityRef === record.source_ref &&
    item.metadata.integrity?.fileRefs?.some((ref) => ref.path === 'package.json' && ref.hash)
  ));
  assert.equal(record.trust.bundle.transparencyGaps, undefined);
  assert.equal(record.trust.bundle.evidenceRequirementsByClaimId, undefined);
  assert.deepEqual(repoMap.policy, {
    defaultFalsePositiveReview: 'unknown',
    defaultPromotionCandidate: false,
    defaultExceptionAllowed: false,
  });

  const evaluatedRules = evaluateRepoStandards(repoStandards, { rootDir }, {
    ruleIds: ['required-repo-artifacts'],
  });
  assert.equal(evaluatedRules.length, 1);
  assert.equal(evaluatedRules[0].implemented, true);
  assert.equal(evaluatedRules[0].passed, false);
  assert.ok(
    evaluatedRules[0].findings.some(
      (finding) => finding.artifact === '.github/dependabot.yml',
    ),
  );
});

test('evidence records include native evidence inventory coverage when configured', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-evidence-inventory-'));
  mkdirp(join(rootDir, '.veritas/evidence-inventories'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  writeFileSync(
    join(rootDir, '.veritas/evidence-inventories/guardrails.json'),
    JSON.stringify(
      {
        version: 1,
        sourceEvidenceCheckId: 'legacy-guardrails',
        items: [
          {
            id: 'repo-governance',
            evidenceCheckId: 'required-evidence-check',
            destination: 'veritas-policy',
            owner: 'repo-core',
            defaultDisposition: 'required',
            currentBlockingStatus: 'required',
            recentCatchEvidence: 'active policy evaluation',
            regressionSeverity: 'high',
            falsePositiveRisk: 'low',
            replacementTestAvailable: 'none',
            expiryOrReviewTrigger: 'review when upstream policy fully covers this item',
            lastReviewed: '2026-04-26',
            evidenceBasis: 'migration evidenceCheck',
            rationale: 'Protects the repository trust contract.',
          },
          {
            id: 'refactor-tombstones',
            evidenceCheckId: 'legacy-guardrails',
            destination: 'retire-or-soften',
            defaultDisposition: 'retire',
            currentBlockingStatus: 'advisory',
            recentCatchEvidence: 'unknown',
            regressionSeverity: 'low',
            falsePositiveRisk: 'high',
            rationale: 'Preserves historical shape rather than behavior.',
          },
        ],
      },
      null,
      2,
    ),
  );

  const repoMap = {
    ...readJson('../repo-maps/work-agent.repo-map.json'),
    evidence: {
      ...readJson('../repo-maps/work-agent.repo-map.json').evidence,
      evidenceInventoryManifests: ['.veritas/evidence-inventories/guardrails.json'],
    },
  };
  const repoStandards = loadRepoStandards(
    new URL('../repo-standards/work-agent-convergence.repo-standards.json', import.meta.url),
  );
  writeClaimStoreForRepoMap(rootDir, repoMap, repoStandards, {
    evidenceInventoryIds: ['repo-governance', 'refactor-tombstones'],
    readinessCoverage: true,
  });
  const record = await buildEvidenceRecord({
    files: ['package.json'],
    config: repoMap,
    repoStandards,
    rootDir,
  });

  assert.equal(record.evidence_inventory_results.length, 2);
  assert.equal(record.evidence_inventory_results[0].id, 'repo-governance');
  assert.equal(record.evidence_inventory_results[0].verification_weight, 'blocking');
  assert.equal(record.evidence_inventory_results[0].selected, true);
  assert.equal(record.evidence_inventory_results[0].freshness_status, 'current');
  assert.equal(record.evidence_inventory_results[0].last_reviewed, '2026-04-26');
  assert.equal(record.readiness_coverage.required_inventory_count, 1);
  assert.equal(record.readiness_coverage.advisory_inventory_count, 0);
  assert.equal(record.readiness_coverage.retire_inventory_count, 1);
  assert.ok(record.trust.bundle.claims.some((claim) => claim.facet === 'veritas.evidence-inventories'));
  assert.ok(record.trust.bundle.claims.some((claim) => claim.facet === 'veritas.readiness-coverage'));
  assert.ok(record.trust.bundle.events.some((event) => event.status === 'stale' || event.status === 'superseded'));
  assert.deepEqual(record.readiness_coverage.unknown_catch_evidence_inventory_ids, [
    'refactor-tombstones',
  ]);
  assert.deepEqual(record.readiness_coverage.stale_or_unknown_inventory_ids, [
    'refactor-tombstones',
  ]);
  assert.match(
    buildFeedbackSummary({ record }),
    /evidence-inventory:repo-governance: required \/ blocking/,
  );
});

test('evidence records include advisory external tool results in Surface input', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-external-tool-'));
  mkdirp(join(rootDir, '.kontourai/veritas/external'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  writeFileSync(
    join(rootDir, '.kontourai/veritas/external/fallow-audit.json'),
    JSON.stringify(
      {
        schema_version: '1',
        command: 'audit',
        summary: {
          dead_code_issues: 0,
          duplication_clone_groups: 19,
          complexity_findings: 100,
        },
      },
      null,
      2,
    ),
  );

  const repoMap = {
    name: 'external-tool-demo',
    kind: 'repo-map',
    policy: {
      defaultFalsePositiveReview: 'unknown',
      defaultPromotionCandidate: false,
      defaultExceptionAllowed: false,
    },
    graph: {
      version: 1,
      defaultResolution: {
        phase: 'Phase 0',
        workstream: 'Demo',
        matchedArtifacts: ['README.md'],
      },
      nonSliceableInvariants: [],
      resolverPrecedence: ['explicit'],
      nodes: [
        { id: 'root.manifest', kind: 'tooling-area', label: 'package.json', patterns: ['package.json'] },
      ],
    },
    evidence: {
      artifactDir: '.kontourai/veritas/evidence',
      reportTransport: 'local-json',
      evidenceChecks: [
        {
          id: 'fallow-advisory',
          command: 'node scripts/run-fallow-audit.mjs',
          method: 'auditability',
          summary: 'Runs Fallow audit as advisory evidence.',
          externalTool: {
            tool: 'fallow',
            format: 'fallow-audit-json',
            blocking: false,
            artifactPath: '.kontourai/veritas/external/fallow-audit.json',
          },
        },
      ],
      requiredEvidenceCheckIds: ['fallow-advisory'],
      uncoveredPathPolicy: 'warn',
    },
  };
  const repoStandards = { name: 'external-tool-policy', version: 1, rules: [] };
  writeClaimStoreForRepoMap(rootDir, repoMap, repoStandards);

  const record = await buildEvidenceRecord({
    files: ['package.json'],
    config: repoMap,
    repoStandards,
    rootDir,
  });

  assert.equal(record.external_tool_results.length, 1);
  assert.equal(record.external_tool_results[0].tool, 'fallow');
  assert.equal(record.external_tool_results[0].verdict, 'warn');
  assert.equal(record.external_tool_results[0].blocking, false);
  assert.equal(record.external_tool_results[0].summary.dead_code_issues, 0);
  assert.ok(
    record.trust.bundle.claims.some(
      (claim) => claim.facet === 'veritas.external-tools',
    ),
  );
  const evidenceCheckClaim = record.trust.bundle.claims.find(
    (claim) => claim.facet === 'veritas.evidence-check' && claim.metadata.command === 'node scripts/run-fallow-audit.mjs',
  );
  const externalToolClaim = record.trust.bundle.claims.find(
    (claim) => claim.facet === 'veritas.external-tools',
  );
  assert.ok(evidenceCheckClaim);
  assert.ok(externalToolClaim);
  assert.equal(externalToolClaim.derivedFrom, undefined);
  assert.ok(
    record.trust.bundle.events.some(
      (event) => event.notes === 'fallow fallow-audit-json verdict: warn',
    ),
  );
  assert.match(
    buildFeedbackSummary({ record }),
    /WARN\s+external-tool:fallow: warn \/ advisory/,
  );
});

test('blocking external tool results count as feedback failures', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-external-tool-block-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  const repoMap = {
    name: 'external-tool-block-demo',
    kind: 'repo-map',
    graph: {
      version: 1,
      defaultResolution: {
        phase: 'Phase 0',
        workstream: 'Demo',
        matchedArtifacts: ['README.md'],
      },
      nonSliceableInvariants: [],
      resolverPrecedence: ['explicit'],
      nodes: [
        { id: 'root.manifest', kind: 'tooling-area', label: 'package.json', patterns: ['package.json'] },
      ],
    },
    evidence: {
      artifactDir: '.kontourai/veritas/evidence',
      reportTransport: 'local-json',
      evidenceChecks: [
        {
          id: 'blocking-tool',
          command: 'node scripts/run-tool.mjs',
          method: 'auditability',
          externalTool: {
            tool: 'fallow',
            format: 'fallow-audit-json',
            blocking: true,
            artifactPath: '.kontourai/veritas/external/missing.json',
          },
        },
      ],
      requiredEvidenceCheckIds: ['blocking-tool'],
      uncoveredPathPolicy: 'warn',
    },
  };
  writeClaimStoreForRepoMap(rootDir, repoMap, { name: 'external-tool-policy', version: 1, rules: [] });
  const record = await buildEvidenceRecord({
    files: ['package.json'],
    config: repoMap,
    repoStandards: { name: 'external-tool-policy', version: 1, rules: [] },
    rootDir,
  });

  assert.equal(record.external_tool_results[0].verdict, 'missing');
  assert.equal(feedbackHasFailures(record), true);
  assert.match(
    buildFeedbackSummary({ record }),
    /FAIL\s+external-tool:fallow: missing \/ blocking/,
  );
});

test('evidence-inventory manifest validation rejects required inventories without review evidence', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-evidence-inventory-invalid-'));
  mkdirp(join(rootDir, '.veritas/evidence-inventories'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  writeFileSync(
    join(rootDir, '.veritas/evidence-inventories/guardrails.json'),
    JSON.stringify(
      {
        version: 1,
        sourceEvidenceCheckId: 'legacy-guardrails',
        items: [
          {
            id: 'unsafe-required',
            evidenceCheckId: 'required-evidence-check',
            defaultDisposition: 'required',
            currentBlockingStatus: 'required',
            recentCatchEvidence: 'unknown',
            rationale: 'This should not be promoted without evidence.',
          },
        ],
      },
      null,
      2,
    ),
  );

  const repoMap = {
    ...readJson('../repo-maps/work-agent.repo-map.json'),
    evidence: {
      ...readJson('../repo-maps/work-agent.repo-map.json').evidence,
      evidenceInventoryManifests: ['.veritas/evidence-inventories/guardrails.json'],
    },
  };
  const repoStandards = loadRepoStandards(
    new URL('../repo-standards/work-agent-convergence.repo-standards.json', import.meta.url),
  );

  await assert.rejects(
    () =>
      buildEvidenceRecord({
        files: ['package.json'],
        config: repoMap,
        repoStandards,
        rootDir,
      }),
    /evidence-inventory unsafe-required owner must be a non-empty string/,
  );
});

test('Repo Standards evaluates governance blocks and diff-required rules', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-policy-rules-'));
  writeFileSync(join(rootDir, 'AGENTS.md'), `# Agents\n\n${buildGovernanceBlock()}\n`);
  writeFileSync(join(rootDir, 'CLAUDE.md'), '# Claude\n');

  const repoStandards = {
    version: 1,
    name: 'policy-rule-demo',
    rules: [
      {
        id: 'ai-instruction-files-synced',
        kind: 'governance-block',
        classification: 'hard-invariant',
        enforcementLevel: 'Guide',
        message: 'Instruction files must include the Veritas block.',
        match: {
          'governance-block': ['AGENTS.md', 'CLAUDE.md'],
        },
      },
      {
        id: 'api-changes-require-test-changes',
        kind: 'diff-required',
        classification: 'promotable-policy',
        enforcementLevel: 'Require',
        message: 'API changes require API tests.',
        match: {
          'if-changed': 'src/api/',
          'then-require': 'tests/api/',
        },
      },
    ],
  };

  const failedResults = evaluateRepoStandards(repoStandards, {
    rootDir,
    changedFiles: ['src/api/routes.ts'],
  });
  assert.equal(failedResults[0].implemented, true);
  assert.equal(failedResults[0].passed, false);
  assert.equal(failedResults[0].findings[0].artifact, 'CLAUDE.md');
  assert.equal(failedResults[1].passed, false);
  assert.equal(failedResults[1].findings[0].required, 'tests/api/');

  writeFileSync(join(rootDir, 'CLAUDE.md'), `${buildGovernanceBlock()}\n`);
  const passedResults = evaluateRepoStandards(repoStandards, {
    rootDir,
    changedFiles: ['src/api/routes.ts', 'tests/api/routes.test.ts'],
  });
  assert.equal(passedResults[0].passed, true);
  assert.equal(passedResults[1].passed, true);
});

test('Repo Standards flags repeatable governance checks without Veritas primitive coverage', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-primitive-first-'));
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({
    scripts: {
      'governance:check': 'node scripts/check-governance.js',
    },
  }, null, 2)}\n`);

  const primitiveFirstRule = {
    id: 'repeatable-governance-uses-veritas-primitives',
    kind: 'primitive-first-governance',
    classification: 'promotable-policy',
    enforcementLevel: 'Guide',
    message: 'Repeatable governance checks should use Veritas primitives.',
    match: {
      candidates: [
        {
          files: ['package.json'],
          pattern: '"governance:check"\\s*:\\s*"node scripts/check-governance\\.js"',
          representedBy: [
            {
              kind: 'evidence-check',
              id: 'governance-check',
            },
          ],
        },
      ],
    },
  };
  const repoStandards = {
    version: 1,
    name: 'primitive-first-demo',
    rules: [primitiveFirstRule],
  };

  const [failedResult] = evaluateRepoStandards(
    repoStandards,
    {
      rootDir,
      changedFiles: ['package.json'],
      config: { evidence: { evidenceChecks: [] } },
    },
  );
  assert.equal(failedResult.implemented, true);
  assert.equal(failedResult.passed, false);
  assert.equal(failedResult.findings[0].kind, 'primitive-first-governance');
  assert.equal(failedResult.findings[0].artifact, 'package.json');
  assert.deepEqual(failedResult.findings[0].required_primitives, [
    {
      kind: 'evidence-check',
      id: 'governance-check',
    },
  ]);

  const [passedResult] = evaluateRepoStandards(
    repoStandards,
    {
      rootDir,
      changedFiles: ['package.json'],
      config: {
        evidence: {
          evidenceChecks: [
            {
              id: 'governance-check',
              command: 'npm run governance:check',
              method: 'validation',
            },
          ],
        },
      },
    },
  );
  assert.equal(passedResult.passed, true);
  assert.deepEqual(passedResult.findings, []);
});

test('Repo Standards flags package quality scripts without Evidence Check routing', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-primitive-first-scripts-'));
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({
    scripts: {
      'quality:check': 'node scripts/check-quality.js',
    },
  }, null, 2)}\n`);

  const repoStandards = {
    version: 1,
    name: 'primitive-first-script-demo',
    rules: [
      {
        id: 'repeatable-governance-uses-veritas-primitives',
        kind: 'primitive-first-governance',
        classification: 'promotable-policy',
        enforcementLevel: 'Guide',
        message: 'Repeatable governance checks should use Veritas primitives.',
        match: {
          packageScripts: {
            file: 'package.json',
            namePatterns: ['^(quality|governance)(:|$)'],
            commandPatterns: ['check-quality'],
            helperExemptions: [],
          },
        },
      },
    ],
  };

  const [failedResult] = evaluateRepoStandards(
    repoStandards,
    {
      rootDir,
      changedFiles: ['package.json'],
      config: { evidence: { evidenceChecks: [] } },
    },
  );
  assert.equal(failedResult.implemented, true);
  assert.equal(failedResult.passed, false);
  assert.equal(failedResult.enforcementLevel, 'Guide');
  assert.equal(failedResult.findings[0].kind, 'primitive-first-governance');
  assert.equal(failedResult.findings[0].artifact, 'package.json');
  assert.equal(failedResult.findings[0].package_script, 'quality:check');
  assert.equal(failedResult.findings[0].command, 'node scripts/check-quality.js');

  const [passedResult] = evaluateRepoStandards(
    repoStandards,
    {
      rootDir,
      changedFiles: ['package.json'],
      config: {
        evidence: {
          evidenceChecks: [
            {
              id: 'quality-check',
              command: 'npm run quality:check',
              method: 'validation',
            },
          ],
        },
      },
    },
  );
  assert.equal(passedResult.passed, true);
  assert.deepEqual(passedResult.findings, []);
});

test('Repo Standards accepts explicit non-governance package helper exemptions', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-primitive-first-helper-'));
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({
    scripts: {
      'quality:docs': 'node scripts/build-docs.js',
    },
  }, null, 2)}\n`);

  const repoStandards = {
    version: 1,
    name: 'primitive-first-helper-demo',
    rules: [
      {
        id: 'repeatable-governance-uses-veritas-primitives',
        kind: 'primitive-first-governance',
        classification: 'promotable-policy',
        enforcementLevel: 'Guide',
        message: 'Repeatable governance checks should use Veritas primitives.',
        match: {
          packageScripts: {
            file: 'package.json',
            namePatterns: ['^quality:'],
            commandPatterns: [],
            helperExemptions: [
              {
                name: 'quality:docs',
                rationale: 'Builds local documentation output; it is not a governance or quality gate.',
              },
            ],
          },
        },
      },
    ],
  };

  assert.equal(
    repoStandards.rules[0].match.packageScripts.helperExemptions[0].rationale,
    'Builds local documentation output; it is not a governance or quality gate.',
  );

  const [result] = evaluateRepoStandards(
    repoStandards,
    {
      rootDir,
      changedFiles: ['package.json'],
      config: { evidence: { evidenceChecks: [] } },
    },
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.findings, []);
});

test('Repo Standards fails closed for unknown rule kinds', () => {
  const repoStandards = {
    version: 1,
    name: 'unknown-kind-demo',
    rules: [
      {
        id: 'invented-rule',
        kind: 'frobnicate',
        classification: 'hard-invariant',
        enforcementLevel: 'Require',
        message: 'Invented rules must not silently pass.',
        match: {
          artifacts: ['package.json'],
        },
      },
    ],
  };

  const [result] = evaluateRepoStandards(repoStandards, { rootDir: repoRootDir });
  assert.equal(result.implemented, false);
  assert.equal(result.passed, null);
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'unknown rule kind');
  assert.match(result.summary, /Unknown rule kind: frobnicate/);

  const feedback = buildFeedbackSummary({
    record: {
      files: ['package.json'],
      components: [],
      policy_results: [result],
      evidence_inventory_results: [],
      external_tool_results: [],
    },
  });
  assert.match(feedback, /FAIL\s+invented-rule: Unknown rule kind: frobnicate\./);
  assert.match(feedback, /1 failure/);
});

test('pattern matching supports globs and ordered negation', () => {
  assert.equal(matchesPatterns('src/nested/module.mjs', ['src/**/*.mjs']), true);
  assert.equal(
    matchesPatterns('src/nested/module.mjs', ['src/**/*.mjs', '!src/nested/**']),
    false,
  );
  assert.equal(matchesPatterns('src/index.mjs', ['src/']), true);
  assert.equal(matchesPatterns('src/index.mjs', ['src/index.mjs']), true);
});

test('content-level policy rules report file and line findings', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-content-rules-'));
  mkdirp(join(rootDir, 'src/nested'));
  mkdirp(join(rootDir, 'docs'));
  writeFileSync(join(rootDir, 'src/nested/module.mjs'), 'const x = 1;\nconsole.log(x);\n');
  writeFileSync(join(rootDir, 'docs/intro.md'), '# Intro\n\nOld eval language.\n');
  const repoStandards = {
    version: 1,
    name: 'content-rules',
    rules: [
      {
        id: 'no-console',
        kind: 'forbidden-pattern',
        classification: 'advisory-pattern',
        enforcementLevel: 'Guide',
        message: 'No console logging.',
        match: { files: ['src/**/*.mjs'], pattern: 'console\\.log' },
      },
      {
        id: 'requires-const',
        kind: 'required-pattern',
        classification: 'advisory-pattern',
        enforcementLevel: 'Guide',
        message: 'Requires const.',
        match: { files: ['src/**/*.mjs'], pattern: 'const x' },
      },
      {
        id: 'header',
        kind: 'header-required',
        classification: 'advisory-pattern',
        enforcementLevel: 'Guide',
        message: 'Requires header.',
        match: { files: ['src/**/*.mjs'], pattern: '^// Copyright' },
      },
      {
        id: 'vocabulary',
        kind: 'vocabulary-consistency',
        classification: 'advisory-pattern',
        enforcementLevel: 'Guide',
        message: 'Use canonical vocabulary.',
        match: {
          files: ['docs/**/*.md'],
          terms: [
            {
              term: 'eval',
              pattern: '\\bevals?\\b',
              prefer: 'Standards Feedback',
            },
          ],
        },
      },
    ],
  };

  const results = evaluateRepoStandards(repoStandards, {
    rootDir,
    changedFiles: ['src/nested/module.mjs', 'docs/intro.md'],
  });
  assert.equal(results[0].passed, false);
  assert.equal(results[0].findings[0].artifact, 'src/nested/module.mjs');
  assert.equal(results[0].findings[0].line, 2);
  assert.equal(results[1].passed, true);
  assert.equal(results[2].passed, false);
  assert.equal(results[3].passed, false);
  assert.equal(results[3].findings[0].kind, 'vocabulary-drift');
  assert.equal(results[3].findings[0].prefer, 'Standards Feedback');
});

test('explain selects only file-matching rule context and stays concise', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-explain-'));
  mkdirp(join(rootDir, '.veritas'));
  writeFileSync(join(rootDir, '.veritas/GOVERNANCE.md'), '# Governance\nDo not weaken policy.\n');
  const repoMap = {
    graph: {
      nodes: [
        { id: 'app.src', label: 'src/**', kind: 'product-area', patterns: ['src/'] },
      ],
    },
  };
  const repoStandards = {
    rules: [
      {
        id: 'src-rule',
        kind: 'forbidden-pattern',
        classification: 'advisory-pattern',
        enforcementLevel: 'Guide',
        message: 'No debug output.',
        explain: { summary: 'Source rule only.', mustDo: ['Remove debug output.'] },
        match: { files: ['src/**/*.mjs'], pattern: 'console\\.log' },
      },
      {
        id: 'docs-rule',
        kind: 'required-artifacts',
        classification: 'advisory-pattern',
        enforcementLevel: 'Guide',
        message: 'Docs required.',
        explain: { summary: 'Docs rule only.' },
        match: { artifacts: ['docs/README.md'] },
      },
    ],
  };
  const text = buildExplainText({
    rootDir,
    repoMap,
    repoStandards,
    filePath: 'src/index.mjs',
  });
  assert.match(text, /src-rule/);
  assert.doesNotMatch(text, /docs-rule/);
  assert.ok(text.split('\n').length <= 80);
});

test('strict work-area boundary rejects non-owner writes unless allowed', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-boundary-'));
  const repoMap = {
    graph: {
      nodes: [
        {
          id: 'surface.a',
          kind: 'product-area',
          label: 'a/**',
          patterns: ['a/'],
          owners: ['team-a'],
          boundary: 'strict',
          boundaryAllow: ['team-b'],
        },
        {
          id: 'surface.b',
          kind: 'product-area',
          label: 'b/**',
          patterns: ['b/'],
          owners: ['team-b'],
          boundary: 'strict',
          boundaryAllow: [],
        },
      ],
    },
  };
  const failed = checkBoundaries({
    rootDir,
    repoMap,
    actor: 'team-c',
    files: ['a/file.js'],
  });
  assert.equal(failed.passed, false);
  assert.equal(failed.findings[0].node, 'surface.a');

  const allowed = checkBoundaries({
    rootDir,
    repoMap,
    actor: 'team-b',
    files: ['a/file.js'],
  });
  assert.equal(allowed.passed, true);
});

test('work-area boundary fails closed without actor and reports owner outcomes', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-boundary-actor-'));
  const previousActor = process.env.VERITAS_ACTOR;
  delete process.env.VERITAS_ACTOR;
  const repoMap = {
    graph: {
      nodes: [
        {
          id: 'governance.guidance',
          kind: 'protected-area',
          label: '.veritas/**',
          patterns: ['.veritas/'],
          owners: ['governance-team'],
          boundary: 'strict',
          boundaryAllow: [],
        },
      ],
    },
  };
  const rule = {
    id: 'work-area-boundary',
    kind: 'work-area-boundary',
    classification: 'hard-invariant',
    enforcementLevel: 'Require',
    message: 'Actors may only edit owned surfaces.',
    match: {},
  };

  try {
    const missingActor = evaluateWorkAreaBoundaryRule(rule, {
      rootDir,
      config: repoMap,
      changedFiles: ['.veritas/example.json'],
    });
    assert.equal(missingActor.status, 'error');
    assert.equal(feedbackStatusForPolicyResult(missingActor), 'FAIL');
    assert.equal(missingActor.findings[0].kind, 'missing-actor');

    const owner = evaluateWorkAreaBoundaryRule(rule, {
      rootDir,
      config: repoMap,
      actor: 'governance-team',
      changedFiles: ['.veritas/example.json'],
    });
    assert.equal(owner.passed, true);

    const randomTeam = evaluateWorkAreaBoundaryRule(rule, {
      rootDir,
      config: repoMap,
      actor: 'random-team',
      changedFiles: ['.veritas/example.json'],
    });
    assert.equal(randomTeam.passed, false);
    assert.equal(randomTeam.findings[0].kind, 'work-area-boundary');
  } finally {
    if (previousActor === undefined) {
      delete process.env.VERITAS_ACTOR;
    } else {
      process.env.VERITAS_ACTOR = previousActor;
    }
  }
});

test('work-area evidence routing prefers work-area routes, then default, then required checks', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-evidence-check-plan-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  mkdirp(join(rootDir, 'scripts'));
  mkdirp(join(rootDir, 'packages/core'));
  mkdirp(join(rootDir, 'docs'));

  const repoMap = {
    name: 'surface-evidenceCheck-demo',
    kind: 'repo-map',
    policy: {
      defaultFalsePositiveReview: 'unknown',
      defaultPromotionCandidate: false,
      defaultExceptionAllowed: false,
    },
    graph: {
      version: 1,
      defaultResolution: {
        phase: 'Phase 0',
        workstream: 'Demo',
        matchedArtifacts: ['README.md'],
      },
      nonSliceableInvariants: [],
      resolverPrecedence: ['explicit'],
      nodes: [
        { id: 'tooling.scripts', kind: 'tooling-area', label: 'scripts/**', patterns: ['scripts/'] },
        { id: 'workspace.packages', kind: 'shared-package', label: 'packages/**', patterns: ['packages/'] },
        { id: 'docs.docs', kind: 'product-area', label: 'docs/**', patterns: ['docs/'] },
      ],
    },
    evidence: {
      artifactDir: '.kontourai/veritas/evidence',
      reportTransport: 'local-json',
      evidenceChecks: [
        { id: 'required-evidence-check', command: 'npm run required-evidence-check', method: 'validation' },
        { id: 'default-evidence-check', command: 'npm run default-evidence-check', method: 'validation' },
        { id: 'viewer-build', command: 'npm run viewer:build', method: 'validation' },
      ],
      requiredEvidenceCheckIds: ['required-evidence-check'],
      defaultEvidenceCheckIds: ['default-evidence-check'],
      evidenceCheckRoutes: [
        { componentIds: ['tooling.scripts'], evidenceCheckIds: ['viewer-build', 'viewer-build'] },
      ],
      uncoveredPathPolicy: 'warn',
    },
  };

  const surfacePlan = resolveEvidenceCheckCommands({
    repoMapPath: writeTempRepoMap(rootDir, repoMap),
    files: ['scripts/build-viewer.mjs'],
    rootDir,
  });
  assert.deepEqual(surfacePlan.evidenceCheckCommands, ['npm run viewer:build']);
  assert.equal(surfacePlan.resolutionSource, 'surface');

  const defaultPlan = resolveEvidenceCheckCommands({
    repoMapPath: writeTempRepoMap(rootDir, repoMap),
    files: ['packages/core/index.ts'],
    rootDir,
  });
  assert.deepEqual(defaultPlan.evidenceCheckCommands, ['npm run default-evidence-check']);
  assert.equal(defaultPlan.resolutionSource, 'default');

  const mixedPlan = resolveEvidenceCheckCommands({
    repoMapPath: writeTempRepoMap(rootDir, repoMap),
    files: ['scripts/build-viewer.mjs', 'packages/core/index.ts'],
    rootDir,
  });
  assert.deepEqual(mixedPlan.evidenceCheckCommands, ['npm run viewer:build', 'npm run default-evidence-check']);
  assert.equal(mixedPlan.resolutionSource, 'surface');

  delete repoMap.evidence.defaultEvidenceCheckIds;
  const requiredPlan = resolveEvidenceCheckCommands({
    repoMapPath: writeTempRepoMap(rootDir, repoMap),
    files: ['docs/guide.md'],
    rootDir,
  });
  assert.deepEqual(requiredPlan.evidenceCheckCommands, ['npm run required-evidence-check']);
  assert.equal(requiredPlan.resolutionSource, 'required');

  repoMap.evidence.requiredEvidenceChecks = ['npm run removed-evidence-check'];
  assert.throws(
    () => resolveEvidenceCheckCommands({
      repoMapPath: writeTempRepoMap(rootDir, repoMap),
      files: ['docs/guide.md'],
      rootDir,
    }),
    /removed field/,
  );
});

test('guidance CLI can run with explicit repo map and repo-standards inputs', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  writeClaimStoreForRepoMap(
    rootDir,
    readJson('../repo-maps/work-agent.repo-map.json'),
    loadRepoStandards(new URL('../repo-standards/work-agent-convergence.repo-standards.json', import.meta.url)),
  );

  const stdout = execFileSync(
    'node',
    [
      fileURLToPath(new URL('../bin/veritas-report.mjs', import.meta.url)),
      '--root',
      rootDir,
      '--repo-map',
      fileURLToPath(
        new URL('../repo-maps/work-agent.repo-map.json', import.meta.url),
      ),
      '--repo-standards',
      fileURLToPath(
        new URL(
          '../repo-standards/work-agent-convergence.repo-standards.json',
          import.meta.url,
        ),
      ),
      '--run-id',
      'veritas-cli-smoke',
      'package.json',
    ],
    { encoding: 'utf8' },
  );

  const parsed = parseCliJson(stdout);
  assert.equal(parsed.run_id, 'veritas-cli-smoke');
  assert.equal(parsed.repo_map.name, 'work-agent');
  assert.deepEqual(parsed.triggered_evidence_checks, ['root manifests']);
  assert.deepEqual(parsed.repo_standards, {
    name: 'work-agent-convergence',
    version: 1,
    rule_count: 4,
  });
});

test('CLI entrypoints expose help text for publishable operator surfaces', () => {
  const mainHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', '--help'],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  assert.match(mainHelp, /veritas init/);
  assert.match(mainHelp, /veritas readiness \[--check evidence\|boundaries\|coverage\]/);
  assert.match(mainHelp, /veritas feedback marker/);
  assert.match(mainHelp, /veritas feedback marker-suite/);
  assert.doesNotMatch(mainHelp, /Deprecated shims/);

  const runHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'readiness', '--help'],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  assert.match(runHelp, /veritas readiness/);
  assert.match(runHelp, /--check boundaries/);

  const integrationsHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'integrations', '--help'],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  assert.match(integrationsHelp, /veritas integrations codex\|claude-code\|cursor\|copilot/);

  const feedbackHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'feedback', 'marker', '--help'],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  assert.match(feedbackHelp, /veritas feedback marker/);
  assert.match(feedbackHelp, /--without-veritas-session-log <path>/);

  const feedbackSuiteHelp = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'feedback', 'marker-suite', '--help'],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  assert.match(feedbackSuiteHelp, /veritas feedback marker-suite/);
  assert.match(feedbackSuiteHelp, /--suite <path>/);

  const reportBinaryHelp = execFileSync(
    'node',
    [fileURLToPath(new URL('../bin/veritas-report.mjs', import.meta.url)), '--help'],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  assert.match(reportBinaryHelp, /veritas-report/);
});

test('init CLI writes a conservative starter kit and report CLI can use it', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');

  const initStdout = runLocalVeritas([
    'init',
    '--root',
    rootDir,
    '--project-name',
    'Demo Starter',
    '--evidence-check',
    'npm run test:smoke',
  ]);
  const initResult = parseCliJson(initStdout);
  assert.equal(initResult.projectName, 'Demo Starter');
  assert.equal(initResult.evidenceCheck, 'npm run test:smoke');
  assert.match(initResult.codeownersBlock, /\.veritas\/repo-map\.json  @your-team\/governance/);
  assert.ok(
    initResult.generatedFiles.includes('.veritas/repo-map.json'),
  );
  assert.ok(
    initResult.generatedFiles.includes('.veritas/GOVERNANCE.md'),
  );

  const starterRepoMap = readJsonFromAbsolute(
    join(rootDir, '.veritas/repo-map.json'),
  );
  const governanceInstructions = readFileSync(
    join(rootDir, '.veritas/GOVERNANCE.md'),
    'utf8',
  );
  const starterRepoStandards = readJsonFromAbsolute(
    join(rootDir, '.veritas/repo-standards/default.repo-standards.json'),
  );
  const starterAuthoritySettings = readJsonFromAbsolute(
    join(rootDir, '.veritas/authority/default.authority-settings.json'),
  );

  assert.equal(starterRepoMap.name, 'demo-starter');
  assert.equal(starterRepoMap.graph.nodes[0]['governance-locked'], true);
  assert.deepEqual(starterRepoMap.activation.aiInstructionFiles, []);
  assert.equal(starterRepoStandards.name, 'demo-starter-default');
  assert.ok(
    starterRepoStandards.rules.some((rule) => rule.match?.['governance-block']),
  );
  assert.equal(starterAuthoritySettings.defaults.mode, 'observe');
  assert.equal(initResult.repoInsights.repoKind, 'application');
  assert.equal(starterRepoMap.evidence.defaultEvidenceCheckIds, undefined);
  assert.equal(starterRepoMap.evidence.uncoveredPathPolicy, undefined);
  assert.match(governanceInstructions, /Do not modify without a fresh Veritas attestation/);
  assert.match(governanceInstructions, /\.veritas\/repo-standards\//);
  assert.match(governanceInstructions, /Standards Growth is additive/);
  assert.match(governanceInstructions, /Generated Evidence is output/);
  assert.equal(existsSync(join(rootDir, 'AGENTS.md')), false);
  assert.equal(existsSync(join(rootDir, 'CLAUDE.md')), false);

  const reportResult = (await generateVeritasReport({
    rootDir,
    runId: 'bootstrap-smoke',
  }, { rootDir }, ['package.json'])).record;
  assert.equal(reportResult.run_id, 'bootstrap-smoke');
  assert.equal(reportResult.repo_map.name, 'demo-starter');
  assert.equal(reportResult.repo_standards.name, 'demo-starter-default');
  assert.equal(reportResult.source_kind, 'explicit-files');
  assert.deepEqual(reportResult.source_scope, ['explicit']);
});

test('init CLI can install a named Repo Standards template', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-template-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  const initStdout = runLocalVeritas([
    'init',
    '--root',
    rootDir,
    '--project-name',
    'Next Starter',
    '--template',
    'nextjs-typescript',
  ]);
  const initResult = parseCliJson(initStdout);
  const repoStandards = readJsonFromAbsolute(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'));

  assert.equal(initResult.template, 'nextjs-typescript');
  assert.equal(repoStandards.name, 'nextjs-typescript');
  assert.ok(repoStandards.rules.some((rule) => rule.id === 'api-routes-require-api-tests'));
});

test('init explore persists a read-only recommendation artifact by default', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-explore-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          verify: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agents\n');

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--explore', '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const recommendation = parseCliJson(stdout);

  assert.equal(recommendation.mode, 'explore');
  assert.equal(recommendation.target_root, rootDir);
  assert.equal(recommendation.evidenceCheck, 'npm run verify');
  assert.equal(recommendation.recommended_evidence_checks[0].command, 'npm run verify');
  assert.ok(recommendation.artifact_payloads['.veritas/repo-map.json']);
  assert.ok(recommendation.artifact_hashes['.veritas/repo-map.json']);
  assert.deepEqual(
    recommendation.selected_instruction_targets.map((target) => target.path),
    ['AGENTS.md'],
  );
  assert.equal(recommendation.artifact_payloads['CLAUDE.md'], undefined);
  assert.equal(recommendation.output_path, '.veritas/init-plans/explore.json');
  assert.equal(existsSync(join(rootDir, '.veritas/init-plans/explore.json')), true);
  assert.equal(existsSync(join(rootDir, '.veritas/repo-map.json')), false);
  assert.equal(
    readJsonFromAbsolute(join(rootDir, '.veritas/init-plans/explore.json')).output_path,
    '.veritas/init-plans/explore.json',
  );
});

test('init explore deterministically inventories Station, Ops, and declared external authority shapes', () => {
  const stationRoot = mkdtempSync(join(tmpdir(), 'veritas-init-station-shaped-'));
  writeFileSync(join(stationRoot, 'package.json'), JSON.stringify({
    private: true,
    workspaces: ['packages/*'],
    scripts: { 'ci:fast': 'node --test', verify: 'node --test' },
  }));
  for (const root of ['src-server', 'src-ui', 'src-shared', 'packages', 'docs', 'scripts', 'tests']) {
    mkdirp(join(stationRoot, root));
  }
  const station = parseCliJson(execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--explore', '--root', stationRoot],
    { cwd: repoRootDir, encoding: 'utf8' },
  ));
  assert.deepEqual(station.repo_insights.sourceRoots, [
    'src-server/', 'src-ui/', 'src-shared/', 'packages/', 'docs/',
  ]);
  assert.equal(station.evidenceCheck, 'npm run ci:fast');

  const opsRoot = mkdtempSync(join(tmpdir(), 'veritas-init-ops-shaped-'));
  writeFileSync(join(opsRoot, 'package.json'), JSON.stringify({ scripts: { verify: 'node --test' } }));
  for (const root of ['docs', 'strategy', 'knowledge', 'suite', 'scripts']) mkdirp(join(opsRoot, root));
  const ops = parseCliJson(execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--explore', '--root', opsRoot],
    { cwd: repoRootDir, encoding: 'utf8' },
  ));
  assert.equal(ops.repo_insights.repoKind, 'knowledge');
  assert.deepEqual(ops.repo_insights.sourceRoots, ['docs/', 'strategy/', 'knowledge/', 'suite/']);
  assert.deepEqual(
    ops.recommended_repo_map.graph.nodes
      .filter((node) => node.kind === 'product-area')
      .map((node) => node.patterns[0]),
    ['docs/', 'strategy/', 'knowledge/', 'suite/'],
  );

  const surfaceRoot = mkdtempSync(join(tmpdir(), 'veritas-init-surface-shaped-'));
  writeFileSync(join(surfaceRoot, 'package.json'), JSON.stringify({
    scripts: { verify: 'node --test' },
    veritas: {
      externalBoundaries: [{
        id: 'hachure-spec',
        authority: 'https://github.com/hachure-org/spec',
        relationship: 'upstream-format',
        package: 'hachure',
      }],
    },
  }));
  mkdirp(join(surfaceRoot, 'src'));
  const first = parseCliJson(execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--explore', '--root', surfaceRoot],
    { cwd: repoRootDir, encoding: 'utf8' },
  ));
  const second = parseCliJson(execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--explore', '--root', surfaceRoot],
    { cwd: repoRootDir, encoding: 'utf8' },
  ));
  assert.deepEqual(first.external_boundaries, [{
    id: 'hachure-spec',
    authority: 'https://github.com/hachure-org/spec',
    relationship: 'upstream-format',
    package: 'hachure',
    source: 'package.json#veritas.externalBoundaries',
  }]);
  assert.ok(first.owner_questions.some((question) => question.id === 'external-authority-boundaries'));
  assert.deepEqual(second.repo_insights, first.repo_insights);
  assert.deepEqual(second.artifact_hashes, first.artifact_hashes);

  const documentedRoot = mkdtempSync(join(tmpdir(), 'veritas-init-documented-boundary-'));
  writeFileSync(join(documentedRoot, 'package.json'), JSON.stringify({
    dependencies: { hachure: '^0.15.0' },
  }));
  writeFileSync(
    join(documentedRoot, 'CONTEXT.md'),
    '[Hachure](https://github.com/hachure-org/spec) owns the upstream format; this package adapts it.\n',
  );
  const documented = inferBootstrapRepoInsights(documentedRoot);
  assert.deepEqual(documented.externalBoundaries, [{
    id: 'hachure-authority',
    authority: 'https://github.com/hachure-org/spec',
    relationship: 'documented-external-authority',
    package: 'hachure',
    source: 'repository documentation',
  }]);
});

test('init explore preserves mature governance and appends only uncovered work areas', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-mature-governance-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { verify: 'node --test' } }));
  for (const root of ['src', 'docs', 'packages/widget']) mkdirp(join(rootDir, root));
  mkdirp(join(rootDir, '.veritas/repo-standards'));
  mkdirp(join(rootDir, '.veritas/authority'));
  const existingRepoMap = {
    kind: 'repo-map',
    name: 'mature',
    graph: {
      version: 1,
      nodes: [
        { id: 'mature.src', kind: 'product-area', label: 'src', patterns: ['src/'], owners: ['product-team'] },
        { id: 'mature.package.widget', kind: 'shared-package', label: 'widget', patterns: ['packages/widget/'], owners: ['product-team'] },
      ],
    },
    evidence: { evidenceChecks: [{ id: 'mature-check', command: 'npm run verify' }] },
  };
  const existingStandards = { version: 1, name: 'mature', rules: [{ id: 'keep-me', kind: 'required-artifacts', match: { artifacts: ['CONTEXT.md'] } }] };
  const existingAuthority = { version: 1, id: 'mature', defaults: { mode: 'observe' }, custom: { keep: true } };
  const existingStandardsPayload = `${JSON.stringify(existingStandards)}\n`;
  const existingAuthorityPayload = `${JSON.stringify(existingAuthority)}\n`;
  writeFileSync(join(rootDir, '.veritas/repo-map.json'), `${JSON.stringify(existingRepoMap, null, 2)}\n`);
  writeFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), existingStandardsPayload);
  writeFileSync(join(rootDir, '.veritas/authority/default.authority-settings.json'), existingAuthorityPayload);
  writeFileSync(join(rootDir, '.veritas/README.md'), 'mature readme\n');
  writeFileSync(join(rootDir, '.veritas/GOVERNANCE.md'), 'mature governance\n');

  const recommendation = parseCliJson(execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--explore', '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  ));

  assert.equal(recommendation.existing_governance.preserved_existing_governance, true);
  assert.deepEqual(recommendation.recommended_repo_standards, existingStandards);
  assert.deepEqual(recommendation.recommended_authority_settings, existingAuthority);
  assert.equal(recommendation.artifact_payloads['.veritas/README.md'], 'mature readme\n');
  assert.equal(recommendation.artifact_payloads['.veritas/GOVERNANCE.md'], 'mature governance\n');
  assert.equal(recommendation.artifact_payloads['.veritas/repo-standards/default.repo-standards.json'], existingStandardsPayload);
  assert.equal(recommendation.artifact_payloads['.veritas/authority/default.authority-settings.json'], existingAuthorityPayload);
  assert.deepEqual(
    recommendation.recommended_repo_map.graph.nodes.map((node) => node.id),
    ['mature.src', 'mature.package.widget', 'governance.guidance', 'governance.root-manifests', 'docs.docs', 'verification.tests'],
  );
  assert.deepEqual(recommendation.existing_governance.appended_work_area_node_ids, [
    'governance.guidance',
    'governance.root-manifests',
    'docs.docs',
    'verification.tests',
  ]);
  assert.ok(recommendation.owner_questions.some((question) => question.id === 'replace-existing-governance'));
});

test('init explore inventories existing brownfield verification', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-existing-'));
  mkdirp(join(rootDir, 'scripts'));
  mkdirp(join(rootDir, '.ai-guidance'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'verify:convergence': 'node scripts/verify-convergence.mjs',
          'guidance:report': 'node scripts/guidance-report.mjs',
          test: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, 'scripts/verify-convergence.mjs'), 'process.exit(0);\n');
  writeFileSync(join(rootDir, 'scripts/guidance-report.mjs'), 'process.exit(0);\n');

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--explore', '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const recommendation = parseCliJson(stdout);

  assert.equal(recommendation.existing_verification.detected, true);
  assert.ok(
    recommendation.recommended_evidence_inventory.some(
      (item) => item.id === 'verify-convergence' && item.default_disposition === 'candidate',
    ),
  );
  assert.ok(
    recommendation.owner_questions.some(
      (question) => question.id === 'existing-verification-inventory',
    ),
  );
});

test('init explore preserves authoritative compound instruction verification with provenance and lowers confidence on conflicts', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-kontourai-io-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          verify: 'node scripts/verify.mjs',
          'test:unit': 'node --test',
          test: 'node --test',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(rootDir, 'AGENTS.md'),
    '# Agent Instructions\n\n## Pre-merge verification\n\nBefore merging, run `npm run verify && npm run test:unit`.\n',
  );
  writeFileSync(
    join(rootDir, 'CLAUDE.md'),
    '# Claude Instructions\n\n## Pre-merge verification\n\nBefore merging, run `npm test`.\n',
  );

  const recommendation = parseCliJson(
    execFileSync(
      'npm',
      ['exec', '--', 'veritas', 'init', '--explore', '--root', rootDir],
      { cwd: repoRootDir, encoding: 'utf8' },
    ),
  );

  const compound = recommendation.existing_verification.items.find(
    (item) => item.command === 'npm run verify && npm run test:unit',
  );
  assert.deepEqual(compound.provenance, {
    path: 'AGENTS.md',
    line: 5,
    signal: 'pre-merge',
    authority: 'repo-declared-ai-instructions',
  });
  assert.equal(recommendation.existing_verification.conflicts.length > 0, true);
  assert.equal(recommendation.evidenceCheck, 'npm run verify && npm run test:unit');
  assert.equal(recommendation.recommended_evidence_checks[0].source, 'repo-declared AI instructions');
  assert.equal(recommendation.recommended_evidence_checks[0].confidence, 'medium');
  assert.equal(recommendation.recommended_evidence_checks[0].confidence === 'high', false);
});

test('init explore keeps kontourai.io broad verification line-local and preferred over package priority', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-kontourai-io-shaped-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          build: 'astro build',
          validate: 'node scripts/validate.mjs',
          'test:rendered': 'playwright test',
          'check:content-boundary': 'node scripts/check-content-boundary.cjs',
          'sync-versions': 'node scripts/sync-versions.mjs',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(rootDir, 'AGENTS.md'),
    `## Source Of Truth

- Broad verification: \`npm run validate && npm run test:rendered\`.

## Match Checks To Change Type

- Docs/interface-only changes: \`npm run check:content-boundary\` plus source inspection.
- Before PR merge readiness: \`npm run validate && npm run test:rendered\`.
- After any Kontour package release: run \`npm run sync-versions\` to pull the latest npm versions.

## Useful Commands

- \`npm run validate && npm run test:rendered\` — broad repo verification before merge readiness.
- \`npm run check:content-boundary\` — focused public-boundary check after public-facing copy.
- \`npm run sync-versions\` — refresh version pins after any release.
`,
  );

  const recommendation = parseCliJson(
    execFileSync(
      'npm',
      ['exec', '--', 'veritas', 'init', '--explore', '--root', rootDir],
      { cwd: repoRootDir, encoding: 'utf8' },
    ),
  );

  assert.deepEqual(recommendation.existing_verification.authoritativeCommands, [
    'npm run validate && npm run test:rendered',
  ]);
  assert.equal(recommendation.existing_verification.selectedAuthoritativeCommand, 'npm run validate && npm run test:rendered');
  assert.equal(recommendation.evidenceCheck, 'npm run validate && npm run test:rendered');
  assert.deepEqual(
    recommendation.existing_verification.items
      .filter((item) => item.kind === 'instruction-file-verification')
      .map((item) => item.command),
    [
      'npm run validate && npm run test:rendered',
      'npm run validate && npm run test:rendered',
      'npm run validate && npm run test:rendered',
    ],
  );
  assert.deepEqual(recommendation.existing_verification.conflicts.map((conflict) => conflict.kind), [
    'package-script-disagreement',
  ]);
  assert.equal(recommendation.recommended_evidence_checks[0].confidence, 'medium');
});

test('readiness coverage CLI prints readiness coverage without reading the full report', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-coverage-cli-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
  );
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agents\n');
  runLocalVeritas(['init', '--root', rootDir, '--evidence-check', 'npm test']);
  mkdirp(join(rootDir, '.veritas/evidence-inventories'));
  writeFileSync(
    join(rootDir, '.veritas/evidence-inventories/guardrails.json'),
    JSON.stringify(
      {
        version: 1,
        sourceEvidenceCheckId: 'required-evidence-check',
        items: [
          {
            id: 'repo-governance',
            evidenceCheckId: 'required-evidence-check',
            owner: 'repo-core',
            defaultDisposition: 'required',
            currentBlockingStatus: 'required',
            recentCatchEvidence: 'init smoke test',
            regressionSeverity: 'high',
            falsePositiveRisk: 'low',
            expiryOrReviewTrigger: 'review when init policy changes',
            rationale: 'Protects generated Veritas artifacts.',
          },
        ],
      },
      null,
      2,
    ),
  );
  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = readJsonFromAbsolute(repoMapPath);
  repoMap.evidence.evidenceInventoryManifests = ['.veritas/evidence-inventories/guardrails.json'];
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`);

  const jsonStdout = execFileSync(
    'node',
    [
      join(repoRootDir, 'bin/veritas.mjs'),
      'readiness',
      '--check',
      'coverage',
      '--root',
      rootDir,
      '--format',
      'json',
      'package.json',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const result = parseCliJson(jsonStdout);

  assert.equal(result.readiness_coverage.required_inventory_count, 1);
  assert.equal(result.evidence_inventory_results[0].id, 'repo-governance');
});

test('init explore output is constrained to .veritas/init-plans', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-output-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  assert.throws(
    () =>
      execFileSync(
        'npm',
        ['exec', '--', 'veritas', 'init', '--explore', '--root', rootDir, '--output', 'plan.json'],
        { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' },
      ),
    /init --output must stay inside \.veritas\/init-plans\//,
  );
  assert.equal(existsSync(join(rootDir, '.veritas')), false);

  const outputPath = join(rootDir, '.veritas/init-plans/explore.json');
  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--explore',
      '--root',
      rootDir,
      '--output',
      '.veritas/init-plans/explore.json',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const recommendation = parseCliJson(stdout);

  assert.equal(recommendation.output_path, '.veritas/init-plans/explore.json');
  assert.equal(existsSync(outputPath), true);
  assert.equal(existsSync(join(rootDir, '.veritas/repo-map.json')), false);
  assert.equal(readJsonFromAbsolute(outputPath).artifact_hashes['.veritas/repo-map.json'], recommendation.artifact_hashes['.veritas/repo-map.json']);
});

test('init apply merges the shared generated-output ignore disclosed by exploration', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-runtime-ignore-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }, null, 2));
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules/\n');
  const planPath = '.veritas/init-plans/runtime-ignore.json';

  const recommendation = parseCliJson(runLocalVeritas([
    'init', '--explore', '--root', rootDir, '--output', planPath,
  ]));
  const applied = parseCliJson(runLocalVeritas([
    'init', '--apply', '--root', rootDir, '--plan', planPath,
  ]));

  assert.deepEqual(recommendation.generated_output_ignores, ['.kontourai/']);
  assert.deepEqual(applied.generatedOutputIgnores, ['.kontourai/']);
  const ignore = readFileSync(join(rootDir, '.gitignore'), 'utf8');
  assert.equal(ignore, 'node_modules/\n\n.kontourai/\n');
  assert.doesNotMatch(ignore, /\.surface|\.veritas/);
});

test('init guided answers drive the reviewed apply artifact', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-guided-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          lint: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(rootDir, 'CLAUDE.md'), '# Claude\n');
  writeFileSync(
    join(rootDir, 'answers.json'),
    JSON.stringify(
      {
        evidenceCheck: 'npm run lint',
        selectedInstructionTargets: ['AGENTS.md'],
        boundaries: ['Do not edit generated snapshots without approval.'],
        codingStyle: 'Prefer small ESM modules.',
      },
      null,
      2,
    ),
  );

  const planPath = join(rootDir, '.veritas/init-plans/guided.json');
  const guidedStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--guided',
      '--answers',
      'answers.json',
      '--root',
      rootDir,
      '--output',
      '.veritas/init-plans/guided.json',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const recommendation = parseCliJson(guidedStdout);

  assert.equal(recommendation.mode, 'guided');
  assert.equal(recommendation.evidenceCheck, 'npm run lint');
  assert.deepEqual(recommendation.selected_instruction_targets.map((target) => target.path), ['AGENTS.md']);
  assert.deepEqual(recommendation.recommended_repo_standards.rules[1].match['governance-block'], ['AGENTS.md']);
  assert.equal(existsSync(join(rootDir, '.veritas/repo-map.json')), false);

  const applyStdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'init', '--apply', '--plan', planPath, '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const applyResult = parseCliJson(applyStdout);
  const repoMap = readJsonFromAbsolute(join(rootDir, '.veritas/repo-map.json'));
  const repoStandards = readJsonFromAbsolute(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'));
  const readme = readFileSync(join(rootDir, '.veritas/README.md'), 'utf8');

  assert.deepEqual(applyResult.generatedFiles.includes('AGENTS.md'), true);
  assert.deepEqual(repoMap.activation.aiInstructionFiles.map((target) => target.path), ['AGENTS.md']);
  assert.deepEqual(repoStandards.rules[1].match['governance-block'], ['AGENTS.md']);
  assert.match(readFileSync(join(rootDir, 'AGENTS.md'), 'utf8'), /veritas:governance-block:start/);
  assert.doesNotMatch(readFileSync(join(rootDir, 'CLAUDE.md'), 'utf8'), /veritas:governance-block:start/);
  assert.match(readme, /Owner Answers/);
  assert.match(readme, /Prefer small ESM modules/);
});

test('init guided may explicitly select an absent instruction target', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-guided-absent-target-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }, null, 2));
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(
    join(rootDir, 'answers.json'),
    JSON.stringify({ selectedInstructionTargets: ['CLAUDE.md'] }, null, 2),
  );

  const recommendation = parseCliJson(
    execFileSync(
      'npm',
      ['exec', '--', 'veritas', 'init', '--guided', '--answers', 'answers.json', '--root', rootDir],
      { cwd: repoRootDir, encoding: 'utf8' },
    ),
  );

  assert.deepEqual(recommendation.selected_instruction_targets.map((target) => target.path), ['CLAUDE.md']);
  assert.match(recommendation.artifact_payloads['CLAUDE.md'], /veritas:governance-block:start/);
});

test('external Veritas CLI initializes a non-npm repository without creating a manifest', () => {
  const rootDir = initCommittedRepo('veritas-external-cli-non-npm-');
  const cliPath = join(repoRootDir, 'bin/veritas.mjs');
  const planPath = '.veritas/init-plans/external.json';
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Agent Instructions\n');

  const explore = execFileSync(
    'node',
    [cliPath, 'init', '--explore', '--root', rootDir, '--output', planPath],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.equal(parseCliJson(explore).mode, 'explore');
  assert.equal(parseCliJson(explore).evidenceCheck, 'node -e "process.exit(0)"');
  assert.equal(existsSync(join(rootDir, 'package.json')), false);

  const apply = execFileSync(
    'node',
    [cliPath, 'init', '--apply', '--root', rootDir, '--plan', planPath],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.ok(parseCliJson(apply).generatedFiles.includes('.veritas/repo-map.json'));
  assert.equal(existsSync(join(rootDir, 'package.json')), false);

  execFileSync('node', [cliPath, 'claim', 'init'], { cwd: rootDir, encoding: 'utf8' });
  assert.equal(existsSync(join(rootDir, 'veritas.claims.json')), true);

  const readiness = execFileSync(
    'node',
    [cliPath, 'readiness', '--root', rootDir, 'AGENTS.md'],
    { cwd: rootDir, encoding: 'utf8' },
  );
  assert.match(readiness, /PASS/);
  assert.equal(existsSync(join(rootDir, 'package.json')), false);
});

test('setup-governance documents the manifest-preserving external engine path', () => {
  const skill = readFileSync(join(repoRootDir, 'skills/setup-governance/SKILL.md'), 'utf8');
  const guide = readFileSync(join(repoRootDir, 'docs/guides/governance-kit.md'), 'utf8');
  assert.match(skill, /maintainer-approved external engine/);
  assert.match(skill, /consumer manifest or lockfile/);
  assert.match(skill, /pinned engine invocation/);
  assert.match(skill, /veritas_engine_path="\$\(command -v veritas\)"/);
  assert.match(skill, /npm exec --yes --package=@kontourai\/veritas@1\.5\.2 -- veritas/);
  assert.match(guide, /Non-npm repositories/);
  assert.match(guide, /npm exec --yes --package=@kontourai\/veritas@1\.5\.2 -- veritas readiness --working-tree/);
  assert.match(guide, /without writing the consumer manifest or lockfile/);
});

test('init guided rejects instruction targets outside the target root before reading', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-guided-escape-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  const secretPath = resolve(rootDir, '../veritas-init-guided-secret.md');
  writeFileSync(secretPath, '# Secret\n');
  writeFileSync(
    join(rootDir, 'answers.json'),
    JSON.stringify(
      {
        selectedInstructionTargets: ['../veritas-init-guided-secret.md'],
      },
      null,
      2,
    ),
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'init',
          '--guided',
          '--answers',
          'answers.json',
          '--root',
          rootDir,
          '--output',
          '.veritas/init-plans/escape.json',
        ],
        { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' },
      ),
    /instruction target path escapes target root/,
  );
  assert.equal(existsSync(join(rootDir, '.veritas/init-plans/escape.json')), false);
});

test('init apply requires an untampered plan artifact', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-apply-plan-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  assert.throws(
    () =>
      execFileSync(
        'npm',
        ['exec', '--', 'veritas', 'init', '--apply', '--root', rootDir],
        { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' },
      ),
    /--apply requires --plan/,
  );

  const planPath = join(rootDir, '.veritas/init-plans/plan.json');
  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--explore',
      '--root',
      rootDir,
      '--output',
      '.veritas/init-plans/plan.json',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const tampered = readJsonFromAbsolute(planPath);
  tampered.artifact_payloads['.veritas/repo-map.json'] = `${tampered.artifact_payloads['.veritas/repo-map.json']}\n`;
  const tamperedPath = join(rootDir, '.veritas/init-plans/tampered.json');
  writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

  assert.throws(
    () =>
      execFileSync(
        'npm',
        ['exec', '--', 'veritas', 'init', '--apply', '--plan', tamperedPath, '--root', rootDir],
        { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' },
      ),
    /payload hash mismatch/,
  );
  assert.equal(existsSync(join(rootDir, '.veritas/repo-map.json')), false);
});

test('init apply rejects plan artifact paths outside the target root', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-apply-escape-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  const planPath = join(rootDir, '.veritas/init-plans/plan.json');
  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--explore',
      '--root',
      rootDir,
      '--output',
      '.veritas/init-plans/plan.json',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const escapedPath = '../veritas-init-apply-escaped.txt';
  const tampered = readJsonFromAbsolute(planPath);
  tampered.artifact_payloads[escapedPath] = 'escaped\n';
  tampered.artifact_hashes[escapedPath] = createHash('sha256').update('escaped\n').digest('hex');
  const tamperedPath = join(rootDir, '.veritas/init-plans/escape.json');
  writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

  assert.throws(
    () =>
      execFileSync(
        'npm',
        ['exec', '--', 'veritas', 'init', '--apply', '--plan', tamperedPath, '--root', rootDir],
        { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' },
      ),
    /artifact path escapes target root/,
  );
  assert.equal(existsSync(resolve(rootDir, escapedPath)), false);
  assert.equal(existsSync(join(rootDir, '.veritas/repo-map.json')), false);
});

test('init rejects unknown flags before writing', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-unknown-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  assert.throws(
    () =>
      execFileSync(
        'npm',
        ['exec', '--', 'veritas', 'init', '--expore', '--root', rootDir],
        { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' },
      ),
    /Unknown init argument/,
  );
  assert.equal(existsSync(join(rootDir, '.veritas')), false);
});

test('buildStandardsFeedbackRecord links a real evidence artifact to a authority settings', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-build-feedback-'));
  mkdirp(join(rootDir, '.kontourai/veritas/evidence'));
  writeFileSync(
    join(rootDir, '.kontourai/veritas/evidence/feedback-build-smoke.json'),
    JSON.stringify(
      {
        record_schema_version: 1,
        run_id: 'feedback-build-smoke',
        timestamp: '2026-04-20T16:00:00.000Z',
        source_ref: 'working-tree',
        source_kind: 'working-tree',
        source_scope: ['staged', 'unstaged'],
        components: ['governance.root-manifests'],
        triggered_evidence_checks: ['root manifests'],
      },
      null,
      2,
    ),
  );
  const evidenceRecord = {
    run_id: 'feedback-build-smoke',
    record_schema_version: 1,
    timestamp: '2026-04-20T16:00:00.000Z',
    source_ref: 'working-tree',
    source_kind: 'working-tree',
    source_scope: ['staged', 'unstaged'],
    components: ['governance.root-manifests'],
    triggered_evidence_checks: ['root manifests'],
  };
  const authoritySettings = readJson('../examples/standards-feedback/work-agent-authority-settings.json');

  const record = buildStandardsFeedbackRecord({
    evidenceRecord,
    evidencePath: join(rootDir, '.kontourai/veritas/evidence/feedback-build-smoke.json'),
    authoritySettings,
    options: {
      acceptedWithoutMajorRewrite: true,
      requiredFollowup: false,
      reviewerConfidence: 'high',
      timeToGreenMinutes: 18,
      exceptionCount: 0,
      falsePositiveRules: [],
      missedIssues: [],
      notes: ['Grounded in a real evidence artifact.'],
    },
    rootDir,
  });

  assert.equal(record.run_id, 'feedback-build-smoke');
  assert.equal(record.authority_settings_id, 'work-agent-default');
  assert.equal(record.mode, 'observe');
  assert.equal(record.evidence.source_ref, 'working-tree');
  assert.equal(record.evidence.source_kind, 'working-tree');
  assert.deepEqual(record.evidence.source_scope, ['staged', 'unstaged']);
  assert.equal(
    record.evidence.artifact_path,
    '.kontourai/veritas/evidence/feedback-build-smoke.json',
  );
  assert.match(record.evidence.artifact_digest, /^[a-f0-9]{64}$/);
  assert.equal(record.governance.protected_standards_touched, true);
  assert.equal(record.governance.classification, 'unknown');
  assert.equal(record.governance.human_review_required, false);
  assert.deepEqual(record.governance.changed_paths, []);
});

test('buildStandardsFeedbackRecord accepts reviewer confidence values from the authority settings scale', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-build-feedback-scale-'));
  mkdirp(join(rootDir, '.kontourai/veritas/evidence'));
  const evidencePath = join(rootDir, '.kontourai/veritas/evidence/feedback-scale-smoke.json');
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        record_schema_version: 1,
        run_id: 'feedback-scale-smoke',
        timestamp: '2026-04-20T16:05:00.000Z',
        source_ref: 'refs/heads/main',
        source_kind: 'explicit-files',
        source_scope: ['explicit'],
        components: [],
        triggered_evidence_checks: [],
      },
      null,
      2,
    ),
  );
  const authoritySettings = {
    id: 'custom-team',
    defaults: { mode: 'observe' },
    review_preferences: { reviewer_confidence_scale: ['red', 'yellow', 'green'] },
  };

  const record = buildStandardsFeedbackRecord({
    evidenceRecord: readJsonFromAbsolute(evidencePath),
    evidencePath,
    authoritySettings,
    options: {
      acceptedWithoutMajorRewrite: true,
      requiredFollowup: false,
      reviewerConfidence: 'green',
      timeToGreenMinutes: 10,
      exceptionCount: 0,
      falsePositiveRules: [],
      missedIssues: [],
      notes: [],
    },
    rootDir,
  });

  assert.equal(record.outcome.reviewer_confidence, 'green');
});

test('buildStandardsFeedbackDraft captures prefilled context without fabricating judgment', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-build-feedback-draft-'));
  mkdirp(join(rootDir, '.kontourai/veritas/evidence'));
  const evidencePath = join(rootDir, '.kontourai/veritas/evidence/feedback-draft-smoke.json');
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        record_schema_version: 1,
        run_id: 'feedback-draft-smoke',
        timestamp: '2026-04-20T17:00:00.000Z',
        source_ref: 'working-tree',
        source_kind: 'working-tree',
        source_scope: ['staged'],
        components: ['governance.root-manifests'],
        triggered_evidence_checks: ['root manifests'],
      },
      null,
      2,
    ),
  );
  const authoritySettings = readJson('../examples/standards-feedback/work-agent-authority-settings.json');

  const draft = buildStandardsFeedbackDraft({
    evidenceRecord: readJsonFromAbsolute(evidencePath),
    evidencePath,
    authoritySettings,
    options: {
      exceptionCount: 0,
      notes: ['Prefilled from the framework draft flow.'],
    },
    rootDir,
  });

  assert.equal(draft.run_id, 'feedback-draft-smoke');
  assert.equal(draft.prefilled_outcome.reviewer_confidence, 'unknown');
  assert.equal(draft.prefilled_measurements.time_to_green_minutes, null);
  assert.equal(draft.governance.protected_standards_touched, true);
  assert.equal(draft.governance.classification, 'unknown');
  assert.equal(draft.governance.human_review_required, false);
  assert.deepEqual(draft.governance.changed_paths, []);
  assert.deepEqual(draft.missing_confirmation_fields, [
    'accepted_without_major_rewrite',
    'required_followup',
    'time_to_green_minutes',
  ]);
});

test('generateStandardsFeedbackRecord accepts programmatic options without CLI array defaults', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-generate-feedback-record-'));
  mkdirp(join(rootDir, '.kontourai/veritas/evidence'));
  mkdirp(join(rootDir, '.veritas/authority'));

  writeFileSync(
    join(rootDir, '.kontourai/veritas/evidence/programmatic-feedback.json'),
    JSON.stringify(readJson('../examples/evidence/work-agent-pass.json'), null, 2),
  );
  writeFileSync(
    join(rootDir, '.veritas/authority/default.authority-settings.json'),
    JSON.stringify(readJson('../examples/standards-feedback/work-agent-authority-settings.json'), null, 2),
  );

  const result = generateStandardsFeedbackRecord(
    {
      rootDir,
      evidencePath: '.kontourai/veritas/evidence/programmatic-feedback.json',
      authoritySettingsPath: '.veritas/authority/default.authority-settings.json',
      acceptedWithoutMajorRewrite: true,
      requiredFollowup: false,
      reviewerConfidence: 'high',
      timeToGreenMinutes: 3,
      exceptionCount: 0,
    },
    { rootDir },
  );

  assert.equal(result.record.run_id, 'work-agent-pass-example');
  assert.equal(result.record.measurements.exception_count, 0);
});

test('working-tree helpers collect staged, unstaged, and untracked files distinctly', () => {
  const rootDir = initCommittedRepo('veritas-working-tree-');
  writeFileSync(join(rootDir, 'tracked.txt'), 'before\n');
  commitAll(rootDir, 'Add tracked file');

  writeFileSync(join(rootDir, 'staged.txt'), 'staged\n');
  execFileSync('git', ['add', 'staged.txt'], { cwd: rootDir, encoding: 'utf8' });
  writeFileSync(join(rootDir, 'tracked.txt'), 'after\n');
  writeFileSync(join(rootDir, 'untracked.txt'), 'untracked\n');

  assert.deepEqual(listWorkingTreeFiles({ staged: true }, rootDir), ['staged.txt']);
  assert.deepEqual(listWorkingTreeFiles({ unstaged: true }, rootDir), ['tracked.txt']);
  assert.deepEqual(listWorkingTreeFiles({ untracked: true }, rootDir), ['untracked.txt']);
  assert.deepEqual(listWorkingTreeFiles({ staged: true, unstaged: true, untracked: true }, rootDir), [
    'staged.txt',
    'tracked.txt',
    'untracked.txt',
  ]);
});

test('report input resolution keeps branch-diff and working-tree modes explicit', () => {
  const rootDir = initCommittedRepo('veritas-report-inputs-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  commitAll(rootDir, 'Add package manifest');

  assert.throws(
    () => resolveReportInputs([], { changedFrom: 'HEAD~1' }, rootDir),
    /requires both --changed-from and --changed-to/,
  );

  const branchInputs = resolveReportInputs(
    [],
    { changedFrom: 'HEAD~1', changedTo: 'HEAD' },
    rootDir,
  );
  assert.equal(branchInputs.sourceKind, 'branch-diff');
  assert.deepEqual(branchInputs.sourceScope, ['changed-from:HEAD~1', 'changed-to:HEAD']);
  assert.equal(branchInputs.sourceRef, 'HEAD~1..HEAD');

  writeFileSync(join(rootDir, 'staged.txt'), 'staged\n');
  execFileSync('git', ['add', 'staged.txt'], { cwd: rootDir, encoding: 'utf8' });
  const workingTreeInputs = resolveReportInputs([], { staged: true }, rootDir);
  assert.equal(workingTreeInputs.sourceKind, 'working-tree');
  assert.deepEqual(workingTreeInputs.sourceScope, ['staged']);
  assert.match(workingTreeInputs.sourceRef, /^working-tree:[a-f0-9]{64}$/);
  assert.deepEqual(workingTreeInputs.files, ['staged.txt']);
});

test('report CLI can measure the full working tree', () => {
  const rootDir = initCommittedRepo('veritas-working-tree-cli-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Working Tree Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  writeFileSync(join(rootDir, 'package.json'), '{\"name\":\"demo\"}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: rootDir, encoding: 'utf8' });
  writeFileSync(join(rootDir, 'README.md'), '# changed\n');
  writeFileSync(join(rootDir, 'notes.txt'), 'untracked\n');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'readiness',
      '--check',
      'evidence',
      '--root',
      rootDir,
      '--working-tree',
      '--format',
      'json',
      '--skip-evidence-check',
      '--run-id',
      'working-tree-smoke',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const readinessResult = parseCliJson(stdout);
  const parsed = readJsonFromAbsolute(join(rootDir, readinessResult.reportArtifactPath));

  assert.equal(typeof readinessResult.reportArtifactPath, 'string');
  assert.equal(parsed.source_kind, 'working-tree');
  assert.deepEqual(parsed.source_scope, ['staged', 'unstaged', 'untracked']);
  assert.deepEqual(parsed.files, ['README.md', 'notes.txt', 'package.json']);
  const readinessInputClaim = parsed.trust.bundle.claims.find((claim) => claim.claimType === 'software-readiness-verdict');
  assert.ok(readinessInputClaim, 'expected readiness verdict claim under trust.bundle.claims');
  assert.equal(['ready', 'not-ready', 'needs-review'].includes(readinessInputClaim.value.verdict), true);
  assert.equal(parsed.trust.report.claims.some((claim) => claim.id === readinessInputClaim.id), true);
  assert.equal(parsed.trust.bundle.generatedAt, undefined);
  assert.ok(readinessInputClaim.metadata.integrity.sourceRef);
});

test('report CLI can emit an empty current-state artifact for a clean working tree', () => {
  const rootDir = initCommittedRepo('veritas-working-tree-clean-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Clean Working Tree Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'readiness',
      '--check',
      'evidence',
      '--root',
      rootDir,
      '--working-tree',
      '--format',
      'json',
      '--skip-evidence-check',
      '--run-id',
      'working-tree-clean-smoke',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const readinessResult = parseCliJson(stdout);
  const parsed = readJsonFromAbsolute(join(rootDir, readinessResult.reportArtifactPath));

  assert.equal(parsed.source_kind, 'working-tree');
  assert.deepEqual(parsed.source_scope, ['staged', 'unstaged', 'untracked']);
  assert.deepEqual(parsed.files, []);
  assert.deepEqual(parsed.components, []);
  assert.deepEqual(parsed.triggered_evidence_checks, []);
});

test('readiness CLI emits the canonical trust bundle for Flow Kit gates', () => {
  const rootDir = initCommittedRepo('veritas-trust-bundle-cli-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Trust Bundle Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'readiness',
      '--check',
      'evidence',
      '--root',
      rootDir,
      '--working-tree',
      '--format',
      'trust-bundle',
      '--skip-evidence-check',
      '--run-id',
      'trust-bundle-smoke',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const bundle = parseCliJson(stdout);
  const readinessClaim = bundle.claims.find(
    (claim) => claim.claimType === 'software-readiness-verdict',
  );

  assert.equal(bundle.schemaVersion, 5);
  assert.ok(readinessClaim, 'expected canonical software-readiness-verdict claim');
  assert.equal(readinessClaim.subjectType, 'repository-change');
  assert.equal(readinessClaim.status, 'verified');
});

test('report CLI preserves branch-diff behavior', () => {
  const rootDir = initCommittedRepo('veritas-branch-diff-cli-');
  writeBootstrapStarterKit({ rootDir, projectName: 'Branch Diff Demo' });
  commitAll(rootDir, 'Bootstrap starter kit');

  writeFileSync(join(rootDir, 'package.json'), '{\"name\":\"demo\"}\n');

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'readiness',
      '--check',
      'evidence',
      '--root',
      rootDir,
      '--changed-from',
      'HEAD~1',
      '--changed-to',
      'HEAD',
      '--format',
      'json',
      '--skip-evidence-check',
      '--run-id',
      'branch-diff-smoke',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const readinessResult = parseCliJson(stdout);
  const parsed = readJsonFromAbsolute(join(rootDir, readinessResult.reportArtifactPath));

  assert.equal(parsed.source_kind, 'branch-diff');
  assert.deepEqual(parsed.source_scope, ['changed-from:HEAD~1', 'changed-to:HEAD']);
  assert.deepEqual(parsed.files, [
    '.gitignore',
    '.veritas/GOVERNANCE.md',
    '.veritas/README.md',
    '.veritas/authority/default.authority-settings.json',
    '.veritas/repo-map.json',
    '.veritas/repo-standards/default.repo-standards.json',
    'veritas.claims.json',
  ]);
});

test('report writes one trimmed Surface claim input per claim', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-claim-inputs-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  const repoMapPath = writeTempRepoMap(rootDir, {
    name: 'claim-input-demo',
    kind: 'repo-map',
    policy: {
      defaultFalsePositiveReview: 'unknown',
      defaultPromotionCandidate: false,
      defaultExceptionAllowed: false,
    },
    graph: {
      version: 1,
      defaultResolution: {
        phase: 'Phase 0',
        workstream: 'Demo',
        matchedArtifacts: ['package.json'],
      },
      nonSliceableInvariants: [],
      resolverPrecedence: ['explicit'],
      nodes: [
        { id: 'root.manifest', kind: 'tooling-area', label: 'package.json', patterns: ['package.json'] },
      ],
    },
    evidence: {
      artifactDir: '.kontourai/veritas/evidence',
      reportTransport: 'local-json',
      evidenceChecks: [
        { id: 'unit', command: 'npm test', method: 'validation' },
      ],
      defaultEvidenceCheckIds: ['unit'],
      uncoveredPathPolicy: 'warn',
    },
  });
  const repoStandardsPath = writeTempJson(rootDir, '.veritas-repo-standards.json', {
    name: 'claim-input-policy',
    version: 1,
    rules: [
      {
        id: 'package-json-required',
        kind: 'required-artifacts',
        classification: 'hard-invariant',
        enforcementLevel: 'Require',
        message: 'package.json is required.',
        match: { artifacts: ['package.json'] },
      },
    ],
  });
  writeClaimStoreForRepoMap(
    rootDir,
    readJsonFromAbsolute(repoMapPath),
    readJsonFromAbsolute(repoStandardsPath),
  );

  const result = await generateVeritasReport({
    rootDir,
    repoMapPath,
    repoStandardsPath,
    runId: 'claim-input-smoke',
    sourceRef: 'test-source-ref',
  }, {}, ['package.json']);

  assert.equal(result.claimInputPaths.length, result.record.trust.bundle.claims.length);
  assert.match(result.consoleReadModelPath, /^\.kontourai\/veritas\/surface\/claim-input-smoke\.console\.json$/);
  const console = readJsonFromAbsolute(join(rootDir, result.consoleReadModelPath));
  assert.equal(console.kind, 'surface-console-read-model');
  assert.equal(console.source, 'veritas:claim-input-smoke');
  assert.equal(console.producer.evidenceArtifactPath, result.artifactPath);
  assert.deepEqual(console.producer.claimInputPaths, result.claimInputPaths);
  assert.equal(console.summary.claimCount, result.record.trust.bundle.claims.length);
  assert.equal(console.contract, 'surface.analytics-compatible');
  assert.equal(console.analytics.reportId, result.record.trust.report.id);
  assert.equal(console.analytics.totals.claims, result.record.trust.bundle.claims.length);
  assert.ok(Array.isArray(console.analytics.coverageByFacet));
  assert.ok(Array.isArray(console.analytics.actionQueues.reviewNow));
  assert.equal(console.claims.length, result.record.trust.bundle.claims.length);
  assert.ok(console.claims.every((claim) => claim.status));
  assert.ok(console.policies.some((policy) => policy.id === 'veritas.policy-result'));
  assert.ok(console.graph.nodes.some((node) => node.kind === 'claim'));
  assert.ok(console.graph.edges.some((edge) => edge.kind === 'supports'));
  const consoleIndex = readJsonFromAbsolute(join(rootDir, '.kontourai/veritas/surface/latest.json'));
  assert.equal(consoleIndex.latestRunId, 'claim-input-smoke');
  assert.equal(consoleIndex.readModelPath, result.consoleReadModelPath);
  for (const relativePath of result.claimInputPaths) {
    const claimInput = readJsonFromAbsolute(join(rootDir, relativePath));
    const fileName = relativePath.split('/').at(-1);
    assert.equal(fileName, `${claimInput.claim.id.replace(/[^A-Za-z0-9._-]+/g, '-')}.input.json`);
    assert.ok(claimInput.evidence.every((item) => item.claimId === claimInput.claim.id));
    assert.ok(claimInput.events.every((item) => item.claimId === claimInput.claim.id));
    assert.equal('claims' in claimInput, false);
    assert.equal('summary' in claimInput, false);
  }
});

test('surface.config.json readModelPath points at the shared runtime location the console writer actually writes', () => {
  // Regression guard: writeSurfaceConsoleReadModel writes its index to
  // .kontourai/veritas/surface/latest.json (CONSOLE_DIR + 'latest.json'), the same file the
  // claim-input-smoke test reads above. The `surface console` reader consumes
  // surface.config.json#readModelPath, so it must point at that exact file —
  // previously it referenced .veritas/surface-console/latest.json, which nothing
  // writes, leaving `npm run veritas:console` reading a non-existent read-model.
  const configPath = fileURLToPath(new URL('../surface.config.json', import.meta.url));
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.readModelPath, '.kontourai/veritas/surface/latest.json');
});

test('report rejects run ids that would escape output directories', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-unsafe-run-id-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  const repoMapPath = writeTempRepoMap(rootDir, {
    graph: {
      defaultResolution: {
        phase: 'Phase 0',
        workstream: 'Demo',
        matchedArtifacts: ['package.json'],
      },
      nodes: [
        { id: 'root.manifest', kind: 'tooling-area', label: 'package.json', patterns: ['package.json'] },
      ],
    },
    evidence: {
      artifactDir: '.kontourai/veritas/evidence',
      reportTransport: 'local-json',
      evidenceChecks: [
        { id: 'unit', command: 'npm test', method: 'validation' },
      ],
    },
  });
  const repoStandardsPath = writeTempJson(rootDir, '.veritas-repo-standards.json', {
    name: 'unsafe-run-id-policy',
    version: 1,
    rules: [],
  });
  writeClaimStoreForRepoMap(
    rootDir,
    readJsonFromAbsolute(repoMapPath),
    readJsonFromAbsolute(repoStandardsPath),
  );

  await assert.rejects(
    () => generateVeritasReport({
      rootDir,
      repoMapPath,
      repoStandardsPath,
      runId: '../../outside',
      sourceRef: 'unsafe-run-id',
    }, {}, ['package.json']),
    /Veritas evidence run id may only contain letters, numbers, dot, underscore, and hyphen/,
  );
  assert.equal(existsSync(join(rootDir, 'outside.json')), false);
});

test('standards feedback record CLI writes a repo-local observe standards feedback artifact from report output', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Feedback Demo',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const reportResult = await generateReportCliResult(rootDir, 'feedback-cli-smoke');

  const feedbackStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'record',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
      '--accepted-without-major-rewrite',
      'true',
      '--required-followup',
      'false',
      '--reviewer-confidence',
      'high',
      '--time-to-green-minutes',
      '14',
      '--exception-count',
      '0',
      '--note',
      'The evidence artifact was enough for a quick review.',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const standardsFeedbackResult = JSON.parse(feedbackStdout);
  const feedbackArtifact = readJsonFromAbsolute(join(rootDir, standardsFeedbackResult.artifactPath));

  assert.equal(standardsFeedbackResult.artifactPath, '.kontourai/veritas/standards-feedback/feedback-cli-smoke.json');
  assert.equal(standardsFeedbackResult.run_id, 'feedback-cli-smoke');
  assert.equal(standardsFeedbackResult.authority_settings_id, 'feedback-demo-default');
  assert.equal(standardsFeedbackResult.mode, 'observe');
  assert.equal(standardsFeedbackResult.evidence.artifact_path, reportResult.artifactPath);
  assert.match(standardsFeedbackResult.evidence.artifact_digest, /^[a-f0-9]{64}$/);
  assert.equal(feedbackArtifact.outcome.reviewer_confidence, 'high');
  assert.deepEqual(feedbackArtifact.notes, [
    'The evidence artifact was enough for a quick review.',
  ]);
});

test('standards feedback draft CLI writes a repo-local draft artifact and suggested next step', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-draft-cli-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Standards Feedback Draft Demo',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const reportResult = await generateReportCliResult(rootDir, 'feedback-draft-cli-smoke');

  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);
  const draftArtifact = readJsonFromAbsolute(join(rootDir, draftResult.artifactPath));

  assert.equal(draftResult.artifactPath, '.kontourai/veritas/standards-feedback-drafts/feedback-draft-cli-smoke.json');
  assert.match(draftResult.suggestedRecordCommand, /veritas feedback record --draft/);
  assert.deepEqual(draftArtifact.missing_confirmation_fields, [
    'accepted_without_major_rewrite',
    'required_followup',
    'time_to_green_minutes',
  ]);
});

test('standards feedback record CLI can consume a draft artifact', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-record-from-draft-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Standards Feedback Draft Demo',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const reportResult = await generateReportCliResult(rootDir, 'feedback-record-draft-smoke');

  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
      '--exception-count',
      '1',
      '--note',
      'Draft-first flow.',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);

  const feedbackStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'record',
      '--root',
      rootDir,
      '--draft',
      draftResult.artifactPath,
      '--accepted-without-major-rewrite',
      'true',
      '--required-followup',
      'false',
      '--time-to-green-minutes',
      '9',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const standardsFeedbackResult = JSON.parse(feedbackStdout);

  assert.equal(standardsFeedbackResult.evidence.artifact_path, reportResult.artifactPath);
  assert.equal(standardsFeedbackResult.measurements.exception_count, 1);
  assert.deepEqual(standardsFeedbackResult.notes, ['Draft-first flow.']);
  assert.equal(standardsFeedbackResult.outcome.accepted_without_major_rewrite, true);
  assert.equal(standardsFeedbackResult.measurements.time_to_green_minutes, 9);
});

test('standards feedback record CLI rejects draft artifacts outside the repo-local draft area', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-record-external-draft-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Standards Feedback External Draft Demo',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const reportResult = await generateReportCliResult(rootDir, 'feedback-record-external-draft-smoke');
  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);
  const externalDraftPath = join(tmpdir(), 'external-feedback-draft.json');
  writeFileSync(
    externalDraftPath,
    JSON.stringify(readJsonFromAbsolute(join(rootDir, draftResult.artifactPath)), null, 2),
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'feedback',
          'record',
          '--root',
          rootDir,
          '--draft',
          externalDraftPath,
          '--accepted-without-major-rewrite',
          'true',
          '--required-followup',
          'false',
          '--time-to-green-minutes',
          '9',
        ],
        { cwd: repoRootDir, encoding: 'utf8' },
      ),
    /repo-local draft artifact inside \.kontourai\/veritas\/standards-feedback-drafts/,
  );
});

test('standards feedback draft CLI rejects symlinked external evidence under a repo-local path', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-draft-symlink-evidence-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Standards Feedback Draft Symlink Evidence Demo' });

  const externalEvidencePath = join(tmpdir(), 'external-symlink-evidence.json');
  writeFileSync(
    externalEvidencePath,
    JSON.stringify(readJson('../examples/evidence/work-agent-pass.json'), null, 2),
  );
  mkdirp(join(rootDir, '.kontourai/veritas/evidence'));
  symlinkSync(
    externalEvidencePath,
    join(rootDir, '.kontourai/veritas/evidence/symlinked-evidence.json'),
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'feedback',
          'draft',
          '--root',
          rootDir,
          '--evidence',
          '.kontourai/veritas/evidence/symlinked-evidence.json',
        ],
        { cwd: repoRootDir, encoding: 'utf8' },
      ),
    /repo-local evidence artifact inside \.kontourai\/veritas\/evidence/,
  );
});

test('standards feedback record CLI rejects draft/authority-settings rebinding', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-record-draft-profile-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Standards Feedback Draft Profile Demo',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const altAuthoritySettingsPath = join(rootDir, '.veritas/authority/alt.authority-settings.json');
  writeFileSync(
    altAuthoritySettingsPath,
    JSON.stringify(
      {
        version: 1,
        id: 'alt-team',
        name: 'Alt Team',
        description: 'Alt scale',
        defaults: { mode: 'observe', new_rule_enforcement_level: 'Observe' },
        review_preferences: {
          human_signoff_required_for_stage_promotion: true,
          reviewer_confidence_scale: ['red', 'yellow', 'green'],
          major_rewrite_definition: 'Alt',
        },
        promotion_preferences: {
          evidence_checks_required_before_require: ['npm test'],
          warnings_block_in_ci: false,
          require_consistent_feedback_before_promotion: true,
        },
      },
      null,
      2,
    ),
  );

  const reportResult = await generateReportCliResult(rootDir, 'feedback-record-draft-profile-smoke');
  const draftStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'draft',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const draftResult = JSON.parse(draftStdout);

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'feedback',
          'record',
          '--root',
          rootDir,
          '--draft',
          draftResult.artifactPath,
          '--authority-settings',
          '.veritas/authority/alt.authority-settings.json',
          '--accepted-without-major-rewrite',
          'true',
          '--required-followup',
          'false',
          '--time-to-green-minutes',
          '9',
        ],
        { cwd: repoRootDir, encoding: 'utf8' },
      ),
    /must be completed with the same authority settings/,
  );
});

test('standards feedback record CLI supports explicit authority-settings and output paths', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-cli-explicit-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  const initResult = writeBootstrapStarterKit({ rootDir, projectName: 'Feedback Explicit Demo' });

  const reportResult = await generateReportCliResult(rootDir, 'feedback-cli-explicit-smoke');

  const feedbackStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'record',
      '--root',
      rootDir,
      '--evidence',
      reportResult.artifactPath,
      '--authority-settings',
      initResult.generatedFiles.find((path) => path.endsWith('default.authority-settings.json')),
      '--output',
      '.kontourai/veritas/standards-feedback/custom-observe.json',
      '--accepted-without-major-rewrite',
      'false',
      '--required-followup',
      'true',
      '--reviewer-confidence',
      'unknown',
      '--time-to-green-minutes',
      '25',
      '--exception-count',
      '2',
      '--false-positive-rule',
      'required-veritas-artifacts',
      '--missed-issue',
      'Return-package assembly still needed manual review.',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const standardsFeedbackResult = JSON.parse(feedbackStdout);

  assert.equal(standardsFeedbackResult.artifactPath, '.kontourai/veritas/standards-feedback/custom-observe.json');
  assert.equal(standardsFeedbackResult.outcome.accepted_without_major_rewrite, false);
  assert.equal(standardsFeedbackResult.outcome.required_followup, true);
  assert.equal(standardsFeedbackResult.outcome.reviewer_confidence, 'unknown');
  assert.deepEqual(standardsFeedbackResult.measurements.false_positive_rules, [
    'required-veritas-artifacts',
  ]);
  assert.deepEqual(standardsFeedbackResult.measurements.missed_issues, [
    'Return-package assembly still needed manual review.',
  ]);
  assert.equal(standardsFeedbackResult.historyPath, '.kontourai/veritas/standards-feedback/history.jsonl');
  const historyLine = JSON.parse(
    readFileSync(join(rootDir, '.kontourai/veritas/standards-feedback/history.jsonl'), 'utf8').trim(),
  );
  assert.equal(historyLine.run_id, 'feedback-cli-explicit-smoke');
  assert.equal(historyLine.accepted, false);
  assert.equal(historyLine.exception_count, 2);

  const summary = generateStandardsFeedbackSummary({ rootDir });
  assert.equal(summary.total, 1);
  assert.equal(summary.requiredRewrite, 1);
  assert.equal(summary.mostFlaggedRule.rule_id, 'required-veritas-artifacts');
  assert.match(summary.markdownSummary, /Last 1 standards-feedback: 0 accepted, 1 required rewrite/);
});

test('standards feedback summary and trend CLI report rule trends', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-trend-'));
  mkdirp(join(rootDir, '.kontourai/veritas/standards-feedback'));
  const records = [
    {
      run_id: 'run-1',
      accepted: false,
      policy_results: [
        { rule_id: 'r-a', passed: true },
        { rule_id: 'r-b', passed: false },
      ],
    },
    {
      run_id: 'run-2',
      accepted: false,
      policy_results: [
        { rule_id: 'r-a', passed: true },
        { rule_id: 'r-b', passed: false },
      ],
    },
    {
      run_id: 'run-3',
      accepted: true,
      policy_results: [
        { rule_id: 'r-a', passed: true },
        { rule_id: 'r-b', passed: true },
      ],
    },
  ];
  writeFileSync(
    join(rootDir, '.kontourai/veritas/standards-feedback/history.jsonl'),
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );

  const summary = generateStandardsFeedbackSummary({ rootDir });
  assert.ok(summary.ruleTrend.length >= 2);
  const ruleB = summary.ruleTrend.find((rule) => rule.rule_id === 'r-b');
  assert.ok(ruleB);
  assert.ok(ruleB.pass_rate < 1);
  assert.equal(Number.isFinite(ruleB.mttr_runs), true);
  assert.equal(ruleB.sparkline.length, 3);

  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, ...args) => {
    output += String(chunk);
    if (typeof args.at(-1) === 'function') args.at(-1)();
    return true;
  };
  try {
    runVeritasReportCli(['--trend', '--root', rootDir]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.match(output, /Worst 3 rules:/);
  assert.match(output, /r-b/);
});

test('standards feedback record CLI rejects evidence outside the repo-local evidence area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-cli-invalid-evidence-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Feedback Invalid Evidence Demo' });
  mkdirp(join(rootDir, 'tmp'));
  writeFileSync(
    join(rootDir, 'tmp/not-evidence.json'),
    JSON.stringify(
      {
        run_id: 'bad-evidence',
      },
      null,
      2,
    ),
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
          'feedback',
          'record',
          '--root',
          rootDir,
          '--evidence',
          'tmp/not-evidence.json',
          '--accepted-without-major-rewrite',
          'true',
          '--required-followup',
          'false',
          '--reviewer-confidence',
          'unknown',
          '--time-to-green-minutes',
          '5',
          '--exception-count',
          '0',
        ],
        { cwd: repoRootDir, encoding: 'utf8' },
      ),
    /repo-local evidence artifact inside \.kontourai\/veritas\/evidence/,
  );
});

test('standards feedback record CLI refuses to overwrite an existing standards feedback artifact without force', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-feedback-cli-overwrite-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Feedback Overwrite Demo' });

  const reportResult = await generateReportCliResult(rootDir, 'feedback-cli-overwrite-smoke');
  const baseArgs = [
    'exec',
    '--',
    'veritas',
    'feedback',
    'record',
    '--root',
    rootDir,
    '--evidence',
    reportResult.artifactPath,
    '--accepted-without-major-rewrite',
    'true',
    '--required-followup',
    'false',
    '--reviewer-confidence',
    'unknown',
    '--time-to-green-minutes',
    '5',
    '--exception-count',
    '0',
  ];

  execFileSync('npm', baseArgs, { cwd: repoRootDir, encoding: 'utf8' });
  assert.throws(
    () => execFileSync('npm', baseArgs, { cwd: repoRootDir, encoding: 'utf8' }),
    /Refusing to overwrite existing file/,
  );
  execFileSync('npm', [...baseArgs, '--force'], {
    cwd: repoRootDir,
    encoding: 'utf8',
  });
});

test('readiness check CLI stops at report and draft when judgment fields are missing', () => {
  const rootDir = initCommittedRepo('veritas-readiness-check-draft-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Check Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'readiness', '--format', 'json', '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.mode, 'report-and-draft');
  assert.equal(parsed.evidenceCheckRan, true);
  assert.deepEqual(parsed.evidenceCheckLabels, ['node -e "process.exit(0)"']);
  assert.match(parsed.suggestedFeedbackCommand, /veritas feedback record --draft/);
});

test('readiness check CLI defaults to agent-readable feedback output', () => {
  const rootDir = initCommittedRepo('veritas-readiness-check-feedback-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Check Feedback Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'readiness', '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  assert.match(stdout, /^veritas: /);
  assert.match(stdout, /PASS\s+evidence-check/);
  assert.match(stdout, /report: \.kontourai\/veritas\/evidence\//);
  assert.match(stdout, /standards feedback draft: \.kontourai\/veritas\/standards-feedback-drafts\//);
});

test('readiness keeps default projections ignored and retains an explicit requested copy', () => {
  const rootDir = initCommittedRepo('veritas-readiness-clean-projection-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  execFileSync('npm', [
    'exec', '--', 'veritas', 'init', '--root', rootDir,
    '--project-name', 'Clean Projection Demo', '--evidence-check', 'node -e "process.exit(0)"',
  ], { cwd: repoRootDir, encoding: 'utf8' });
  execGitFixture(['add', '.'], { cwd: rootDir, encoding: 'utf8' });
  execGitFixture(['commit', '-m', 'Initialize governance'], { cwd: rootDir, encoding: 'utf8' });

  execFileSync('npm', ['exec', '--', 'veritas', 'readiness', '--root', rootDir], {
    cwd: repoRootDir, encoding: 'utf8',
  });
  assert.equal(execGitFixture(['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' }), '');

  const output = parseCliJson(execFileSync('npm', [
    'exec', '--', 'veritas', 'readiness', '--format', 'json', '--root', rootDir,
    '--projection-output', 'artifacts/readiness-projection.json',
  ], { cwd: repoRootDir, encoding: 'utf8' }));
  assert.equal(output.projectionOutputPath, 'artifacts/readiness-projection.json');
  assert.equal(readJsonFromAbsolute(join(rootDir, output.projectionOutputPath)).kind, 'surface-console-read-model');
  assert.equal(execGitFixture(['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' }), '?? artifacts/\n');

  assert.throws(() => execFileSync('npm', [
    'exec', '--', 'veritas', 'readiness', '--root', rootDir,
    '--projection-output', 'artifacts/readiness-projection.json',
  ], { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' }), /Refusing to overwrite existing projection output/);

  execFileSync('npm', [
    'exec', '--', 'veritas', 'readiness', '--root', rootDir, '--force',
    '--projection-output', 'artifacts/readiness-projection.json',
  ], { cwd: repoRootDir, encoding: 'utf8' });

  assert.throws(() => execFileSync('npm', [
    'exec', '--', 'veritas', 'readiness', '--root', rootDir,
    '--projection-output', '../escaped-projection.json',
  ], { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' }), /must stay inside the target repository/);
});

test('readiness check reports primitive-first governance findings as policy results', () => {
  const rootDir = initCommittedRepo('veritas-readiness-primitive-first-');
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({
    scripts: {
      'governance:check': 'node scripts/check-governance.js',
    },
  }, null, 2)}\n`);

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Primitive First Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const policyPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const repoStandards = readJsonFromAbsolute(policyPath);
  repoStandards.rules.push({
    id: 'repeatable-governance-uses-veritas-primitives',
    kind: 'primitive-first-governance',
    classification: 'promotable-policy',
    enforcementLevel: 'Guide',
    message: 'Repeatable governance checks should use Veritas primitives.',
    owner: 'test',
    rollback_switch: null,
    explain: {
      summary: 'Route repeatable governance through Veritas primitives.',
      mustDo: ['Add a Repo Map Evidence Check or Repo Standards Requirement.'],
      mustNotDo: ['Do not hide repo governance in a helper script.'],
    },
    match: {
      packageScripts: {
        file: 'package.json',
        namePatterns: ['^(quality|governance)(:|$)'],
        commandPatterns: ['check-governance'],
        helperExemptions: [],
      },
    },
  });
  writeFileSync(policyPath, `${JSON.stringify(repoStandards, null, 2)}\n`);

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'readiness',
      '--root',
      rootDir,
      '--working-tree',
      '--skip-evidence-check',
      '--run-id',
      'primitive-first-feedback',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  assert.match(stdout, /WARN\s+repeatable-governance-uses-veritas-primitives:/);
  assert.match(stdout, /package\.json/);

  const reportPathMatch = stdout.match(/report: (\.kontourai\/veritas\/evidence\/[^\s]+)/);
  assert.ok(reportPathMatch);
  const reportPath = join(rootDir, reportPathMatch[1]);
  const record = readJsonFromAbsolute(reportPath);
  const result = record.policy_results.find(
    (policyResult) =>
      policyResult.rule_id === 'repeatable-governance-uses-veritas-primitives',
  );
  assert.equal(result.passed, false);
  assert.equal(result.enforcementLevel, 'Guide');
  assert.equal(result.findings[0].kind, 'primitive-first-governance');
  assert.equal(result.findings[0].package_script, 'governance:check');
  assert.equal(result.findings[0].command, 'node scripts/check-governance.js');
  assert.equal(result.findings[0].required_primitives[0].kind, 'evidence-check');
  assert.equal(result.findings[0].required_primitives[0].command, 'npm run governance:check');
});

test('readiness check CLI can complete the full draft-and-record path', () => {
  const rootDir = initCommittedRepo('veritas-readiness-check-record-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Check Record Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'readiness',
      '--format',
      'json',
      '--root',
      rootDir,
      '--accepted-without-major-rewrite',
      'true',
      '--required-followup',
      'false',
      '--time-to-green-minutes',
      '7',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.mode, 'report-draft-and-feedback');
  assert.equal(parsed.feedbackMode, 'observe');
  assert.equal(parsed.evidenceCheckRan, true);
  assert.deepEqual(parsed.evidenceCheckLabels, ['node -e "process.exit(0)"']);
});

test('readiness check records run history and reuses fail-to-pass time to green', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-run-history-'));
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeBootstrapStarterKit({ rootDir, projectName: 'Run History Demo', evidenceCheck: 'node -e process.exit(0)' });
  execFileSync('git', ['init'], { cwd: rootDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'veritas@example.com'], { cwd: rootDir });
  execFileSync('git', ['config', 'user.name', 'Veritas Test'], { cwd: rootDir });
  execFileSync('git', ['add', '.'], { cwd: rootDir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: rootDir, stdio: 'ignore' });
  const policyPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const repoStandards = readJsonFromAbsolute(policyPath);
  repoStandards.rules.push({
    id: 'requires-fix-marker',
    kind: 'required-artifacts',
    classification: 'promotable-policy',
    enforcementLevel: 'Require',
    message: 'A fix marker must exist for the run-history smoke test.',
    owner: 'test',
    rollback_switch: null,
    match: { artifacts: ['fix-marker.txt'] },
  });
  writeFileSync(policyPath, `${JSON.stringify(repoStandards, null, 2)}\n`);

  assert.throws(() =>
    execFileSync(
      'npm',
      [
        'exec',
        '--',
        'veritas',
      'readiness',
        '--root',
        rootDir,
        '--skip-evidence-check',
        '--working-tree',
        '--run-id',
        'run-history-fail',
      ],
      { cwd: repoRootDir, encoding: 'utf8', stdio: 'pipe' },
    ),
  );
  const historyPath = join(rootDir, '.kontourai/veritas/runs/history.jsonl');
  const firstHistory = readFileSync(historyPath, 'utf8');
  assert.match(firstHistory, /run-history-fail/);
  writeFileSync(join(rootDir, 'fix-marker.txt'), 'fixed\n');

  const passStdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'readiness',
      '--root',
      rootDir,
      '--skip-evidence-check',
      '--working-tree',
      '--run-id',
      'run-history-pass',
      '--skip-evidence-check',
      '--format',
      'json',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const passResult = parseCliJson(passStdout);
  const draft = readJsonFromAbsolute(join(rootDir, passResult.draftArtifactPath));

  assert.equal(typeof draft.prefilled_measurements.time_to_green_minutes, 'number');
});

test('readiness check JSON mode reports evidenceCheck failures as run failures', () => {
  const rootDir = initCommittedRepo('veritas-readiness-check-json-evidenceCheck-failure-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Check JSON Evidence Check Failure Demo',
      '--evidence-check',
      'node -e "process.exit(3)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        ['exec', '--', 'veritas', 'readiness', '--format', 'json', '--root', rootDir],
        { cwd: repoRootDir, encoding: 'utf8' },
      ),
    (error) => {
      assert.equal(error.status, 1);
      const parsed = parseCliJson(error.stdout.toString());
      assert.equal(parsed.evidenceCheckFailure.label, 'node -e "process.exit(3)"');
      assert.equal(parsed.evidenceCheckRan, true);
      return true;
    },
  );
});

test('marker benchmark comparison scores timely surfacing and false positives', () => {
  const scenario = {
    version: 1,
    id: 'migration-marker',
    title: 'Migration marker surfaces on the first relevant response',
    marker: {
      id: 'must-mention-data-migration',
      required_phrases: ['data migration', 'run a migration'],
    },
    scoring: {
      trigger_tag: 'marker-trigger',
      response_tag: 'marker-response-window',
      max_assistant_turns_after_trigger: 1,
      allow_early: false,
    },
  };

  const comparison = compareMarkerBenchmarkRuns({
    scenario,
    withoutVeritas: {
      version: 1,
      benchmark_id: 'migration-marker',
      run_id: 'without-veritas-run',
      condition_id: 'without-veritas',
      turns: [
        { role: 'user', content: 'Open the repo and inspect the task.' },
        { role: 'assistant', content: 'A data migration is probably required here.' },
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        {
          role: 'assistant',
          content: 'I will update the code path first.',
          tags: ['marker-response-window'],
        },
        { role: 'assistant', content: 'Also, run a migration before shipping this.' },
      ],
    },
    withVeritas: {
      version: 1,
      benchmark_id: 'migration-marker',
      run_id: 'with-veritas-run',
      condition_id: 'with-veritas',
      turns: [
        { role: 'user', content: 'Open the repo and inspect the task.' },
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        {
          role: 'assistant',
          content: 'This change needs a data migration before the code lands.',
          tags: ['marker-response-window'],
        },
      ],
    },
  });

  assert.equal(comparison.conditions.without_veritas.pass, false);
  assert.equal(comparison.conditions.without_veritas.false_positive, true);
  assert.equal(comparison.conditions.without_veritas.timely, false);
  assert.equal(comparison.conditions.with_veritas.pass, true);
  assert.equal(comparison.conditions.with_veritas.timely, true);
  assert.equal(comparison.conditions.with_veritas.assistant_turn_latency, 1);
  assert.equal(comparison.comparison.timely_recall_delta, 1);
  assert.equal(comparison.comparison.false_positive_improvement, 1);
  assert.equal(comparison.comparison.treatment_beats_baseline, true);
});

test('marker benchmark response tags do not widen the assistant-turn deadline', () => {
  const result = compareMarkerBenchmarkRuns({
    scenario: {
      version: 1,
      id: 'strict-response-window',
      title: 'Response tag stays stricter than the assistant-turn deadline',
      marker: {
        id: 'must-mention-data-migration',
        required_phrases: ['data migration'],
      },
      scoring: {
        trigger_tag: 'marker-trigger',
        response_tag: 'marker-response-window',
        max_assistant_turns_after_trigger: 1,
        allow_early: false,
      },
    },
    withoutVeritas: {
      version: 1,
      benchmark_id: 'strict-response-window',
      run_id: 'baseline',
      condition_id: 'without-veritas',
      turns: [
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        { role: 'assistant', content: 'Investigating.' },
        { role: 'assistant', content: 'Still conformanceg.' },
        { role: 'assistant', content: 'This needs a data migration.' },
        {
          role: 'assistant',
          content: 'Final tagged response window.',
          tags: ['marker-response-window'],
        },
      ],
    },
    withVeritas: {
      version: 1,
      benchmark_id: 'strict-response-window',
      run_id: 'treatment',
      condition_id: 'with-veritas',
      turns: [
        { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
        {
          role: 'assistant',
          content: 'This needs a data migration.',
          tags: ['marker-response-window'],
        },
      ],
    },
  });

  assert.equal(result.conditions.without_veritas.assistant_turn_latency, 3);
  assert.equal(result.conditions.without_veritas.first_response_window_turn, 5);
  assert.equal(result.conditions.without_veritas.timely, false);
  assert.equal(result.conditions.without_veritas.pass, false);
  assert.equal(result.conditions.with_veritas.timely, true);
});

test('marker benchmark comparison treats latency-only wins as improvement', () => {
  const result = compareMarkerBenchmarkRuns({
    scenario: {
      version: 1,
      id: 'latency-marker',
      title: 'Latency-only improvement still counts as improvement',
      marker: {
        id: 'must-mention-regression-test',
        required_phrases: ['regression test'],
      },
      scoring: {
        trigger_tag: 'marker-trigger',
        max_assistant_turns_after_trigger: 2,
        allow_early: false,
      },
    },
    withoutVeritas: {
      version: 1,
      benchmark_id: 'latency-marker',
      run_id: 'baseline-latency',
      condition_id: 'without-veritas',
      turns: [
        { role: 'tool', content: 'tests/api.spec.ts changed', tags: ['marker-trigger'] },
        { role: 'assistant', content: 'Investigating.' },
        { role: 'assistant', content: 'Add a regression test.' },
      ],
    },
    withVeritas: {
      version: 1,
      benchmark_id: 'latency-marker',
      run_id: 'treatment-latency',
      condition_id: 'with-veritas',
      turns: [
        { role: 'tool', content: 'tests/api.spec.ts changed', tags: ['marker-trigger'] },
        { role: 'assistant', content: 'Add a regression test.' },
      ],
    },
  });

  assert.equal(result.conditions.without_veritas.pass, true);
  assert.equal(result.conditions.with_veritas.pass, true);
  assert.equal(result.comparison.latency_improvement_turns, 1);
  assert.equal(result.comparison.treatment_beats_baseline, true);
});

test('feedback marker CLI compares without-veritas and with-veritas session logs', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-marker-benchmark-'));
  const scenarioPath = writeTempJson(rootDir, 'scenario.json', {
    version: 1,
    id: 'migration-marker',
    title: 'Migration marker surfaces on the first relevant response',
    marker: {
      id: 'must-mention-data-migration',
      required_phrases: ['data migration', 'run a migration'],
    },
    scoring: {
      trigger_tag: 'marker-trigger',
      response_tag: 'marker-response-window',
      max_assistant_turns_after_trigger: 1,
      allow_early: false,
    },
  });
  const withoutPath = writeTempJson(rootDir, 'without.json', {
    version: 1,
    benchmark_id: 'migration-marker',
    run_id: 'without-run',
    condition_id: 'without-veritas',
    turns: [
      { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
      {
        role: 'assistant',
        content: 'I will patch the code first.',
        tags: ['marker-response-window'],
      },
    ],
  });
  const withPath = writeTempJson(rootDir, 'with.json', {
    version: 1,
    benchmark_id: 'migration-marker',
    run_id: 'with-run',
    condition_id: 'with-veritas',
    turns: [
      { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
      {
        role: 'assistant',
        content: 'This change needs a data migration before release.',
        tags: ['marker-response-window'],
      },
    ],
  });

  const stdout = execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'feedback',
      'marker',
      '--scenario',
      scenarioPath,
      '--without-veritas-session-log',
      withoutPath,
      '--with-veritas-session-log',
      withPath,
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.benchmark_id, 'migration-marker');
  assert.equal(parsed.conditions.without_veritas.pass, false);
  assert.equal(parsed.conditions.with_veritas.pass, true);
  assert.equal(parsed.comparison.timely_recall_delta, 1);

  const helperResult = generateMarkerBenchmarkComparison({
    scenarioPath,
    withoutVeritasSessionLogPath: withoutPath,
    withVeritasSessionLogPath: withPath,
  });
  assert.equal(helperResult.comparison.treatment_beats_baseline, true);
});

test('feedback marker-suite CLI returns aggregate benchmark metrics', () => {
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'feedback', 'marker-suite', '--suite', 'examples/benchmarks/suites/context-surfacing-suite.json'],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.suite_id, 'context-surfacing-suite');
  assert.equal(parsed.scenario_count, 6);
  assert.equal(parsed.pair_count, 8);
  assert.equal(parsed.metrics.treatment_pass_rate, 7 / 8);
  assert.equal(parsed.metrics.pass_at_1, 1);
  assert.equal(parsed.metrics.pass_pow_k, 5 / 6);

  const helperResult = generateMarkerBenchmarkSuiteReport({
    suitePath: 'examples/benchmarks/suites/context-surfacing-suite.json',
  });
  assert.equal(helperResult.metrics.improvement_rate, 7 / 8);
});

test('feedback marker-suite rejects artifact paths outside the benchmark directory', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-marker-suite-paths-'));
  mkdirp(join(rootDir, 'suite'));
  writeFileSync(
    join(rootDir, 'suite/suite.json'),
    JSON.stringify({
      version: 1,
      id: 'unsafe-suite',
      title: 'Unsafe suite',
      benchmarks: [
        {
          benchmark_id: 'unsafe-marker',
          title: 'Unsafe marker',
          marker_class: 'safety',
          repo_surface: 'tests',
          scenario_path: '../../scenario.json',
          trials: [
            {
              trial_id: 'trial-1',
              without_veritas_session_log_path: 'without.json',
              with_veritas_session_log_path: 'with.json',
            },
          ],
        },
      ],
    }),
    'utf8',
  );
  writeFileSync(
    join(rootDir, 'scenario.json'),
    JSON.stringify({
      version: 1,
      id: 'unsafe-marker',
      title: 'Unsafe marker',
      marker: {
        id: 'unsafe',
        required_phrases: ['unsafe'],
      },
      scoring: {
        trigger_tag: 'trigger',
        max_assistant_turns_after_trigger: 1,
        allow_early: false,
      },
    }),
    'utf8',
  );

  assert.throws(
    () =>
      generateMarkerBenchmarkSuiteReport({
        rootDir,
        suitePath: 'suite/suite.json',
      }),
    /marker benchmark suite artifact paths must stay inside the benchmark directory/,
  );
});

test('marker benchmark comparison rejects mismatched benchmark ids and condition ids', () => {
  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          version: 1,
          id: 'migration-marker',
          title: 'Migration marker surfaces on the first relevant response',
          marker: {
            id: 'must-mention-data-migration',
            required_phrases: ['data migration'],
          },
          scoring: {
            trigger_tag: 'marker-trigger',
            response_tag: 'marker-response-window',
            max_assistant_turns_after_trigger: 1,
            allow_early: false,
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'wrong-benchmark',
          run_id: 'without-run',
          condition_id: 'baseline',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
          ],
        },
        withVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'with-run',
          condition_id: 'with-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
          ],
        },
      }),
    /benchmark_id must match scenario id|condition_id must be without-veritas/,
  );
});

test('marker benchmark comparison rejects malformed scenarios and session logs', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-marker-invalid-'));
  const baseScenario = {
    version: 1,
    id: 'migration-marker',
    title: 'Migration marker surfaces on the first relevant response',
    marker: {
      id: 'must-mention-data-migration',
      required_phrases: ['data migration'],
    },
    scoring: {
      trigger_tag: 'marker-trigger',
      response_tag: 'marker-response-window',
      max_assistant_turns_after_trigger: 1,
      allow_early: false,
    },
  };
  const validWithVeritas = {
    version: 1,
    benchmark_id: 'migration-marker',
    run_id: 'with-run',
    condition_id: 'with-veritas',
    turns: [
      { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
      {
        role: 'assistant',
        content: 'This needs a data migration.',
        tags: ['marker-response-window'],
      },
    ],
  };

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: { ...baseScenario, scoring: {} },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            { role: 'assistant', content: 'This needs a data migration.' },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /scoring is missing required key: trigger_tag/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            { role: 'assistant', content: 'This needs a data migration.' },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one response tag marker-response-window/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            { role: 'tool', content: 'another trigger', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one trigger tag marker-trigger/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'First tagged response.',
              tags: ['marker-response-window'],
            },
            {
              role: 'assistant',
              content: 'Second tagged response.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one response tag marker-response-window/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          scoring: {
            ...baseScenario.scoring,
            extra_rule: 'not-allowed',
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            {
              role: 'tool',
              content: 'db/schema.prisma changed',
              tags: ['marker-trigger'],
              extra_field: true,
            },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /contains unsupported key: extra_rule|contains unsupported key: extra_field/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          scoring: {
            ...baseScenario.scoring,
            response_tag: 'marker-trigger',
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-trigger'],
            },
          ],
        },
        withVeritas: {
          ...validWithVeritas,
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-trigger'],
            },
          ],
        },
      }),
    /response_tag must differ from scoring.trigger_tag/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            {
              role: 'tool',
              content: 'db/schema.prisma changed',
              tags: ['marker-trigger', 'marker-response-window'],
            },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /must include exactly one response tag marker-response-window/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'shared-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: {
          ...validWithVeritas,
          run_id: 'shared-run',
        },
      }),
    /requires distinct run_id values/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          version: '1',
          marker: {
            ...baseScenario.marker,
            id: 7,
          },
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /scenario version must be an integer|marker\.id must be a non-empty string/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            {
              role: 'tool',
              content: 'db/schema.prisma changed',
              tags: ['marker-trigger', 5],
            },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /session log turn tag must be a non-empty string/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: {
          ...baseScenario,
          marker: null,
        },
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [
            { role: 'tool', content: 'db/schema.prisma changed', tags: ['marker-trigger'] },
            {
              role: 'assistant',
              content: 'This needs a data migration.',
              tags: ['marker-response-window'],
            },
          ],
        },
        withVeritas: validWithVeritas,
      }),
    /marker benchmark scenario marker must be an object/,
  );

  assert.throws(
    () =>
      generateMarkerBenchmarkSuiteReport({
        rootDir: rootDir,
        suitePath: writeTempJson(rootDir, 'bad-suite.json', {
          version: 1,
          id: 'bad-suite',
          title: 'Bad Suite',
          benchmarks: [null],
        }),
      }),
    /marker benchmark suite benchmark must be an object/,
  );

  assert.throws(
    () =>
      generateMarkerBenchmarkSuiteReport({
        rootDir,
        suitePath: writeTempJson(rootDir, 'duplicate-benchmark-suite.json', {
          version: 1,
          id: 'duplicate-benchmark-suite',
          title: 'Duplicate Benchmark Suite',
          benchmarks: [
            {
              benchmark_id: 'dup-benchmark',
              title: 'Dup Benchmark A',
              marker_class: 'class-a',
              repo_surface: 'src/a.ts',
              scenario_path: 'scenario-a.json',
              trials: [
                {
                  trial_id: 'dup-trial-a',
                  without_veritas_session_log_path: 'without-a.json',
                  with_veritas_session_log_path: 'with-a.json',
                },
              ],
            },
            {
              benchmark_id: 'dup-benchmark',
              title: 'Dup Benchmark B',
              marker_class: 'class-b',
              repo_surface: 'src/b.ts',
              scenario_path: 'scenario-b.json',
              trials: [
                {
                  trial_id: 'dup-trial-b',
                  without_veritas_session_log_path: 'without-b.json',
                  with_veritas_session_log_path: 'with-b.json',
                },
              ],
            },
          ],
        }),
      }),
    /benchmark_id must be unique: dup-benchmark/,
  );

  assert.throws(
    () =>
      generateMarkerBenchmarkSuiteReport({
        rootDir,
        suitePath: writeTempJson(rootDir, 'duplicate-trial-suite.json', {
          version: 1,
          id: 'duplicate-trial-suite',
          title: 'Duplicate Trial Suite',
          benchmarks: [
            {
              benchmark_id: 'benchmark-a',
              title: 'Benchmark A',
              marker_class: 'class-a',
              repo_surface: 'src/a.ts',
              scenario_path: 'scenario-a.json',
              trials: [
                {
                  trial_id: 'dup-trial',
                  without_veritas_session_log_path: 'without-a.json',
                  with_veritas_session_log_path: 'with-a.json',
                },
              ],
            },
            {
              benchmark_id: 'benchmark-b',
              title: 'Benchmark B',
              marker_class: 'class-b',
              repo_surface: 'src/b.ts',
              scenario_path: 'scenario-b.json',
              trials: [
                {
                  trial_id: 'dup-trial',
                  without_veritas_session_log_path: 'without-b.json',
                  with_veritas_session_log_path: 'with-b.json',
                },
              ],
            },
          ],
        }),
      }),
    /trial_id must be unique: dup-trial/,
  );

  assert.throws(
    () =>
      compareMarkerBenchmarkRuns({
        scenario: baseScenario,
        withoutVeritas: {
          version: 1,
          benchmark_id: 'migration-marker',
          run_id: 'without-run',
          condition_id: 'without-veritas',
          turns: [null],
        },
        withVeritas: validWithVeritas,
      }),
    /without-veritas session log turn must be an object/,
  );
});

test('readiness check CLI rejects incomplete branch-diff refs', () => {
  const rootDir = initCommittedRepo('veritas-readiness-check-diff-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Check Diff Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  assert.throws(
    () =>
      execFileSync(
        'npm',
        [
          'exec',
          '--',
          'veritas',
      'readiness',
          '--root',
          rootDir,
          '--skip-evidence-check',
          '--changed-from',
          'HEAD~1',
        ],
        { cwd: repoRootDir, encoding: 'utf8' },
      ),
    /requires both --changed-from and --changed-to/,
  );
});

test('readiness check CLI executes every required evidenceCheck from the repo map', () => {
  const rootDir = initCommittedRepo('veritas-readiness-check-multi-evidenceCheck-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Check Multi Evidence Check Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = readJsonFromAbsolute(repoMapPath);
  repoMap.evidence.evidenceChecks = [
    { id: 'duplicate-evidence-check', command: 'node -e "process.exit(0)"', method: 'validation' },
    { id: 'duplicate-evidence-check-2', command: 'node -e "process.exit(0)"', method: 'validation' },
  ];
  repoMap.evidence.requiredEvidenceCheckIds = ['duplicate-evidence-check', 'duplicate-evidence-check-2'];
  delete repoMap.evidence.defaultEvidenceCheckIds;
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`, 'utf8');

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'readiness', '--format', 'json', '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.deepEqual(parsed.evidenceCheckLabels, ['node -e "process.exit(0)"', 'node -e "process.exit(0)"']);
  assert.equal(parsed.evidenceCheckResolutionSource, 'required');
});

test('readiness check CLI treats shell metacharacters as literal evidence-check-command arguments', () => {
  const rootDir = initCommittedRepo('veritas-readiness-check-literal-metachars-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Readiness Check Literal Metachars Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );

  const repoMapPath = join(rootDir, '.veritas/repo-map.json');
  const repoMap = readJsonFromAbsolute(repoMapPath);
  repoMap.evidence.evidenceChecks = [
    {
      id: 'literal-evidence-check',
      command: `node -e "const { writeFileSync } = require('node:fs'); console.log('evidenceCheck stdout'); writeFileSync('evidence-check-output.txt', 'ok');" && node -e "require('node:fs').writeFileSync('evidence-repo conformancejected.txt', 'bad')"`,
      method: 'validation',
    },
  ];
  repoMap.evidence.requiredEvidenceCheckIds = ['literal-evidence-check'];
  delete repoMap.evidence.defaultEvidenceCheckIds;
  writeFileSync(repoMapPath, `${JSON.stringify(repoMap, null, 2)}\n`, 'utf8');

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'readiness', '--format', 'json', '--root', rootDir],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  const parsed = parseCliJson(stdout);

  assert.match(stdout, /evidenceCheck stdout/);
  assert.equal(readFileSync(join(rootDir, 'evidence-check-output.txt'), 'utf8'), 'ok');
  assert.equal(existsSync(join(rootDir, 'evidence-repo conformancejected.txt')), true);
  assert.deepEqual(parsed.evidenceCheckLabels, [repoMap.evidence.evidenceChecks[0].command]);
});

test('package script suggestions use the consolidated readiness surface', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-scripts-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          verify: 'turbo run verify',
        },
      },
      null,
      2,
    ),
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });

  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const scripts = buildSuggestedPackageScripts({
    evidenceCheck: repoInsights.evidenceCheck,
    baseRef: repoInsights.baseRef,
  });

  assert.equal(repoInsights.evidenceCheck, 'npm run verify');
  assert.equal(repoInsights.baseRef, 'main');
  assert.equal(scripts['veritas:init'], 'npm exec -- veritas init');
  assert.equal(scripts['veritas:evidence-check'], 'npm run verify');
  assert.equal(
    scripts['veritas:check:working-tree'],
    'npm exec -- veritas readiness --working-tree',
  );
  assert.equal(scripts['veritas:readiness'], 'npm exec -- veritas readiness');
  assert.equal(
    scripts['lint:governance'],
    'npm exec -- veritas readiness --format feedback --working-tree',
  );
  assert.equal(
    scripts['veritas:check:diff'],
    'npm exec -- veritas readiness --changed-from main --changed-to HEAD',
  );
  assert.equal(scripts['test:prepush'], 'npm run veritas:evidence-check');
  assert.equal(scripts.prepush, 'npm run test:prepush');
});

test('print ci-snippet returns a copy-paste starter snippet', () => {
  const snippet = buildSuggestedCiSnippet({
    evidenceCheck: 'npm run verify',
    baseRef: 'main',
  });
  assert.match(snippet, /Run project evidenceCheck/);
  assert.match(snippet, /npm exec -- veritas readiness --changed-from main --changed-to HEAD/);

  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-print-ci-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { verify: 'turbo run verify' } }, null, 2));
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  assert.equal(repoInsights.evidenceCheck, 'npm run verify');
  assert.match(buildSuggestedCiSnippet({ evidenceCheck: repoInsights.evidenceCheck }), /run: npm run verify/);
});

test('print git-hook returns a tracked post-commit runtime integration', () => {
  const hookBody = buildSuggestedGitHook({ hook: 'post-commit' });
  const trackedHookBody = readFileSync(join(repoRootDir, '.githooks/post-commit'), 'utf8');
  assert.match(hookBody, /^#!\/bin\/sh/m);
  assert.match(hookBody, /veritas readiness --changed-from HEAD~1 --changed-to HEAD/);
  assert.match(hookBody, /VERITAS_HOOK_SKIP/);
  assert.match(hookBody, /AI_GUIDANCE_HOOK_SKIP/);
  assert.equal(hookBody, trackedHookBody);
});

test('print git-hook returns a tracked pre-push push-safe integration', () => {
  const hookBody = buildSuggestedGitHook({ hook: 'pre-push' });
  assert.match(hookBody, /^#!\/bin\/sh/m);
  assert.match(hookBody, /\bnpm\s+run\s+--if-present\s+prepush\b/);
  assert.match(hookBody, /package\.json not found; skipping/);
  assert.match(hookBody, /VERITAS_HOOK_SKIP/);
  assert.doesNotMatch(hookBody, /(^|[;&|])\s*npm\s+(run\s+)?test(\s|$)/);
  assert.doesNotMatch(hookBody, /node\s+--test/);
});

test('generated pre-push hook skips safely without package prepush support', () => {
  const hookBody = buildSuggestedGitHook({ hook: 'pre-push' });
  const noPackageDir = mkdtempSync(join(tmpdir(), 'veritas-pre-push-no-package-'));
  const noPackageHook = join(noPackageDir, 'pre-push');
  writeFileSync(noPackageHook, hookBody, 'utf8');
  chmodSync(noPackageHook, 0o755);

  const noPackageOutput = execFileSync(noPackageHook, {
    cwd: noPackageDir,
    encoding: 'utf8',
  });
  assert.match(noPackageOutput, /package\.json not found; skipping/);

  const noPrepushDir = mkdtempSync(join(tmpdir(), 'veritas-pre-push-no-script-'));
  const noPrepushHook = join(noPrepushDir, 'pre-push');
  writeFileSync(noPrepushHook, hookBody, 'utf8');
  chmodSync(noPrepushHook, 0o755);
  writeFileSync(
    join(noPrepushDir, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(99)"' } }, null, 2),
  );

  execFileSync(noPrepushHook, {
    cwd: noPrepushDir,
    encoding: 'utf8',
  });
});

test('git fixture helper strips inherited caller git environment', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-clean-git-env-'));
  const poisonedEnv = {
    ...process.env,
    GIT_DIR: join(repoRootDir, '.git'),
    GIT_WORK_TREE: repoRootDir,
    GIT_INDEX_FILE: join(repoRootDir, '.git/index'),
  };

  assert.equal(cleanGitEnv(poisonedEnv).GIT_DIR, undefined);
  assert.equal(cleanGitEnv(poisonedEnv).GIT_WORK_TREE, undefined);
  assert.equal(cleanGitEnv(poisonedEnv).GIT_INDEX_FILE, undefined);

  execGitFixture(['init', '-b', 'main'], { cwd: rootDir, env: poisonedEnv, encoding: 'utf8' });
  const gitDir = execGitFixture(['rev-parse', '--git-dir'], {
    cwd: rootDir,
    env: poisonedEnv,
    encoding: 'utf8',
  }).trim();

  assert.equal(gitDir, '.git');
});

test('package scripts expose a push-safe pre-push command that avoids the full test suite', () => {
  const pkg = readJsonFromAbsolute(join(repoRootDir, 'package.json'));

  assert.equal(pkg.scripts['test:prepush'], 'npm run verify');
  assert.equal(pkg.scripts.prepush, 'npm run test:prepush');
  assert.equal(
    pkg.scripts.test,
    'node --test tests/*.test.mjs tests/**/*.test.mjs',
  );

  for (const scriptName of ['test:prepush', 'prepush']) {
    assert.doesNotMatch(pkg.scripts[scriptName], /(^|[;&|])\s*npm\s+(run\s+)?test(\s|$)/);
    assert.doesNotMatch(pkg.scripts[scriptName], /node\s+--test/);
    assert.doesNotMatch(pkg.scripts[scriptName], /tests\/\*\*\/\*\.test\.mjs/);
  }
});

test('tracked pre-push hook runs the push-safe script instead of the full test suite', () => {
  const hookPath = join(repoRootDir, '.githooks/pre-push');
  const hookBody = readFileSync(hookPath, 'utf8');

  assert.match(hookBody, /^#!\/bin\/sh/m);
  assert.match(hookBody, /\bnpm\s+run\s+--if-present\s+prepush\b/);
  assert.match(hookBody, /package\.json not found; skipping/);
  assert.doesNotMatch(hookBody, /(^|[;&|])\s*npm\s+(run\s+)?test(\s|$)/);
  assert.doesNotMatch(hookBody, /node\s+--test/);
  assert.doesNotMatch(hookBody, /tests\/\*\*\/\*\.test\.mjs/);
});

test('print runtime-hook returns a tracked agent runtime integration', () => {
  const hookBody = buildSuggestedRuntimeHook();
  assert.match(hookBody, /^#!\/bin\/sh/m);
  assert.match(hookBody, /veritas readiness --format json --working-tree/);

  assert.match(hookBody, /VERITAS_HOOK_SKIP/);
});

test('print stop-hook returns generic and tool-specific stop hook suggestions', () => {
  const genericHook = buildSuggestedStopHook({ tool: 'generic' });
  assert.equal(genericHook.outputPath, '.veritas/hooks/stop.sh');
  assert.match(genericHook.hookBody, /veritas readiness --format feedback --working-tree/);

  const claudeHook = buildSuggestedStopHook({ tool: 'claude-code' });
  assert.equal(claudeHook.toolConfigPath, '.claude/settings.json');
  assert.equal(claudeHook.toolConfig.hooks.Stop[0].hooks[0].command, '.veritas/hooks/stop.sh');

  const cursorHook = buildSuggestedStopHook({ tool: 'cursor' });
  assert.equal(cursorHook.tool, 'cursor');
  assert.equal(cursorHook.toolConfigPath, '.cursor/hooks.json');
});

test('print and apply governance-blocks use marker-bounded updates', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-governance-blocks-'));
  mkdirp(join(rootDir, '.veritas'));
  writeFileSync(
    join(rootDir, '.veritas/repo-map.json'),
    JSON.stringify(
      {
        activation: {
          aiInstructionFiles: [
            { path: 'AGENTS.md', tool: 'codex', required: true },
            { path: 'CLAUDE.md', tool: 'claude-code', required: true },
            { path: '.cursorrules', tool: 'cursor', required: false },
          ],
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, 'AGENTS.md'), '# Existing\n');

  assert.match(buildGovernanceBlock(), /veritas:governance-block:start/);

  const result = applyGovernanceBlocks({ rootDir });
  assert.deepEqual(
    result.applied.map((item) => item.path).sort(),
    ['AGENTS.md', 'CLAUDE.md'],
  );
  assert.equal(result.skipped[0].path, '.cursorrules');
  assert.match(readFileSync(join(rootDir, 'AGENTS.md'), 'utf8'), /^# Existing/);
  assert.match(readFileSync(join(rootDir, 'AGENTS.md'), 'utf8'), /veritas:governance-block:start/);

  const second = applyGovernanceBlocks({ rootDir });
  assert.equal(
    readFileSync(join(rootDir, 'AGENTS.md'), 'utf8').match(/veritas:governance-block:start/g).length,
    1,
  );
  assert.equal(second.applied.length, 2);
});

test('print codex-hook returns a tracked Codex hooks integration', () => {
  const hookConfig = buildSuggestedCodexHookConfig();
  assert.equal(hookConfig.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');

  assert.equal(hookConfig.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
});

test('print codex-hook can preview a Codex home target and install state', () => {
  const rootDir = initCommittedRepo('veritas-print-codex-hook-home-');
  const codexHome = join(rootDir, 'tmp-codex-home');
  mkdirp(codexHome);
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify(buildSuggestedCodexHookConfig(), null, 2));

  const targetStatus = inspectCodexHookTarget(rootDir, { codexHome: 'tmp-codex-home' });

  assert.equal(targetStatus.resolvedTargetPath, 'tmp-codex-home/hooks.json');
  assert.equal(targetStatus.targetExists, true);
  assert.equal(targetStatus.integrationInstalled, true);
});

test('print codex-hook reports an absolute external Codex home path clearly', () => {
  const rootDir = initCommittedRepo('veritas-print-codex-hook-external-');
  const codexHome = mkdtempSync(join(tmpdir(), 'external-codex-home-'));
  writeFileSync(
    join(codexHome, 'hooks.json'),
    JSON.stringify({ hooks: {} }, null, 2),
  );

  const targetStatus = inspectCodexHookTarget(rootDir, { codexHome });

  assert.equal(targetStatus.resolvedTargetPath, `${codexHome.replaceAll('\\', '/')}/hooks.json`);
  assert.equal(targetStatus.targetExists, true);
});

test('apply package-scripts writes the suggested guidance scripts into package.json', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-scripts-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
  );
  execFileSync('git', ['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });

  const parsed = applyPackageScripts({ rootDir, baseRef: 'main' });
  const pkg = readJsonFromAbsolute(join(rootDir, 'package.json'));

  assert.equal(parsed.packageJsonPath, 'package.json');
  assert.equal(parsed.baseRef, 'main');
  assert.equal(pkg.scripts['veritas:init'], 'npm exec -- veritas init');
  assert.equal(
    pkg.scripts['veritas:check:diff'],
    'npm exec -- veritas readiness --changed-from main --changed-to HEAD',
  );
});

test('apply package-scripts surfaces script conflicts without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-conflict-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'veritas:evidence-check': 'echo custom',
        },
      },
      null,
      2,
    ),
  );

  assert.throws(
    () =>
      applyPackageScripts({
        rootDir,
        evidenceCheck: 'npm test',
        baseRef: '<base-ref>',
      }),
    /Refusing to overwrite existing script veritas:evidence-check/,
  );
});

test('apply package-scripts refuses symlinked package.json', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-scripts-symlink-'));
  const externalPackageJson = join(
    mkdtempSync(join(tmpdir(), 'veritas-external-package-json-')),
    'package.json',
  );
  writeFileSync(
    externalPackageJson,
    JSON.stringify({ scripts: { test: 'external' } }, null, 2),
  );
  symlinkSync(externalPackageJson, join(rootDir, 'package.json'));

  assert.throws(
    () => applyPackageScripts({ rootDir, force: true }),
    /refuses to write through a symlinked package\.json/,
  );
  assert.equal(
    readFileSync(externalPackageJson, 'utf8'),
    `${JSON.stringify({ scripts: { test: 'external' } }, null, 2)}`,
  );
});

test('apply ci-snippet writes a stable snippet file', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-ci-'));
  const result = applyCiSnippet({
    rootDir,
    evidenceCheck: 'npm run verify',
    baseRef: 'main',
  });
  const contents = readFileSync(
    join(rootDir, '.veritas/snippets/ci-snippet.yml'),
    'utf8',
  );

  assert.equal(result.outputPath, '.veritas/snippets/ci-snippet.yml');
  assert.match(contents, /run: npm run verify/);
  assert.match(contents, /--changed-from main --changed-to HEAD/);
});

test('apply git-hook writes a tracked executable hook file', () => {
  const rootDir = initCommittedRepo('veritas-apply-hook-');
  const result = applyGitHook({
    rootDir,
    hook: 'post-commit',
  });
  const contents = readFileSync(join(rootDir, '.githooks/post-commit'), 'utf8');

  assert.equal(result.outputPath, '.githooks/post-commit');
  assert.equal(result.hook, 'post-commit');
  assert.match(contents, /veritas readiness --changed-from HEAD~1 --changed-to HEAD/);
});

test('apply git-hook writes a tracked executable pre-push hook file', () => {
  const rootDir = initCommittedRepo('veritas-apply-pre-push-hook-');
  const result = applyGitHook({
    rootDir,
    hook: 'pre-push',
  });
  const contents = readFileSync(join(rootDir, '.githooks/pre-push'), 'utf8');

  assert.equal(result.outputPath, '.githooks/pre-push');
  assert.equal(result.hook, 'pre-push');
  assert.match(contents, /\bnpm\s+run\s+--if-present\s+prepush\b/);
  assert.doesNotMatch(contents, /(^|[;&|])\s*npm\s+(run\s+)?test(\s|$)/);
});

test('apply git-hook rejects symlinked .githooks directory', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-hook-symlink-'));
  const externalDir = mkdtempSync(join(tmpdir(), 'veritas-external-githooks-'));
  symlinkSync(externalDir, join(rootDir, '.githooks'));

  assert.throws(
    () =>
      applyGitHook({
        rootDir,
        hook: 'pre-push',
      }),
    /refuses to write through a symlinked \.githooks directory/,
  );
});

test('apply git-hook refuses symlinked hook files even when forced', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-hook-file-symlink-'));
  mkdirp(join(rootDir, '.githooks'));
  const externalHook = join(
    mkdtempSync(join(tmpdir(), 'veritas-external-hook-file-')),
    'post-commit',
  );
  writeFileSync(externalHook, '#!/bin/sh\necho external\n', 'utf8');
  symlinkSync(externalHook, join(rootDir, '.githooks/post-commit'));

  assert.throws(
    () =>
      applyGitHook({
        rootDir,
        hook: 'post-commit',
        force: true,
      }),
    /apply git-hook only supports writing inside \.githooks\/|refuses to write through a symlinked hook file: \.githooks\/post-commit/,
  );
  assert.equal(readFileSync(externalHook, 'utf8'), '#!/bin/sh\necho external\n');

  unlinkSync(join(rootDir, '.githooks/post-commit'));
  symlinkSync(join(rootDir, 'missing-external-hook'), join(rootDir, '.githooks/post-commit'));
  assert.throws(
    () =>
      applyGitHook({
        rootDir,
        hook: 'post-commit',
        force: true,
      }),
    /refuses to write through a symlinked hook file: \.githooks\/post-commit/,
  );
});

test('apply git-hook can configure the local hooks path explicitly', () => {
  const rootDir = initCommittedRepo('veritas-apply-hook-config-');
  const result = applyGitHook({
    rootDir,
    hook: 'post-commit',
    configureGit: true,
  });
  const configuredHooksPath = execFileSync(
    'git',
    ['config', '--get', 'core.hooksPath'],
    { cwd: rootDir, encoding: 'utf8' },
  ).trim();

  assert.equal(result.configuredHooksPath, '.githooks');
  assert.equal(configuredHooksPath, '.githooks');
});

test('setup repo-hooks installs both hooks idempotently and configures local hooksPath', () => {
  const rootDir = initCommittedRepo('veritas-setup-repo-hooks-');
  const first = setupRepoHooks({ rootDir });
  chmodSync(join(rootDir, '.githooks/pre-push'), 0o644);
  const second = setupRepoHooks({ rootDir });
  const configuredHooksPath = execFileSync(
    'git',
    ['config', '--local', '--get', 'core.hooksPath'],
    { cwd: rootDir, encoding: 'utf8' },
  ).trim();

  assert.deepEqual(
    first.hooks.map((hook) => hook.outputPath),
    ['.githooks/post-commit', '.githooks/pre-push'],
  );
  assert.equal(second.configuredHooksPath, '.githooks');
  assert.equal(configuredHooksPath, '.githooks');
  assert.equal(existsSync(join(rootDir, '.githooks/post-commit')), true);
  assert.equal(existsSync(join(rootDir, '.githooks/pre-push')), true);
  assert.notEqual(
    executableBits(join(rootDir, '.githooks/pre-push')),
    0,
  );
});

test('setup repo-hooks writes repo-local config without relying on global hooksPath', () => {
  const rootDir = initCommittedRepo('veritas-setup-local-config-');
  const homeDir = mkdtempSync(join(tmpdir(), 'veritas-setup-home-'));
  execFileSync('git', ['config', '--global', 'core.hooksPath', '.other-hooks'], {
    cwd: rootDir,
    env: { ...cleanGitEnv(), HOME: homeDir },
    encoding: 'utf8',
  });

  setupRepoHooks({ rootDir });
  const localHooksPath = execFileSync(
    'git',
    ['config', '--local', '--get', 'core.hooksPath'],
    { cwd: rootDir, env: { ...cleanGitEnv(), HOME: homeDir }, encoding: 'utf8' },
  ).trim();
  const globalHooksPath = execFileSync(
    'git',
    ['config', '--global', '--get', 'core.hooksPath'],
    { cwd: rootDir, env: { ...cleanGitEnv(), HOME: homeDir }, encoding: 'utf8' },
  ).trim();

  assert.equal(localHooksPath, '.githooks');
  assert.equal(globalHooksPath, '.other-hooks');
});

test('setup repo-hooks CLI installs hooks and returns JSON', () => {
  const rootDir = initCommittedRepo('veritas-setup-cli-');
  installLocalVeritasBin(rootDir);
  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'setup', 'repo-hooks', '--root', rootDir],
    { cwd: rootDir, encoding: 'utf8' },
  );
  const result = JSON.parse(stdout);
  const configuredHooksPath = execFileSync(
    'git',
    ['config', '--local', '--get', 'core.hooksPath'],
    { cwd: rootDir, encoding: 'utf8' },
  ).trim();

  assert.equal(result.rootDir, rootDir);
  assert.equal(result.configuredHooksPath, '.githooks');
  assert.equal(result.setupCommand, 'npm exec -- veritas setup repo-hooks');
  assert.deepEqual(
    result.hooks.map((hook) => hook.outputPath),
    ['.githooks/post-commit', '.githooks/pre-push'],
  );
  assert.equal(configuredHooksPath, '.githooks');
});

test('setup repo-hooks refuses symlinked hook files in idempotent repair mode', () => {
  for (const hook of ['post-commit', 'pre-push']) {
    const rootDir = initCommittedRepo(`veritas-setup-symlink-${hook}-`);
    mkdirp(join(rootDir, '.githooks'));
    const externalHook = join(
      mkdtempSync(join(tmpdir(), 'veritas-external-hook-')),
      hook,
    );
    writeFileSync(externalHook, buildSuggestedGitHook({ hook }), 'utf8');
    symlinkSync(externalHook, join(rootDir, '.githooks', hook));

    assert.throws(
      () => setupRepoHooks({ rootDir }),
      new RegExp(`apply git-hook only supports writing inside \\.githooks/|refuses to write through a symlinked hook file: \\.githooks/${hook}`),
    );
    assert.throws(
      () => setupRepoHooks({ rootDir, force: true }),
      new RegExp(`apply git-hook only supports writing inside \\.githooks/|refuses to write through a symlinked hook file: \\.githooks/${hook}`),
    );

    unlinkSync(join(rootDir, '.githooks', hook));
    symlinkSync(join(rootDir, `missing-${hook}`), join(rootDir, '.githooks', hook));
    assert.throws(
      () => setupRepoHooks({ rootDir, force: true }),
      new RegExp(`refuses to write through a symlinked hook file: \\.githooks/${hook}`),
    );
  }
});

test('setup repo-hooks refuses custom hooks unless forced', () => {
  const rootDir = initCommittedRepo('veritas-setup-custom-hook-');
  mkdirp(join(rootDir, '.githooks'));
  writeFileSync(join(rootDir, '.githooks/post-commit'), '#!/bin/sh\necho custom\n', 'utf8');

  assert.throws(
    () => setupRepoHooks({ rootDir }),
    /Refusing to overwrite existing file: \.githooks\/post-commit/,
  );

  setupRepoHooks({ rootDir, force: true });

  assert.equal(
    readFileSync(join(rootDir, '.githooks/post-commit'), 'utf8'),
    buildSuggestedGitHook({ hook: 'post-commit' }),
  );
  assert.notEqual(
    executableBits(join(rootDir, '.githooks/post-commit')),
    0,
  );
});

test('apply runtime-hook writes a tracked executable runtime hook file', () => {
  const rootDir = initCommittedRepo('veritas-apply-runtime-hook-');
  const result = applyRuntimeHook({
    rootDir,
  });
  const contents = readFileSync(join(rootDir, '.veritas/hooks/agent-runtime.sh'), 'utf8');

  assert.equal(result.outputPath, '.veritas/hooks/agent-runtime.sh');
  assert.match(contents, /veritas readiness --format json --working-tree/);
});

test('apply stop-hook writes the generic script and requested tool config', () => {
  const rootDir = initCommittedRepo('veritas-apply-stop-hook-');
  mkdirp(join(rootDir, '.cursor'));
  writeFileSync(
    join(rootDir, '.cursor/hooks.json'),
    JSON.stringify(
      {
        hooks: {
          stop: [{ command: 'echo keep-me' }],
        },
      },
      null,
      2,
    ),
  );
  const result = applyStopHook({
    rootDir,
    tool: 'cursor',
  });
  const contents = readFileSync(join(rootDir, '.veritas/hooks/stop.sh'), 'utf8');
  const cursorConfig = readJsonFromAbsolute(join(rootDir, '.cursor/hooks.json'));

  assert.equal(result.outputPath, '.veritas/hooks/stop.sh');
  assert.equal(result.tool, 'cursor');
  assert.equal(result.configuredToolConfigPath, '.cursor/hooks.json');
  assert.match(contents, /veritas readiness --format feedback --working-tree/);
  assert.equal(cursorConfig.hooks.stop[0].command, 'echo keep-me');
  assert.equal(cursorConfig.hooks.stop[1].command, '.veritas/hooks/stop.sh');
});

test('apply stop-hook preserves existing Claude stop hooks while deduping Veritas', () => {
  const rootDir = initCommittedRepo('veritas-apply-claude-stop-hook-');
  mkdirp(join(rootDir, '.claude'));
  writeFileSync(
    join(rootDir, '.claude/settings.json'),
    JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              matcher: 'existing',
              hooks: [{ type: 'command', command: 'echo keep-me' }],
            },
            {
              matcher: '.*',
              hooks: [{ type: 'command', command: '.veritas/hooks/stop.sh' }],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  applyStopHook({ rootDir, tool: 'claude-code' });
  const claudeConfig = readJsonFromAbsolute(join(rootDir, '.claude/settings.json'));

  assert.equal(claudeConfig.hooks.Stop.length, 2);
  assert.equal(claudeConfig.hooks.Stop[0].hooks[0].command, 'echo keep-me');
  assert.equal(
    claudeConfig.hooks.Stop[1].hooks[0].command,
    '.veritas/hooks/stop.sh',
  );
});

test('apply codex-hook writes a tracked codex hooks artifact and can merge it', () => {
  const rootDir = initCommittedRepo('veritas-apply-codex-hook-');
  const targetHooksFile = join(rootDir, 'tmp-hooks.json');
  writeFileSync(
    targetHooksFile,
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: 'startup',
              hooks: [{ type: 'command', command: 'echo existing' }],
            },
          ],
          Stop: [
            {
              matcher: '.*',
              hooks: [
                { type: 'command', command: '.veritas/hooks/agent-runtime.sh' },
                { type: 'command', command: 'echo keep-me' },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const result = applyCodexHook({
    rootDir,
    targetHooksFile,
  });
  const contents = readJsonFromAbsolute(join(rootDir, '.veritas/runtime/codex-hooks.json'));
  const merged = readJsonFromAbsolute(targetHooksFile);

  assert.equal(result.outputPath, '.veritas/runtime/codex-hooks.json');
  assert.equal(result.mergedTargetPath, 'tmp-hooks.json');
  assert.equal(contents.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
  assert.match(contents.hooks.PostSession[0].hooks[0].command, /VERITAS_SESSION_LOG_PATH/);
  assert.equal(merged.hooks.SessionStart[0].hooks[0].command, 'echo existing');
  assert.equal(merged.hooks.Stop[0].hooks[0].command, 'echo keep-me');
  assert.equal(merged.hooks.Stop[1].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
  assert.match(merged.hooks.PostSession[0].hooks[0].command, /VERITAS_SESSION_LOG_PATH/);
});

test('apply codex-hook can resolve a Codex home into hooks.json', () => {
  const rootDir = initCommittedRepo('veritas-apply-codex-home-');
  const codexHome = join(rootDir, 'tmp-codex-home');
  const targetHooksFile = join(codexHome, 'hooks.json');
  mkdirp(codexHome);
  writeFileSync(
    targetHooksFile,
    JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: 'startup',
              hooks: [{ type: 'command', command: 'echo existing' }],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const result = applyCodexHook({
    rootDir,
    codexHome,
  });
  const merged = readJsonFromAbsolute(targetHooksFile);

  assert.equal(result.mergedTargetPath, 'tmp-codex-home/hooks.json');
  assert.equal(merged.hooks.SessionStart[0].hooks[0].command, 'echo existing');
  assert.equal(merged.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
  assert.match(merged.hooks.PostSession[0].hooks[0].command, /VERITAS_SESSION_LOG_PATH/);
});

test('apply codex-hook reports an absolute external Codex home target clearly', () => {
  const rootDir = initCommittedRepo('veritas-apply-codex-home-external-');
  const codexHome = mkdtempSync(join(tmpdir(), 'external-codex-home-'));
  const targetHooksFile = join(codexHome, 'hooks.json');
  writeFileSync(targetHooksFile, JSON.stringify({ hooks: {} }, null, 2));

  const result = applyCodexHook({
    rootDir,
    codexHome,
  });

  assert.equal(result.mergedTargetPath, `${codexHome.replaceAll('\\', '/')}/hooks.json`);
});

test('apply git-hook rejects configured installs with a non-discoverable filename', () => {
  const rootDir = initCommittedRepo('veritas-apply-hook-bad-name-');

  assert.throws(
    () =>
      applyGitHook({
        rootDir,
        hook: 'post-commit',
        outputPath: '.githooks/custom-hook',
        configureGit: true,
      }),
    /requires the output filename to match post-commit/,
  );
});

test('apply ci-snippet rejects paths outside the reviewable snippet area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-ci-outside-'));

  assert.throws(
    () =>
      applyCiSnippet({
        rootDir,
        outputPath: '../outside.yml',
      }),
    /only supports writing inside \.veritas\/snippets\//,
  );
});

test('apply ci-snippet rejects symlinked snippet directories and files', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-ci-symlink-'));
  mkdirp(join(rootDir, '.veritas'));
  const externalSnippetsDir = mkdtempSync(join(tmpdir(), 'veritas-external-snippets-'));
  symlinkSync(externalSnippetsDir, join(rootDir, '.veritas/snippets'), 'dir');

  assert.throws(
    () => applyCiSnippet({ rootDir, force: true }),
    /refuses to write through a symlinked \.veritas\/snippets directory/,
  );

  unlinkSync(join(rootDir, '.veritas/snippets'));
  mkdirp(join(rootDir, '.veritas/snippets'));
  const externalSnippetFile = join(
    mkdtempSync(join(tmpdir(), 'veritas-external-snippet-file-')),
    'ci-snippet.yml',
  );
  writeFileSync(externalSnippetFile, 'external\n', 'utf8');
  symlinkSync(externalSnippetFile, join(rootDir, '.veritas/snippets/ci-snippet.yml'));

  assert.throws(
    () => applyCiSnippet({ rootDir, force: true }),
    /only supports writing inside \.veritas\/snippets\/|refuses to write through a symlinked snippet file: \.veritas\/snippets\/ci-snippet\.yml/,
  );
  assert.equal(readFileSync(externalSnippetFile, 'utf8'), 'external\n');

  unlinkSync(join(rootDir, '.veritas/snippets/ci-snippet.yml'));
  const internalSnippetFile = join(rootDir, '.veritas/snippets/internal.yml');
  writeFileSync(internalSnippetFile, 'internal\n', 'utf8');
  symlinkSync(internalSnippetFile, join(rootDir, '.veritas/snippets/ci-snippet.yml'));

  assert.throws(
    () => applyCiSnippet({ rootDir, force: true }),
    /refuses to write through a symlinked snippet file: \.veritas\/snippets\/ci-snippet\.yml/,
  );
  assert.equal(readFileSync(internalSnippetFile, 'utf8'), 'internal\n');
});

test('apply git-hook rejects unsupported hook kinds', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-hook-unsupported-'));

  assert.throws(
    () =>
      buildSuggestedGitHook({
        hook: 'pre-rebase',
      }),
    /Unsupported git hook kind: pre-rebase/,
  );

  assert.throws(
    () =>
      applyGitHook({
        rootDir,
        hook: 'pre-rebase',
      }),
    /Unsupported git hook kind: pre-rebase/,
  );
});

test('apply runtime-hook rejects paths outside the reviewable hook area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-runtime-hook-outside-'));

  assert.throws(
    () =>
      applyRuntimeHook({
        rootDir,
        outputPath: '../outside.sh',
      }),
    /only supports writing inside \.veritas\/hooks\//,
  );
});

test('non-git hook installers reject symlinked .veritas hooks directory', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-hook-symlink-dir-'));
  mkdirp(join(rootDir, '.veritas'));
  const externalHooksDir = mkdtempSync(join(tmpdir(), 'external-veritas-hooks-'));
  symlinkSync(externalHooksDir, join(rootDir, '.veritas/hooks'), 'dir');

  assert.throws(
    () => applyRuntimeHook({ rootDir, force: true }),
    /refuses to write through a symlinked \.veritas\/hooks directory/,
  );
  assert.throws(
    () => applyStopHook({ rootDir, force: true }),
    /refuses to write through a symlinked \.veritas\/hooks directory/,
  );
});

test('apply runtime-hook rejects symlinked targets that escape the hook area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-runtime-hook-symlink-'));
  const externalDir = mkdtempSync(join(tmpdir(), 'veritas-external-hook-target-'));
  mkdirp(join(rootDir, '.veritas/hooks'));
  symlinkSync(externalDir, join(rootDir, '.veritas/hooks/external-link'));

  assert.throws(
    () =>
      applyRuntimeHook({
        rootDir,
        outputPath: '.veritas/hooks/external-link/agent-runtime.sh',
      }),
    /only supports writing inside \.veritas\/hooks\//,
  );
});

test('apply codex-hook rejects paths outside the reviewable codex hook area', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-codex-hook-outside-'));

  assert.throws(
    () =>
      applyCodexHook({
        rootDir,
        outputPath: '../outside.json',
      }),
    /only supports writing inside \.veritas\/runtime\//,
  );
});

test('apply codex-hook rejects conflicting target hooks path and Codex home inputs', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-apply-codex-hook-conflict-'));

  assert.throws(
    () =>
      applyCodexHook({
        rootDir,
        targetHooksFile: 'hooks.json',
        codexHome: '.codex',
      }),
    /accepts either --target-hooks-file or --codex-home, not both/,
  );
});

test('runtime status reports missing integration state and next commands', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-missing-');
  const status = inspectRuntimeIntegrationStatus(rootDir);

  assert.equal(status.gitHook.exists, false);
  assert.equal(status.prePushHook.exists, false);
  assert.equal(status.runtimeHook.exists, false);
  assert.equal(status.codexArtifact.exists, false);
  assert.equal(status.codexTarget.checked, false);
  assert.equal(status.codexTarget.resolvedTargetPath, null);
  assert.ok(status.nextCommands.includes('npm exec -- veritas setup repo-hooks'));
  assert.equal(
    status.nextCommands.filter((command) => command === 'npm exec -- veritas setup repo-hooks').length,
    1,
  );
  assert.ok(status.nextCommands.includes('npm exec -- veritas integrations codex install'));
  assert.ok(
    status.nextCommands.includes(
      'npm exec -- veritas integrations codex status --codex-home /path/to/.codex',
    ),
  );
});

test('conformance alerts point repo hook issues to setup repo-hooks', () => {
  const report = {
    record: {
      policy_results: [],
      unresolved_files: [],
    },
  };
  const runtimeStatus = {
    gitHook: { exists: false, executable: false, configured: false },
    prePushHook: { exists: true, executable: false, configured: true },
    runtimeHook: { exists: true, executable: true },
    codexArtifact: { exists: true },
    codexTarget: { checked: false, integrationInstalled: false },
  };

  const alerts = buildConformanceAlerts(report, runtimeStatus, false);
  const byCode = new Map(alerts.map((alert) => [alert.code, alert]));

  assert.equal(
    byCode.get('missing-git-hook').nextCommand,
    'npm exec -- veritas setup repo-hooks',
  );
  assert.equal(
    byCode.get('pre-push-hook-not-executable').nextCommand,
    'npm exec -- veritas setup repo-hooks --force',
  );
});

test('runtime status treats inherited hooksPath as unconfigured for repo-owned hooks', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-global-hooks-');
  applyGitHook({ rootDir });
  applyGitHook({ rootDir, hook: 'pre-push' });
  execFileSync('git', ['config', '--global', 'core.hooksPath', '.githooks'], {
    cwd: rootDir,
    env: { ...process.env, HOME: rootDir },
    encoding: 'utf8',
  });

  const status = inspectRuntimeIntegrationStatus(rootDir);

  assert.equal(status.gitHook.exists, true);
  assert.equal(status.gitHook.configured, false);
  assert.equal(status.prePushHook.exists, true);
  assert.equal(status.prePushHook.configured, false);
  assert.ok(status.nextCommands.includes('npm exec -- veritas setup repo-hooks'));
});

test('integrations codex install owns git, runtime, and codex hook wiring', () => {
  const rootDir = initCommittedRepo('veritas-integrations-codex-install-');
  installLocalVeritasBin(rootDir);
  const codexHome = join(rootDir, 'tmp-codex-home');
  mkdirp(codexHome);
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2));

  const stdout = execFileSync(
    'npm',
    ['exec', '--', 'veritas', 'integrations', 'codex', 'install', '--codex-home', codexHome],
    { cwd: rootDir, encoding: 'utf8' },
  );
  const result = JSON.parse(stdout);
  const configuredHooksPath = execFileSync(
    'git',
    ['config', '--get', 'core.hooksPath'],
    { cwd: rootDir, encoding: 'utf8' },
  ).trim();
  const codexHooks = readJsonFromAbsolute(join(codexHome, 'hooks.json'));

  assert.equal(result.stop.gitHook.outputPath, '.githooks/post-commit');
  assert.equal(result.stop.prePushHook.outputPath, '.githooks/pre-push');
  assert.equal(result.stop.runtimeHook.outputPath, '.veritas/hooks/agent-runtime.sh');
  assert.equal(result.stop.codexHooks.outputPath, '.veritas/runtime/codex-hooks.json');
  assert.equal(configuredHooksPath, '.githooks');
  assert.equal(codexHooks.hooks.Stop[0].hooks[0].command, '.veritas/hooks/agent-runtime.sh');
  assert.equal(result.postSession.installed, true);
});

test('runtime status reports installed integration state including codex target', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-installed-');
  applyGitHook({ rootDir, configureGit: true });
  applyGitHook({ rootDir, hook: 'pre-push', configureGit: true });
  applyRuntimeHook({ rootDir });
  const codexHome = join(rootDir, 'tmp-codex-home');
  mkdirp(codexHome);
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2));
  applyCodexHook({ rootDir, codexHome });

  const status = inspectRuntimeIntegrationStatus(rootDir, { codexHome });

  assert.equal(status.gitHook.exists, true);
  assert.equal(status.gitHook.configured, true);
  assert.equal(status.prePushHook.exists, true);
  assert.equal(status.prePushHook.configured, true);
  assert.equal(status.runtimeHook.exists, true);
  assert.equal(status.codexArtifact.exists, true);
  assert.equal(status.codexTarget.checked, true);
  assert.equal(status.codexTarget.targetExists, true);
  assert.equal(status.codexTarget.integrationInstalled, true);
  assert.deepEqual(status.nextCommands, []);
});

test('runtime status treats malformed codex hook JSON as not installed', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-malformed-codex-');
  writeFileSync(join(rootDir, 'tmp-hooks.json'), '{not json}\n');

  const status = inspectRuntimeIntegrationStatus(rootDir, {
    targetHooksFile: 'tmp-hooks.json',
  });

  assert.equal(status.codexTarget.checked, true);
  assert.equal(status.codexTarget.targetExists, true);
  assert.equal(status.codexTarget.integrationInstalled, false);
});

test('runtime status rethrows codex hook target read errors that are not JSON parse failures', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-codex-read-error-');
  mkdirp(join(rootDir, 'tmp-hooks-dir'));

  assert.throws(
    () =>
      inspectRuntimeIntegrationStatus(rootDir, {
        targetHooksFile: 'tmp-hooks-dir',
      }),
    /EISDIR|directory/,
  );
});

test('runtime status recommends repair commands for non-executable managed hooks', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-broken-hooks-');
  applyGitHook({ rootDir, configureGit: true });
  applyRuntimeHook({ rootDir });
  chmodSync(join(rootDir, '.githooks/post-commit'), 0o644);
  chmodSync(join(rootDir, '.veritas/hooks/agent-runtime.sh'), 0o644);

  const status = inspectRuntimeIntegrationStatus(rootDir);

  assert.equal(status.gitHook.exists, true);
  assert.equal(status.gitHook.executable, false);
  assert.equal(status.runtimeHook.exists, true);
  assert.equal(status.runtimeHook.executable, false);
  assert.ok(
    status.nextCommands.includes('npm exec -- veritas setup repo-hooks --force'),
  );
  assert.ok(
    status.nextCommands.includes('npm exec -- veritas integrations codex install --force'),
  );
});

test('runtime status recommends forceful codex repair when the tracked artifact exists but target is stale', () => {
  const rootDir = initCommittedRepo('veritas-runtime-status-codex-repair-');
  const codexHome = join(rootDir, 'tmp-codex-home');
  mkdirp(codexHome);
  writeFileSync(join(codexHome, 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2));
  applyCodexHook({ rootDir, codexHome });
  writeFileSync(
    join(codexHome, 'hooks.json'),
    JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              matcher: '.*',
              hooks: [{ type: 'command', command: 'echo missing-repoMap' }],
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  const status = inspectRuntimeIntegrationStatus(rootDir, { codexHome });

  assert.equal(status.codexArtifact.exists, true);
  assert.equal(status.codexTarget.checked, true);
  assert.equal(status.codexTarget.integrationInstalled, false);
  assert.ok(
    status.nextCommands.includes(
      `npm exec -- veritas integrations codex install --codex-home ${codexHome.replaceAll('\\', '/')} --force`,
    ),
  );
});

test('generated post-commit hook runs successfully after the initial commit boundary', () => {
  const rootDir = initCommittedRepo('veritas-hook-root-commit-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  execFileSync('git', ['add', 'package.json'], { cwd: rootDir, encoding: 'utf8' });
  installLocalVeritasBin(rootDir);

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Hook Root Commit Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  applyGitHook({ rootDir, hook: 'post-commit' });
  commitAll(rootDir, 'Initial guided commit');

  const stdout = execFileSync(join(rootDir, '.githooks/post-commit'), {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.match(stdout, /^veritas: /);
  assert.match(stdout, /PASS\s+evidence-check: node -e "process\.exit\(0\)"/);
  assert.match(stdout, /report: \.kontourai\/veritas\/evidence\//);
});

test('generated post-commit hook runs successfully on a normal subsequent commit path', () => {
  const rootDir = initCommittedRepo('veritas-hook-followup-commit-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  installLocalVeritasBin(rootDir);

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Hook Followup Commit Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  applyGitHook({ rootDir, hook: 'post-commit' });
  commitAll(rootDir, 'Initial guided commit');

  writeFileSync(join(rootDir, 'README.md'), '# changed\n');
  execFileSync('git', ['add', 'README.md'], { cwd: rootDir, encoding: 'utf8' });
  commitAll(rootDir, 'Followup change');

  const stdout = execFileSync(join(rootDir, '.githooks/post-commit'), {
    cwd: rootDir,
    encoding: 'utf8',
  });

  assert.match(stdout, /^veritas: /);
  assert.match(stdout, /1 file changed/);
  assert.match(stdout, /PASS\s+evidence-check: node -e "process\.exit\(0\)"/);
});

test('generated runtime hook runs successfully with the default working-tree path', () => {
  const rootDir = initCommittedRepo('veritas-runtime-hook-run-');
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  installLocalVeritasBin(rootDir);

  execFileSync(
    'npm',
    [
      'exec',
      '--',
      'veritas',
      'init',
      '--root',
      rootDir,
      '--project-name',
      'Runtime Hook Demo',
      '--evidence-check',
      'node -e "process.exit(0)"',
    ],
    { cwd: repoRootDir, encoding: 'utf8' },
  );
  applyRuntimeHook({ rootDir });

  const stdout = execFileSync(join(rootDir, '.veritas/hooks/agent-runtime.sh'), {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const parsed = parseCliJson(stdout);

  assert.equal(parsed.mode, 'report-and-draft');
  assert.deepEqual(parsed.evidenceCheckLabels, ['node -e "process.exit(0)"']);
  assert.equal(parsed.reportSourceKind, 'working-tree');
});

test('adaptive bootstrap detects a workspace-shaped repo', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-workspace-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        workspaces: ['packages/*'],
        scripts: {
          verify: 'turbo run verify',
          test: 'turbo run test',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(rootDir, 'README.md'), '# Workspace\n');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# agents\n');
  mkdirp(join(rootDir, 'packages/app'));
  mkdirp(join(rootDir, 'tests'));
  mkdirp(join(rootDir, '.github/workflows'));

  const result = writeBootstrapStarterKit({ rootDir, projectName: 'Workspace Demo' });
  const repoMap = readJsonFromAbsolute(join(rootDir, '.veritas/repo-map.json'));
  const bootstrapReadme = readFileSync(join(rootDir, '.veritas/README.md'), 'utf8');

  assert.equal(result.repoInsights.repoKind, 'workspace');
  assert.equal(result.evidenceCheck, 'npm run verify');
  assert.ok(repoMap.graph.nodes.some((node) => node.patterns.includes('packages/')));
  assert.deepEqual(repoMap.evidence.defaultEvidenceCheckIds, ['required-evidence-check']);
  assert.equal(repoMap.evidence.uncoveredPathPolicy, 'warn');
  assert.match(bootstrapReadme, /Repo kind: `workspace`/);
  assert.match(bootstrapReadme, /Work-Area Evidence Routing/);
});

test('adaptive bootstrap inventories substantive workspace roots and merges only the shared runtime ignore', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-workspace-inventory-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    private: true,
    workspaces: ['packages/*'],
    scripts: { verify: 'turbo run verify' },
  }, null, 2));
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules/\ncoverage/\n');
  for (const directory of [
    'agent-cards', 'agents', 'context', 'evals', 'kits', 'packaging', 'powers', 'prompts',
    'schemas', 'skills', 'packages/app', 'scripts', 'tests', 'dist', '.kontourai/veritas',
    '.surface/runs',
  ]) {
    mkdirp(join(rootDir, directory));
  }

  const result = writeBootstrapStarterKit({ rootDir, projectName: 'Portfolio Workspace' });
  const repoMap = readJsonFromAbsolute(join(rootDir, '.veritas/repo-map.json'));
  const productPatterns = repoMap.graph.nodes
    .filter((node) => node.id.startsWith('product.'))
    .map((node) => node.patterns[0]);

  assert.deepEqual(result.repoInsights.productRoots, [
    'agent-cards/', 'agents/', 'context/', 'evals/', 'kits/', 'packaging/', 'powers/',
    'prompts/', 'schemas/', 'skills/',
  ]);
  assert.deepEqual(productPatterns, result.repoInsights.productRoots);
  assert.equal(new Set(repoMap.graph.nodes.map((node) => node.id)).size, repoMap.graph.nodes.length);
  assert.equal(productPatterns.includes('dist/'), false);
  const ignore = readFileSync(join(rootDir, '.gitignore'), 'utf8');
  assert.equal(ignore, 'node_modules/\ncoverage/\n\n.kontourai/\n');
  assert.doesNotMatch(ignore, /\.surface|\.veritas/);
  assert.deepEqual(result.generatedOutputIgnores, ['.kontourai/']);

  const repeat = writeBootstrapStarterKit({ rootDir, projectName: 'Portfolio Workspace', force: true });
  assert.deepEqual(repeat.generatedOutputIgnores, []);
  assert.equal(readFileSync(join(rootDir, '.gitignore'), 'utf8').match(/\.kontourai\//g)?.length, 1);
});

test('adaptive bootstrap excludes ignored and generated roots while retaining Git-visible product roots', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-workspace-git-inventory-'));
  execGitFixture(['init', '-b', 'main'], { cwd: rootDir, encoding: 'utf8' });
  writeFileSync(join(rootDir, 'package.json'), '{}\n');
  writeFileSync(join(rootDir, '.gitignore'), 'ignored-product/\n');
  for (const directory of [
    'dist-ui-1784563', 'results', 'scratch', 'out', '_site', 'ignored-product', 'kits',
    'untracked-product',
  ]) {
    mkdirp(join(rootDir, directory));
    writeFileSync(join(rootDir, directory, 'artifact.txt'), `${directory}\n`);
  }
  execGitFixture(
    ['add', 'package.json', '.gitignore', 'kits/artifact.txt'],
    { cwd: rootDir, encoding: 'utf8' },
  );

  const insights = inferBootstrapRepoInsights(rootDir);

  assert.deepEqual(insights.productRoots, ['kits/', 'untracked-product/']);
  assert.equal(insights.productRoots.includes('ignored-product/'), false);
  assert.equal(insights.productRoots.some((root) => root.startsWith('dist-ui-')), false);
  assert.equal(insights.productRoots.includes('results/'), false);
  assert.equal(insights.productRoots.includes('scratch/'), false);
  assert.equal(insights.productRoots.includes('out/'), false);
  assert.equal(insights.productRoots.includes('_site/'), false);
});

test('adaptive bootstrap infers the evidenceCheck through the shipped CLI path', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-workspace-cli-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        workspaces: ['packages/*'],
        scripts: {
          verify: 'turbo run verify',
          test: 'turbo run test',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(rootDir, 'README.md'), '# Workspace\n');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# agents\n');
  mkdirp(join(rootDir, 'packages/app'));

  const initStdout = runLocalVeritas(['init', '--root', rootDir]);
  const initResult = parseCliJson(initStdout);

  assert.equal(initResult.evidenceCheck, 'npm run verify');
  assert.equal(initResult.repoInsights.repoKind, 'workspace');
  assert.equal(initResult.repoInsights.enableWorkAreaEvidenceRouting, true);
});

test('adaptive bootstrap falls back cleanly when git HEAD is detached', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-detached-head-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          verify: 'npm test',
        },
      },
      null,
      2,
    ),
  );
  execFileSync('git', ['init', '-b', 'feature'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Veritas Tests'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  execFileSync('git', ['config', 'user.email', 'veritas-tests@example.com'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  execFileSync('git', ['add', 'package.json'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: rootDir, encoding: 'utf8' });
  execFileSync('git', ['checkout', '--detach', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  const insights = inferBootstrapRepoInsights(rootDir);

  assert.equal(insights.baseRef, '<base-ref>');
  assert.equal(insights.evidenceCheck, 'npm run verify');
});

test('adaptive bootstrap detects a docs-shaped repo', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-docs-'));
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify(
      {
        scripts: {
          'docs:build': 'docusaurus build',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(rootDir, '.gitignore'), 'node_modules\n');
  writeFileSync(join(rootDir, 'README.md'), '# Docs\n');
  writeFileSync(join(rootDir, 'AGENTS.md'), '# agents\n');
  mkdirp(join(rootDir, 'docs'));
  mkdirp(join(rootDir, 'content'));

  const insights = inferBootstrapRepoInsights(rootDir);
  const result = writeBootstrapStarterKit({ rootDir, projectName: 'Docs Demo' });
  const repoMap = readJsonFromAbsolute(join(rootDir, '.veritas/repo-map.json'));

  assert.equal(insights.repoKind, 'docs');
  assert.equal(result.evidenceCheck, 'npm run docs:build');
  assert.ok(
    repoMap.graph.nodes.some(
      (node) => node.kind === 'product-area' && node.patterns.includes('docs/'),
    ),
  );
});

test('starter kit helper refuses to overwrite without force', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-overwrite-'));
  writeBootstrapStarterKit({ rootDir, projectName: 'Overwrite Demo' });

  assert.throws(
    () =>
      writeBootstrapStarterKit({
        rootDir,
        projectName: 'Overwrite Demo',
      }),
    /Refusing to overwrite existing file/,
  );
});

test('starter kit helper rejects instruction targets outside the target root before reading', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-starter-escape-'));
  writeFileSync(join(rootDir, 'package.json'), '{}');
  const secretPath = resolve(rootDir, '../veritas-starter-secret.md');
  writeFileSync(secretPath, '# Secret\n');

  assert.throws(
    () =>
      writeBootstrapStarterKit({
        rootDir,
        projectName: 'Escape Demo',
        instructionTargets: ['../veritas-starter-secret.md'],
      }),
    /bootstrap instruction target path escapes target root/,
  );
  assert.equal(existsSync(join(rootDir, '.veritas/repo-map.json')), false);
  assert.equal(readFileSync(secretPath, 'utf8'), '# Secret\n');
});

test('starter kit planning separates inference from writing', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-init-plan-'));
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: {
      verify: 'node --check index.js',
    },
  }));

  const plan = buildBootstrapStarterKitPlan({ rootDir, projectName: 'Plan Demo' });

  assert.equal(plan.evidenceCheck, 'npm run verify');
  assert.equal(plan.repoInsights.repoKind, 'application');
  assert.ok(plan.generatedFiles.includes('.veritas/repo-map.json'));
  assert.ok(plan.files.some(([filePath]) => filePath.endsWith('.veritas/repo-map.json')));
  assert.equal(existsSync(join(rootDir, '.veritas/repo-map.json')), false);
});

test('script suggestion helper returns the expected keys', () => {
  const scripts = buildSuggestedPackageScripts({
    evidenceCheck: 'npm run verify',
    baseRef: 'main',
  });
  assert.deepEqual(Object.keys(scripts), [
    'veritas:init',
    'veritas:status:codex',
    'veritas:check',
    'veritas:check:working-tree',
    'veritas:check:diff',
    'veritas:coverage',
    'veritas:evidence-check',
    'lint:governance',
    'veritas:readiness',
    'test:prepush',
    'prepush',
  ]);
});
