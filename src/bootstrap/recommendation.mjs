import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { buildGovernanceBlock, replaceGovernanceBlock } from '../governance.mjs';
import {
  buildAdaptiveNodes,
  buildStarterAdapter,
  buildStarterPolicyPack,
  buildStarterTeamProfile,
  buildBootstrapReadme,
  buildGovernanceInstructions,
  buildSuggestedCodeownersBlock,
  inferBootstrapRepoInsights,
} from '../bootstrap.mjs';

const OPTIONAL_INSTRUCTION_TARGETS = [
  { path: '.cursorrules', tool: 'cursor', required: false },
  {
    path: '.github/copilot-instructions.md',
    tool: 'github-copilot',
    required: false,
  },
];

const INIT_RECOMMENDATION_SCHEMA_VERSION = 1;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonPayload(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toolForInstructionPath(path) {
  if (path === 'AGENTS.md') return 'codex';
  if (path === 'CLAUDE.md') return 'claude-code';
  if (path === '.cursorrules') return 'cursor';
  if (path === '.github/copilot-instructions.md') return 'github-copilot';
  return 'agent';
}

function normalizeInstructionTargets(targets) {
  if (!Array.isArray(targets)) {
    return [
      { path: 'AGENTS.md', tool: 'codex', required: true },
      { path: 'CLAUDE.md', tool: 'claude-code', required: true },
    ];
  }
  return targets.map((target) => {
    if (typeof target === 'string') {
      return {
        path: target,
        tool: toolForInstructionPath(target),
        required: target === 'AGENTS.md' || target === 'CLAUDE.md',
      };
    }
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error('selectedInstructionTargets must contain strings or target objects');
    }
    if (typeof target.path !== 'string' || target.path.length === 0) {
      throw new Error('selectedInstructionTargets entries require a path');
    }
    return {
      path: target.path,
      tool: typeof target.tool === 'string' && target.tool.length > 0 ? target.tool : toolForInstructionPath(target.path),
      required: typeof target.required === 'boolean' ? target.required : target.path === 'AGENTS.md' || target.path === 'CLAUDE.md',
    };
  });
}

function selectedInstructionTargetsFromAnswers(answers) {
  return normalizeInstructionTargets(answers?.selectedInstructionTargets ?? answers?.selected_instruction_targets);
}

function validateOwnerAnswers(answers) {
  if (answers === undefined || answers === null) return {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('init answers must be an object');
  }
  const allowedKeys = new Set([
    'proofLane',
    'proof_lane',
    'selectedInstructionTargets',
    'selected_instruction_targets',
    'boundaries',
    'codingStyle',
    'coding_style',
    'releaseExpectations',
    'release_expectations',
    'reviewRules',
    'review_rules',
    'protectedPaths',
    'protected_paths',
    'notes',
  ]);
  for (const key of Object.keys(answers)) {
    if (!allowedKeys.has(key)) throw new Error(`init answers contain unsupported key: ${key}`);
  }
  const selected = answers.selectedInstructionTargets ?? answers.selected_instruction_targets;
  if (selected !== undefined && !Array.isArray(selected)) {
    throw new Error('init answers selectedInstructionTargets must be an array');
  }
  return answers;
}
function recommendedInstructionTargets(rootDir, selectedInstructionTargets) {
  const selectedPaths = new Set(selectedInstructionTargets.map((target) => target.path));
  return [...selectedInstructionTargets, ...OPTIONAL_INSTRUCTION_TARGETS.filter((target) => !selectedPaths.has(target.path))].map((target) => {
    const absolutePath = resolve(rootDir, target.path);
    const existingContent = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
    return {
      ...target,
      exists: existsSync(absolutePath),
      selected: selectedPaths.has(target.path),
      has_governance_block: existingContent.includes('veritas:governance-block:start'),
      reason: selectedPaths.has(target.path)
        ? 'Selected for starter governance block activation.'
        : 'Known optional AI instruction surface; review before selecting.',
    };
  });
}

function recommendedProofLanes(repoInsights) {
  return [
    {
      id: 'required-proof',
      command: repoInsights.proofLane,
      method: 'validation',
      reason: repoInsights.matchedScripts.length > 0
        ? `Selected from package script priority; matched scripts: ${repoInsights.matchedScripts.join(', ')}.`
        : 'Fallback proof lane because no known package scripts were detected.',
      confidence: repoInsights.matchedScripts.length > 0 ? 'high' : 'low',
      source: repoInsights.matchedScripts.length > 0 ? 'package.json scripts' : 'fallback',
    },
  ];
}

function recommendedSurfaces(repoInsights) {
  return buildAdaptiveNodes(repoInsights).map((node) => ({
    ...node,
    risk: node.kind === 'governance-surface' ? 'high' : 'medium',
    reason: `Detected ${node.label} as ${node.kind}.`,
  }));
}

function ownerQuestions(repoInsights) {
  const questions = [
    {
      id: 'canonical-proof-lane',
      group: 'proof',
      question: `Is \`${repoInsights.proofLane}\` the command that should prove repo health before AI-authored changes are considered ready?`,
    },
    {
      id: 'protected-paths',
      group: 'boundaries',
      question: 'Which files or directories should agents avoid changing without explicit human approval?',
    },
    {
      id: 'coding-style',
      group: 'style',
      question: 'What coding style or local conventions should Veritas surface in repo guidance?',
    },
    {
      id: 'release-expectations',
      group: 'release',
      question: 'Which checks distinguish a local change from a release-ready change?',
    },
    {
      id: 'instruction-targets',
      group: 'activation',
      question: 'Which AI instruction files should Veritas mutate during apply?',
    },
  ];

  if (repoInsights.packageManager === 'unknown') {
    questions.push({
      id: 'package-manager',
      group: 'tooling',
      question: 'No package.json was detected. What command should Veritas use as the initial proof lane?',
    });
  }

  if (repoInsights.legacyVerification?.detected) {
    questions.push({
      id: 'legacy-verification-inventory',
      group: 'brownfield',
      question: 'Which legacy verification checks have recent catch evidence, and which should move to tests, stay candidate, or retire?',
    });
  }

  return questions;
}

function recommendedProofFamilyInventory(repoInsights) {
  return (repoInsights.legacyVerification?.items ?? []).map((item) => ({
    id: item.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'legacy-verification',
    source_kind: item.kind,
    source: item.command ?? item.path,
    default_disposition: item.recommendedDisposition,
    recent_catch_evidence: 'unknown',
    owner: null,
    replacement_test_available: null,
    review_trigger: 'review before promoting this legacy check to required',
    rationale: item.reason,
  }));
}

function buildArtifactPayloads({ rootDir, projectName, proofLane, repoInsights, selectedInstructionTargets, ownerAnswers }) {
  const adapter = buildStarterAdapter({
    projectName,
    proofLane,
    repoInsights,
    instructionTargets: selectedInstructionTargets,
  });
  const policyPack = buildStarterPolicyPack({ projectName, instructionTargets: selectedInstructionTargets });
  const teamProfile = buildStarterTeamProfile({ projectName, proofLane });
  const recommendationSummary = [
    `- Mode: guided initialization artifact`,
    `- Repo kind: \`${repoInsights.repoKind}\``,
    `- Proof lane: \`${proofLane}\``,
    `- Selected instruction targets: ${selectedInstructionTargets.map((target) => `\`${target.path}\``).join(', ') || '`none`'}`,
  ].join('\n');
  const governanceBlock = buildGovernanceBlock();
  const payloads = {
    '.veritas/README.md': buildBootstrapReadme({
      projectName,
      proofLane,
      repoInsights,
      recommendationSummary,
      ownerAnswers,
    }),
    '.veritas/GOVERNANCE.md': buildGovernanceInstructions(),
    '.veritas/repo.adapter.json': jsonPayload(adapter),
    '.veritas/policy-packs/default.policy-pack.json': jsonPayload(policyPack),
    '.veritas/team/default.team-profile.json': jsonPayload(teamProfile),
  };

  for (const target of selectedInstructionTargets) {
    const absolutePath = resolve(rootDir, target.path);
    const existingContent = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
    payloads[target.path] = replaceGovernanceBlock(existingContent, governanceBlock);
  }

  return payloads;
}

function artifactHashes(payloads) {
  return Object.fromEntries(Object.entries(payloads).map(([path, payload]) => [path, sha256Hex(payload)]));
}

export function buildInitRecommendation({
  rootDir,
  projectName = basename(resolve(rootDir)),
  proofLane,
  answers,
  mode = 'explore',
}) {
  const ownerAnswers = validateOwnerAnswers(answers);
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedProofLane = ownerAnswers.proofLane ?? ownerAnswers.proof_lane ?? proofLane ?? repoInsights.proofLane;
  const selectedInstructionTargets = selectedInstructionTargetsFromAnswers(ownerAnswers);
  const artifactPayloads = buildArtifactPayloads({
    rootDir,
    projectName,
    proofLane: resolvedProofLane,
    repoInsights,
    selectedInstructionTargets,
    ownerAnswers,
  });

  return {
    schema_version: INIT_RECOMMENDATION_SCHEMA_VERSION,
    mode,
    target_root: resolve(rootDir),
    project_name: projectName,
    proof_lane: resolvedProofLane,
    repo_insights: repoInsights,
    artifact_payloads: artifactPayloads,
    artifact_hashes: artifactHashes(artifactPayloads),
    recommended_adapter: JSON.parse(artifactPayloads['.veritas/repo.adapter.json']),
    recommended_policy_pack: JSON.parse(artifactPayloads['.veritas/policy-packs/default.policy-pack.json']),
    recommended_team_profile: JSON.parse(artifactPayloads['.veritas/team/default.team-profile.json']),
    recommended_proof_lanes: recommendedProofLanes({ ...repoInsights, proofLane: resolvedProofLane }),
    recommended_proof_family_inventory: recommendedProofFamilyInventory(repoInsights),
    legacy_verification: repoInsights.legacyVerification,
    recommended_surfaces: recommendedSurfaces(repoInsights),
    recommended_instruction_targets: recommendedInstructionTargets(rootDir, selectedInstructionTargets),
    selected_instruction_targets: selectedInstructionTargets,
    owner_questions: ownerQuestions(repoInsights),
    owner_answers: ownerAnswers,
    apply_command: 'npx @kontourai/veritas init --apply --plan <path-to-this-artifact>',
    reasoning_summary: [
      `Detected repo kind \`${repoInsights.repoKind}\`.`,
      `Selected proof lane \`${resolvedProofLane}\`.`,
      `Selected instruction targets: ${selectedInstructionTargets.map((target) => target.path).join(', ')}.`,
    ],
  };
}

function validateInitRecommendation(recommendation, rootDir) {
  if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) {
    throw new Error('init recommendation must be an object');
  }
  if (recommendation.schema_version !== INIT_RECOMMENDATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported init recommendation schema_version: ${String(recommendation.schema_version)}`);
  }
  if (resolve(recommendation.target_root) !== resolve(rootDir)) {
    throw new Error(`Init recommendation target_root does not match current root: ${recommendation.target_root}`);
  }
  if (!recommendation.artifact_payloads || typeof recommendation.artifact_payloads !== 'object') {
    throw new Error('init recommendation missing artifact_payloads');
  }
  if (!recommendation.artifact_hashes || typeof recommendation.artifact_hashes !== 'object') {
    throw new Error('init recommendation missing artifact_hashes');
  }
  for (const [path, payload] of Object.entries(recommendation.artifact_payloads)) {
    if (typeof payload !== 'string') throw new Error(`init recommendation payload must be a string: ${path}`);
    const expectedHash = recommendation.artifact_hashes[path];
    if (expectedHash !== sha256Hex(payload)) {
      throw new Error(`init recommendation payload hash mismatch: ${path}`);
    }
  }
}

export function applyInitRecommendation({ rootDir, recommendation, force = false }) {
  validateInitRecommendation(recommendation, rootDir);
  const starterPaths = [
    '.veritas/README.md',
    '.veritas/GOVERNANCE.md',
    '.veritas/repo.adapter.json',
    '.veritas/policy-packs/default.policy-pack.json',
    '.veritas/team/default.team-profile.json',
  ];
  for (const path of starterPaths) {
    const absolutePath = resolve(rootDir, path);
    if (existsSync(absolutePath) && !force) {
      throw new Error(`Refusing to overwrite existing file: ${path} (use --force to replace it)`);
    }
  }

  mkdirSync(resolve(rootDir, '.veritas/policy-packs'), { recursive: true });
  mkdirSync(resolve(rootDir, '.veritas/team'), { recursive: true });
  mkdirSync(resolve(rootDir, '.veritas/evidence'), { recursive: true });

  for (const [path, payload] of Object.entries(recommendation.artifact_payloads)) {
    const absolutePath = resolve(rootDir, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, payload, 'utf8');
  }

  return {
    rootDir,
    projectName: recommendation.project_name,
    proofLane: recommendation.proof_lane,
    repoInsights: recommendation.repo_insights,
    codeownersBlock: buildSuggestedCodeownersBlock(),
    generatedFiles: [
      ...Object.keys(recommendation.artifact_payloads),
      '.veritas/evidence/',
    ],
  };
}

