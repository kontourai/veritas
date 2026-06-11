import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { buildGovernanceBlock, replaceGovernanceBlock } from '../governance.mjs';
import { inferBootstrapRepoInsights } from './insights.mjs';
import { buildBootstrapReadme } from './readme.mjs';
import {
  buildAdaptiveNodes,
  buildStarterRepoMap,
  buildStarterRepoStandards,
  buildStarterAuthoritySettings,
} from './starter-artifacts.mjs';
import {
  OPTIONAL_INSTRUCTION_TARGETS,
  buildGovernanceInstructions,
  buildSuggestedCodeownersBlock,
  selectedInstructionTargetsFromAnswers,
  validateOwnerAnswers,
} from './guidance.mjs';
import { assertWithinDir } from '../paths.mjs';

const INIT_RECOMMENDATION_SCHEMA_VERSION = 1;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonPayload(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function recommendedEvidenceChecks(repoInsights) {
  return [
    {
      id: 'required-evidence-check',
      command: repoInsights.evidenceCheck,
      method: 'validation',
      reason: repoInsights.matchedScripts.length > 0
        ? `Selected from package script priority; matched scripts: ${repoInsights.matchedScripts.join(', ')}.`
        : 'Fallback evidenceCheck because no known package scripts were detected.',
      confidence: repoInsights.matchedScripts.length > 0 ? 'high' : 'low',
      source: repoInsights.matchedScripts.length > 0 ? 'package.json scripts' : 'fallback',
    },
  ];
}

function recommendedSurfaces(repoInsights) {
  return buildAdaptiveNodes(repoInsights).map((node) => ({
    ...node,
    risk: node.kind === 'protected-area' ? 'high' : 'medium',
    reason: `Detected ${node.label} as ${node.kind}.`,
  }));
}

function validateInstructionTargetPaths(rootDir, selectedInstructionTargets) {
  for (const target of selectedInstructionTargets) {
    if (isAbsolute(target.path)) {
      throw new Error(`init instruction target path must be repo-relative: ${target.path}`);
    }
    assertWithinDir(
      resolve(rootDir, target.path),
      rootDir,
      `init instruction target path escapes target root: ${target.path}`,
    );
  }
}

function ownerQuestions(repoInsights) {
  const questions = [
    {
      id: 'canonical-evidenceCheck',
      group: 'evidenceCheck',
      question: `Is \`${repoInsights.evidenceCheck}\` the command that should prove repo health before AI-authored changes are considered ready?`,
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
      question: 'No package.json was detected. What command should Veritas use as the initial evidenceCheck?',
    });
  }

  if (repoInsights.existingVerification?.detected) {
    questions.push({
      id: 'existing-verification-inventory',
      group: 'brownfield',
      question: 'Which existing verification checks have recent catch evidence, and which should move to tests, stay candidate, or retire?',
    });
  }

  return questions;
}

function recommendedEvidenceInventory(repoInsights) {
  return (repoInsights.existingVerification?.items ?? []).map((item) => ({
    id: item.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'existing-verification',
    source_kind: item.kind,
    source: item.command ?? item.path,
    default_disposition: item.recommendedDisposition,
    recent_catch_evidence: 'unknown',
    owner: null,
    replacement_test_available: null,
    review_trigger: 'review before promoting this existing check to required',
    rationale: item.reason,
  }));
}

function buildArtifactPayloads({ rootDir, projectName, evidenceCheck, repoInsights, selectedInstructionTargets, ownerAnswers }) {
  const repoMap = buildStarterRepoMap({
    projectName,
    evidenceCheck,
    repoInsights,
    instructionTargets: selectedInstructionTargets,
  });
  const repoStandards = buildStarterRepoStandards({ projectName, instructionTargets: selectedInstructionTargets });
  const authoritySettings = buildStarterAuthoritySettings({ projectName, evidenceCheck });
  const recommendationSummary = [
    `- Mode: guided initialization artifact`,
    `- Repo kind: \`${repoInsights.repoKind}\``,
    `- Evidence Check: \`${evidenceCheck}\``,
    `- Selected instruction targets: ${selectedInstructionTargets.map((target) => `\`${target.path}\``).join(', ') || '`none`'}`,
  ].join('\n');
  const governanceBlock = buildGovernanceBlock();
  const payloads = {
    '.veritas/README.md': buildBootstrapReadme({
      projectName,
      evidenceCheck,
      repoInsights,
      recommendationSummary,
      ownerAnswers,
    }),
    '.veritas/GOVERNANCE.md': buildGovernanceInstructions(),
    '.veritas/repo-map.json': jsonPayload(repoMap),
    '.veritas/repo-standards/default.repo-standards.json': jsonPayload(repoStandards),
    '.veritas/authority/default.authority-settings.json': jsonPayload(authoritySettings),
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
  evidenceCheck,
  answers,
  mode = 'explore',
}) {
  const ownerAnswers = validateOwnerAnswers(answers);
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedEvidenceCheck = ownerAnswers.evidenceCheck ?? evidenceCheck ?? repoInsights.evidenceCheck;
  const selectedInstructionTargets = selectedInstructionTargetsFromAnswers(ownerAnswers);
  validateInstructionTargetPaths(rootDir, selectedInstructionTargets);
  const artifactPayloads = buildArtifactPayloads({
    rootDir,
    projectName,
    evidenceCheck: resolvedEvidenceCheck,
    repoInsights,
    selectedInstructionTargets,
    ownerAnswers,
  });

  return {
    schema_version: INIT_RECOMMENDATION_SCHEMA_VERSION,
    mode,
    target_root: resolve(rootDir),
    project_name: projectName,
    evidenceCheck: resolvedEvidenceCheck,
    repo_insights: repoInsights,
    artifact_payloads: artifactPayloads,
    artifact_hashes: artifactHashes(artifactPayloads),
    recommended_repo_map: JSON.parse(artifactPayloads['.veritas/repo-map.json']),
    recommended_repo_standards: JSON.parse(artifactPayloads['.veritas/repo-standards/default.repo-standards.json']),
    recommended_authority_settings: JSON.parse(artifactPayloads['.veritas/authority/default.authority-settings.json']),
    recommended_evidence_checks: recommendedEvidenceChecks({ ...repoInsights, evidenceCheck: resolvedEvidenceCheck }),
    recommended_evidence_inventory: recommendedEvidenceInventory(repoInsights),
    existing_verification: repoInsights.existingVerification,
    recommended_surfaces: recommendedSurfaces(repoInsights),
    recommended_instruction_targets: recommendedInstructionTargets(rootDir, selectedInstructionTargets),
    selected_instruction_targets: selectedInstructionTargets,
    owner_questions: ownerQuestions(repoInsights),
    owner_answers: ownerAnswers,
    apply_command: 'npx @kontourai/veritas init --apply --plan <path-to-this-artifact>',
    reasoning_summary: [
      `Detected repo kind \`${repoInsights.repoKind}\`.`,
      `Selected evidenceCheck \`${resolvedEvidenceCheck}\`.`,
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
    if (isAbsolute(path)) {
      throw new Error(`init recommendation artifact path must be repo-relative: ${path}`);
    }
    assertWithinDir(
      resolve(rootDir, path),
      rootDir,
      `init recommendation artifact path escapes target root: ${path}`,
    );
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
    '.veritas/repo-map.json',
    '.veritas/repo-standards/default.repo-standards.json',
    '.veritas/authority/default.authority-settings.json',
  ];
  for (const path of starterPaths) {
    const absolutePath = resolve(rootDir, path);
    if (existsSync(absolutePath) && !force) {
      throw new Error(`Refusing to overwrite existing file: ${path} (use --force to replace it)`);
    }
  }

  mkdirSync(resolve(rootDir, '.veritas/repo-standards'), { recursive: true });
  mkdirSync(resolve(rootDir, '.veritas/authority'), { recursive: true });
  mkdirSync(resolve(rootDir, '.veritas/evidence'), { recursive: true });

  for (const [path, payload] of Object.entries(recommendation.artifact_payloads)) {
    const absolutePath = resolve(rootDir, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, payload, 'utf8');
  }

  return {
    rootDir,
    projectName: recommendation.project_name,
    evidenceCheck: recommendation.evidenceCheck,
    repoInsights: recommendation.repo_insights,
    codeownersBlock: buildSuggestedCodeownersBlock(),
    generatedFiles: [
      ...Object.keys(recommendation.artifact_payloads),
      '.veritas/evidence/',
    ],
  };
}
