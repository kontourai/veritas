import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyProposal,
  buildSurfaceTrustInput,
  createAttestation,
  generateRuleProposals,
  initClaimStore,
  writeGeneratedProposals,
} from '../../src/index.mjs';

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function setupRepo() {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-proposals-'));
  writeJson(join(rootDir, '.veritas/repo.adapter.json'), {
    schemaVersion: 1,
    name: 'proposal-test',
    graph: { nodes: [], defaultResolution: 'manual-review', resolverPrecedence: [], nonSliceableInvariants: [] },
    evidence: {
      reportTransport: 'local-json',
      proofLanes: [{ id: 'unit', command: 'npm test', method: 'validation' }],
    },
  });
  writeJson(join(rootDir, '.veritas/policy-packs/default.policy-pack.json'), {
    name: 'proposal-policy',
    version: '1',
    rules: [
      {
        id: 'strict-rule',
        kind: 'required-artifacts',
        classification: 'hard-invariant',
        stage: 'block',
        enforcement: 'deny',
        message: 'Strict rule.',
        match: { artifacts: ['README.md'] },
      },
      {
        id: 'quiet-rule',
        kind: 'required-artifacts',
        classification: 'advisory-pattern',
        stage: 'warn',
        message: 'Quiet rule.',
        match: { artifacts: ['QUIET.md'] },
      },
    ],
  });
  writeJson(join(rootDir, '.veritas/team/default.team-profile.json'), {
    id: 'proposal-team',
    review_preferences: { reviewer_confidence_scale: ['low', 'medium', 'high'] },
  });
  mkdirSync(join(rootDir, '.veritas/evals'), { recursive: true });
  writeFileSync(join(rootDir, '.veritas/evals/history.jsonl'), [
    {
      run_id: 'run-1',
      policy_results: [{ rule_id: 'strict-rule', passed: false, stage: 'block' }],
      overrides: [{ ruleId: 'strict-rule', reason: 'too strict', actor: 'brian', timestamp: '2026-05-01T00:00:00.000Z' }],
      required_followup: true,
      unresolved_files: ['unknown/path.ts'],
    },
    {
      run_id: 'run-2',
      policy_results: [{ rule_id: 'strict-rule', passed: false, stage: 'block' }],
      overrides: [{ ruleId: 'strict-rule', reason: 'too strict', actor: 'brian', timestamp: '2026-05-02T00:00:00.000Z' }],
      required_followup: true,
      unresolved_files: ['unknown/path.ts'],
    },
    {
      run_id: 'run-3',
      policy_results: [{ rule_id: 'quiet-rule', passed: true, stage: 'warn' }],
      overrides: [],
      required_followup: false,
      unresolved_files: [],
    },
  ].map((record) => JSON.stringify(record)).join('\n'));
  writeFileSync(join(rootDir, '.veritas/evals/history.jsonl'), '\n', { flag: 'a' });
  return rootDir;
}

test('eval proposal generator covers override and missing surface heuristics', () => {
  const rootDir = setupRepo();
  const proposals = generateRuleProposals({ rootDir, inactiveRunThreshold: 3 });
  assert.ok(proposals.some((proposal) => proposal.type === 'rule-enforcement-relaxation' && proposal.target === 'strict-rule'));
  assert.ok(proposals.some((proposal) => proposal.type === 'rule-retirement' && proposal.target === 'quiet-rule'));
  assert.ok(proposals.some((proposal) => proposal.type === 'surface-node-addition' && proposal.target === 'unknown/path.ts'));
});

test('proposal artifacts can be accepted and surface as proposed claims before decision', async () => {
  const rootDir = setupRepo();
  createAttestation({
    rootDir,
    kind: 'bootstrap',
    actor: 'brian',
    notes: 'bootstrap',
  });
  const proposal = generateRuleProposals({ rootDir }).find((item) => item.type === 'rule-enforcement-relaxation');
  const [path] = writeGeneratedProposals({ rootDir, proposals: [proposal] });
  assert.equal(existsSync(join(rootDir, path)), true);
  await initClaimStore({ rootDir, repoName: 'proposal-test', force: true });
  const storePath = join(rootDir, 'veritas.claims.json');
  const store = JSON.parse(readFileSync(storePath, 'utf8'));
  store.claims.push({
    id: `proposal.${proposal.id}`,
    surface: 'veritas.proposals',
    claimType: 'veritas-proposal',
    status: 'proposed',
    fieldOrBehavior: proposal.type,
    subjectType: 'veritas-proposal',
    subjectId: proposal.id,
    impactLevel: 'medium',
    verificationPolicyId: 'veritas.proposal',
    metadata: { proposalId: proposal.id },
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
  });
  store.policies.push({
    id: 'veritas.proposal',
    claimType: 'veritas-proposal',
    requiredEvidence: ['policy_rule'],
    requiredMethods: ['auditability'],
    requiresCorroboration: false,
    requiredProof: ['eval proposal artifact'],
    reviewAuthority: 'human reviewer',
    validityRule: { kind: 'manual' },
    stalenessTriggers: [],
    conflictRules: [],
    impactLevel: 'medium',
  });
  writeJson(storePath, store);

  const input = await buildSurfaceTrustInput({
    run_id: 'proposal-surface-test',
    timestamp: '2026-05-10T00:00:00.000Z',
    source_ref: 'test-ref',
    source_kind: 'working-tree',
    source_scope: ['unstaged'],
    resolved_phase: 'Phase 7',
    resolved_workstream: 'Proposal test',
    affected_nodes: [],
    affected_lanes: [],
    selected_proof_lanes: [],
    policy_results: [],
    proof_family_results: [],
    external_tool_results: [],
    verification_budget: null,
    selected_proof_commands: [],
    proof_resolution_source: 'default',
    baseline_ci_fast_passed: null,
    uncovered_path_result: 'clear',
    files: [],
    unresolved_files: [],
    adapter: { name: 'proposal-test', kind: 'repo-adapter', report_transport: 'local-json' },
    policy_pack: { name: 'proposal-policy', version: '1', rule_count: 2 },
    recommendations: [],
  }, { rootDir });
  assert.ok(input.claims.some((claim) => claim.claimType === 'veritas-proposal' && claim.status === 'proposed'));

  const accepted = applyProposal({
    rootDir,
    id: proposal.id,
    actor: 'brian',
    accept: true,
    reject: false,
    message: 'accept proposal',
  });
  assert.equal(accepted.status, 'accepted');
  const policy = JSON.parse(readFileSync(join(rootDir, '.veritas/policy-packs/default.policy-pack.json'), 'utf8'));
  const rule = policy.rules.find((item) => item.id === 'strict-rule');
  assert.equal(rule.enforcement, 'lint');
  assert.equal(rule.stage, 'warn');
});

test('proposal rejection records decision and suppresses immediate regeneration', () => {
  const rootDir = setupRepo();
  const proposal = generateRuleProposals({ rootDir, now: '2026-05-10T00:00:00.000Z' })
    .find((item) => item.type === 'rule-enforcement-relaxation');
  writeGeneratedProposals({ rootDir, proposals: [proposal] });

  const rejected = applyProposal({
    rootDir,
    id: proposal.id,
    actor: 'brian',
    accept: false,
    reject: true,
    message: 'keep this strict',
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.decision.actor, 'brian');
  assert.equal(rejected.attestation, undefined);
  const policy = JSON.parse(readFileSync(join(rootDir, '.veritas/policy-packs/default.policy-pack.json'), 'utf8'));
  const rule = policy.rules.find((item) => item.id === 'strict-rule');
  assert.equal(rule.enforcement, 'deny');
  assert.equal(rule.stage, 'block');

  const regenerated = generateRuleProposals({
    rootDir,
    now: '2026-05-11T00:00:00.000Z',
  });
  assert.equal(regenerated.some((item) => item.id === proposal.id), false);
});
