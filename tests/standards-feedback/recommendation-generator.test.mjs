import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildSurfaceTrustBundle,
  createAttestation,
  initClaimStore,
} from '../../src/index.mjs';
import {
  applyRecommendation,
  generateRuleRecommendations,
  writeGeneratedRecommendations,
} from '../../src/standards-feedback/recommendations.mjs';

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function configureResolvedApprovalPolicy(rootDir) {
  const authorityPath = join(rootDir, '.veritas/authority/default.authority-settings.json');
  const authoritySettings = JSON.parse(readFileSync(authorityPath, 'utf8'));
  authoritySettings.review_preferences.attestation_approval_ref_policy = {
    mode: 'resolved',
    allowed_prefixes: ['veritas-approval:'],
  };
  writeJson(authorityPath, authoritySettings);
}

function writeOfflineApprovalRecord(rootDir, id, record) {
  writeJson(join(rootDir, '.veritas/authority/approval-records', `${id}.approval.json`), {
    schemaVersion: 1,
    id,
    status: 'approved',
    approvalRef: `veritas-approval:${id}`,
    provider: 'veritas-offline',
    authorityRef: id,
    approvedBy: 'change-manager',
    approvedAt: '2026-05-10T00:00:00.000Z',
    ...record,
  });
}

function setupRepo() {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-recommendations-'));
  writeJson(join(rootDir, '.veritas/repo-map.json'), {
    schemaVersion: 1,
    name: 'recommendation-test',
    graph: { nodes: [], defaultResolution: 'manual-review', resolverPrecedence: [], nonSliceableInvariants: [] },
    evidence: {
      reportTransport: 'local-json',
      evidenceChecks: [{ id: 'unit', command: 'npm test', method: 'validation' }],
    },
  });
  writeJson(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), {
    name: 'recommendation-policy',
    version: '1',
    rules: [
      {
        id: 'strict-rule',
        kind: 'required-artifacts',
        classification: 'hard-invariant',
        enforcementLevel: 'Require',
        enforcement: 'deny',
        message: 'Strict rule.',
        match: { artifacts: ['README.md'] },
      },
      {
        id: 'quiet-rule',
        kind: 'required-artifacts',
        classification: 'advisory-pattern',
        enforcementLevel: 'Guide',
        message: 'Quiet rule.',
        match: { artifacts: ['QUIET.md'] },
      },
    ],
  });
  writeJson(join(rootDir, '.veritas/authority/default.authority-settings.json'), {
    id: 'recommendation-team',
    review_preferences: { reviewer_confidence_scale: ['low', 'medium', 'high'] },
  });
  mkdirSync(join(rootDir, '.kontourai/veritas/standards-feedback'), { recursive: true });
  writeFileSync(join(rootDir, '.kontourai/veritas/standards-feedback/history.jsonl'), [
    {
      run_id: 'run-1',
      policy_results: [{ rule_id: 'strict-rule', passed: false, enforcementLevel: 'Require' }],
      exceptions: [{ ruleId: 'strict-rule', reason: 'too strict', actor: 'brian', timestamp: '2026-05-01T00:00:00.000Z' }],
      required_followup: true,
      unresolved_files: ['unknown/path.ts'],
    },
    {
      run_id: 'run-2',
      policy_results: [{ rule_id: 'strict-rule', passed: false, enforcementLevel: 'Require' }],
      exceptions: [{ ruleId: 'strict-rule', reason: 'too strict', actor: 'brian', timestamp: '2026-05-02T00:00:00.000Z' }],
      required_followup: true,
      unresolved_files: ['unknown/path.ts'],
    },
    {
      run_id: 'run-3',
      policy_results: [{ rule_id: 'quiet-rule', passed: true, enforcementLevel: 'Guide' }],
      exceptions: [],
      required_followup: false,
      unresolved_files: [],
    },
  ].map((record) => JSON.stringify(record)).join('\n'));
  writeFileSync(join(rootDir, '.kontourai/veritas/standards-feedback/history.jsonl'), '\n', { flag: 'a' });
  return rootDir;
}

test('standards feedback recommendation generator covers exception and missing surface heuristics', () => {
  const rootDir = setupRepo();
  const recommendations = generateRuleRecommendations({ rootDir, inactiveRunThreshold: 3 });
  assert.ok(recommendations.some((recommendation) => recommendation.type === 'rule-enforcement-relaxation' && recommendation.target === 'strict-rule'));
  assert.ok(recommendations.some((recommendation) => recommendation.type === 'rule-retirement' && recommendation.target === 'quiet-rule'));
  assert.ok(recommendations.some((recommendation) => recommendation.type === 'surface-node-addition' && recommendation.target === 'unknown/path.ts'));
});

test('recommendation artifacts can be accepted and surface as proposed claims before decision', async () => {
  const rootDir = setupRepo();
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'bootstrap',
    approvalRef: 'test://recommendation-bootstrap-human-approval',
  });
  const recommendation = generateRuleRecommendations({ rootDir }).find((item) => item.type === 'rule-enforcement-relaxation');
  const [path] = writeGeneratedRecommendations({ rootDir, recommendations: [recommendation] });
  assert.equal(existsSync(join(rootDir, path)), true);
  await initClaimStore({ rootDir, repoName: 'recommendation-test', force: true });
  const storePath = join(rootDir, 'veritas.claims.json');
  const store = JSON.parse(readFileSync(storePath, 'utf8'));
  store.claims.push({
    id: `recommendation.${recommendation.id}`,
    facet: 'veritas.recommendations',
    claimType: 'veritas-recommendation',
    status: 'proposed',
    fieldOrBehavior: recommendation.type,
    subjectType: 'veritas-recommendation',
    subjectId: recommendation.id,
    impactLevel: 'medium',
    verificationPolicyId: 'veritas.recommendation',
    metadata: { recommendationId: recommendation.id },
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
  });
  store.policies.push({
    id: 'veritas.recommendation',
    claimType: 'veritas-recommendation',
    requiredEvidence: ['policy_rule'],
    requiredMethods: ['auditability'],
    requiresCorroboration: false,
    acceptanceCriteria: ['standards feedback recommendation artifact'],
    reviewAuthority: 'human reviewer',
    validityRule: { kind: 'manual' },
    stalenessTriggers: [],
    conflictRules: [],
    impactLevel: 'medium',
  });
  writeJson(storePath, store);

  const input = await buildSurfaceTrustBundle({
    run_id: 'recommendation-surface-test',
    timestamp: '2026-05-10T00:00:00.000Z',
    source_ref: 'test-ref',
    source_kind: 'working-tree',
    source_scope: ['unstaged'],
    resolved_phase: 'Phase 7',
    resolved_workstream: 'Recommendation test',
    components: [],
    triggered_evidence_checks: [],
    selected_evidence_checks: [],
    policy_results: [],
    evidence_inventory_results: [],
    external_tool_results: [],
    readiness_coverage: null,
    selected_evidence_check_ids: [],
    selected_evidence_check_labels: [],
    evidence_check_resolution_source: 'default',
    baseline_ci_fast_passed: null,
    uncovered_path_result: 'clear',
    files: [],
    unresolved_files: [],
    repoMap: { name: 'recommendation-test', kind: 'repo-map', report_transport: 'local-json' },
    repo_standards: { name: 'recommendation-policy', version: '1', rule_count: 2 },
    recommendations: [],
  }, { rootDir });
  assert.ok(input.claims.some((claim) => claim.claimType === 'veritas-recommendation' && claim.status === 'proposed'));

  const accepted = applyRecommendation({
    rootDir,
    id: recommendation.id,
    actor: 'brian',
    accept: true,
    reject: false,
    message: 'accept recommendation',
    approvalRef: 'test://recommendation-accepted-by-human',
  });
  assert.equal(accepted.status, 'accepted');
  const policy = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), 'utf8'));
  const rule = policy.rules.find((item) => item.id === 'strict-rule');
  assert.equal(rule.enforcement, 'advisory');
  assert.equal(rule.enforcementLevel, 'Guide');
});

test('recommendation rejection records decision and suppresses immediate regeneration', () => {
  const rootDir = setupRepo();
  const recommendation = generateRuleRecommendations({ rootDir, now: '2026-05-10T00:00:00.000Z' })
    .find((item) => item.type === 'rule-enforcement-relaxation');
  writeGeneratedRecommendations({ rootDir, recommendations: [recommendation] });

  const rejected = applyRecommendation({
    rootDir,
    id: recommendation.id,
    actor: 'brian',
    accept: false,
    reject: true,
    message: 'keep this strict',
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.decision.actor, 'brian');
  assert.equal(rejected.attestation, undefined);
  const policy = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), 'utf8'));
  const rule = policy.rules.find((item) => item.id === 'strict-rule');
  assert.equal(rule.enforcement, 'deny');
  assert.equal(rule.enforcementLevel, 'Require');

  const regenerated = generateRuleRecommendations({
    rootDir,
    now: '2026-05-11T00:00:00.000Z',
  });
  assert.equal(regenerated.some((item) => item.id === recommendation.id), false);
});

test('recommendation acceptance blocks invalid resolved approval before mutating standards', () => {
  const rootDir = setupRepo();
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'bootstrap',
    approvalRef: 'test://recommendation-bootstrap-human-approval',
  });
  configureResolvedApprovalPolicy(rootDir);
  writeOfflineApprovalRecord(rootDir, 'rejected', {
    status: 'rejected',
    failureReason: 'change was rejected',
  });
  const recommendation = generateRuleRecommendations({ rootDir }).find((item) => item.type === 'rule-enforcement-relaxation');
  writeGeneratedRecommendations({ rootDir, recommendations: [recommendation] });

  assert.throws(
    () => applyRecommendation({
      rootDir,
      id: recommendation.id,
      actor: 'brian',
      accept: true,
      reject: false,
      message: 'accept recommendation',
      approvalRef: 'veritas-approval:rejected',
    }),
    /approval reference was not accepted by resolver: rejected/,
  );

  const policy = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-standards/default.repo-standards.json'), 'utf8'));
  const rule = policy.rules.find((item) => item.id === 'strict-rule');
  assert.equal(rule.enforcement, 'deny');
  assert.equal(rule.enforcementLevel, 'Require');
});
