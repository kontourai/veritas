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
  KNOWN_INSTRUCTION_TARGETS,
  buildGovernanceInstructions,
  buildSuggestedCodeownersBlock,
  selectedInstructionTargetsFromAnswers,
  validateInstructionTargetPaths,
  validateOwnerAnswers,
} from './guidance.mjs';
import { GENERATED_OUTPUT_IGNORE_ENTRIES, mergeGeneratedOutputIgnores } from './generated-output-ignore.mjs';
import { assertWithinDir, veritasArtifactPath, veritasArtifactRepoPath } from '../paths.mjs';

const INIT_RECOMMENDATION_SCHEMA_VERSION = 1;
const GOVERNANCE_CORE_PATHS = [
  '.veritas/README.md',
  '.veritas/GOVERNANCE.md',
  '.veritas/repo-map.json',
  '.veritas/repo-standards/default.repo-standards.json',
  '.veritas/authority/default.authority-settings.json',
];

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonPayload(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function recommendedInstructionTargets(rootDir, selectedInstructionTargets) {
  const selectedPaths = new Set(selectedInstructionTargets.map((target) => target.path));
  return [...selectedInstructionTargets, ...KNOWN_INSTRUCTION_TARGETS.filter((target) => !selectedPaths.has(target.path))].map((target) => {
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
  const hasConflicts = repoInsights.existingVerification?.conflicts?.length > 0;
  const reason = hasConflicts
    ? 'Conflicting package-script or authoritative instruction-file verification signals detected; review before promoting this check.'
    : repoInsights.evidenceCheckSource === 'repo-declared AI instructions'
      ? 'Selected from an authoritative repository AI instruction file.'
      : repoInsights.evidenceCheckSource === 'node runtime smoke fallback'
        ? 'No package manifest was detected; selected a Node runtime smoke check until an owner supplies a project evidenceCheck.'
      : repoInsights.matchedScripts.length > 0
        ? `Selected from package script priority; matched scripts: ${repoInsights.matchedScripts.join(', ')}.`
        : 'Fallback evidenceCheck because no known package scripts were detected.';
  return [
    {
      id: 'required-evidence-check',
      command: repoInsights.evidenceCheck,
      method: 'validation',
      reason,
      confidence: repoInsights.evidenceCheckConfidence,
      source: repoInsights.evidenceCheckSource,
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

function ownerQuestions(repoInsights, existingGovernance) {
  const questions = [
    {
      id: 'canonical-evidenceCheck',
      group: 'evidenceCheck',
      question: repoInsights.packageManager === 'unknown'
        ? `No package manifest was detected, so Veritas selected \`${repoInsights.evidenceCheck}\` only as an engine smoke check. What project evidenceCheck should replace it before promotion?`
        : `Is \`${repoInsights.evidenceCheck}\` the command that should prove repo health before AI-authored changes are considered ready?`,
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

  if (repoInsights.externalBoundaries?.length > 0) {
    questions.push({
      id: 'external-authority-boundaries',
      group: 'boundaries',
      question: 'Are the repository-declared external authorities and dependency directions complete and current?',
    });
  }

  if (existingGovernance.detected) {
    questions.push({
      id: 'replace-existing-governance',
      group: 'brownfield',
      question: 'Veritas detected existing authored governance. Should re-authoring explicitly replace it instead of preserving it and adding only uncovered work areas?',
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

function existingGovernanceState(rootDir) {
  const presentPaths = GOVERNANCE_CORE_PATHS.filter((path) => existsSync(resolve(rootDir, path)));
  return {
    detected: presentPaths.includes('.veritas/repo-map.json')
      && presentPaths.includes('.veritas/repo-standards/default.repo-standards.json')
      && presentPaths.includes('.veritas/authority/default.authority-settings.json'),
    present_paths: presentPaths,
  };
}

function pathCoveredByExistingNode(pattern, existingNodes) {
  return existingNodes.some((node) => (node.patterns ?? []).some((existingPattern) => existingPattern === pattern));
}

function mergeDiscoveredNodes(existingRepoMap, starterRepoMap) {
  const merged = structuredClone(existingRepoMap);
  const existingNodes = Array.isArray(merged.graph?.nodes) ? merged.graph.nodes : [];
  const discoveredNodes = Array.isArray(starterRepoMap.graph?.nodes) ? starterRepoMap.graph.nodes : [];
  const existingIds = new Set(existingNodes.map((node) => node.id));
  const appendedNodes = discoveredNodes.filter((node) => {
    if (existingIds.has(node.id)) return false;
    const patterns = Array.isArray(node.patterns) ? node.patterns : [];
    return patterns.some((pattern) => !pathCoveredByExistingNode(pattern, existingNodes));
  });
  if (!merged.graph || typeof merged.graph !== 'object') merged.graph = {};
  merged.graph.nodes = [...existingNodes, ...appendedNodes];
  return { repoMap: merged, appendedNodes };
}

function buildArtifactPayloads({ rootDir, projectName, evidenceCheck, repoInsights, selectedInstructionTargets, ownerAnswers, existingGovernance }) {
  const starterRepoMap = buildStarterRepoMap({
    projectName,
    evidenceCheck,
    repoInsights,
    instructionTargets: selectedInstructionTargets,
  });
  const replaceExistingGovernance = ownerAnswers.replaceExistingGovernance
    ?? ownerAnswers.replace_existing_governance
    ?? false;
  const preserveExistingGovernance = existingGovernance.detected && !replaceExistingGovernance;
  let repoMap = starterRepoMap;
  let appendedNodes = [];
  if (preserveExistingGovernance) {
    const existingRepoMap = JSON.parse(readFileSync(resolve(rootDir, '.veritas/repo-map.json'), 'utf8'));
    ({ repoMap, appendedNodes } = mergeDiscoveredNodes(existingRepoMap, starterRepoMap));
  }
  const repoStandards = preserveExistingGovernance
    ? JSON.parse(readFileSync(resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json'), 'utf8'))
    : buildStarterRepoStandards({ projectName, instructionTargets: selectedInstructionTargets });
  const authoritySettings = preserveExistingGovernance
    ? JSON.parse(readFileSync(resolve(rootDir, '.veritas/authority/default.authority-settings.json'), 'utf8'))
    : buildStarterAuthoritySettings({ projectName, evidenceCheck });
  const recommendationSummary = [
    `- Mode: guided initialization artifact`,
    `- Repo kind: \`${repoInsights.repoKind}\``,
    `- Evidence Check: \`${evidenceCheck}\``,
    `- Selected instruction targets: ${selectedInstructionTargets.map((target) => `\`${target.path}\``).join(', ') || '`none`'}`,
  ].join('\n');
  const governanceBlock = buildGovernanceBlock();
  const generatedReadme = buildBootstrapReadme({
      projectName,
      evidenceCheck,
      repoInsights,
      recommendationSummary,
      ownerAnswers,
    });
  const payloads = {
    '.veritas/README.md': preserveExistingGovernance && existsSync(resolve(rootDir, '.veritas/README.md'))
      ? readFileSync(resolve(rootDir, '.veritas/README.md'), 'utf8')
      : generatedReadme,
    '.veritas/GOVERNANCE.md': preserveExistingGovernance && existsSync(resolve(rootDir, '.veritas/GOVERNANCE.md'))
      ? readFileSync(resolve(rootDir, '.veritas/GOVERNANCE.md'), 'utf8')
      : buildGovernanceInstructions(),
    '.veritas/repo-map.json': jsonPayload(repoMap),
    '.veritas/repo-standards/default.repo-standards.json': jsonPayload(repoStandards),
    '.veritas/authority/default.authority-settings.json': jsonPayload(authoritySettings),
  };

  for (const target of selectedInstructionTargets) {
    const absolutePath = resolve(rootDir, target.path);
    const existingContent = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
    payloads[target.path] = replaceGovernanceBlock(existingContent, governanceBlock);
  }

  return {
    payloads,
    preservation: {
      detected_existing_governance: existingGovernance.detected,
      preserved_existing_governance: preserveExistingGovernance,
      explicit_replacement_requested: replaceExistingGovernance,
      appended_work_area_node_ids: appendedNodes.map((node) => node.id),
    },
  };
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
  const selectedInstructionTargets = selectedInstructionTargetsFromAnswers(rootDir, ownerAnswers);
  validateInstructionTargetPaths(rootDir, selectedInstructionTargets);
  const existingGovernance = existingGovernanceState(rootDir);
  const { payloads: artifactPayloads, preservation } = buildArtifactPayloads({
    rootDir,
    projectName,
    evidenceCheck: resolvedEvidenceCheck,
    repoInsights,
    selectedInstructionTargets,
    ownerAnswers,
    existingGovernance,
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
    external_boundaries: repoInsights.externalBoundaries,
    existing_governance: {
      ...existingGovernance,
      ...preservation,
    },
    recommended_surfaces: recommendedSurfaces(repoInsights),
    recommended_instruction_targets: recommendedInstructionTargets(rootDir, selectedInstructionTargets),
    selected_instruction_targets: selectedInstructionTargets,
    generated_output_ignores: GENERATED_OUTPUT_IGNORE_ENTRIES,
    owner_questions: ownerQuestions(repoInsights, existingGovernance),
    owner_answers: ownerAnswers,
    apply_command: 'npx @kontourai/veritas init --apply --plan <path-to-this-artifact>',
    reasoning_summary: [
      `Detected repo kind \`${repoInsights.repoKind}\`.`,
      `Selected evidenceCheck \`${resolvedEvidenceCheck}\`.`,
      `Selected instruction targets: ${selectedInstructionTargets.map((target) => target.path).join(', ')}.`,
      ...(preservation.preserved_existing_governance
        ? [`Preserved existing authored Repo Standards, authority settings, governance guidance, and repository context; appended ${preservation.appended_work_area_node_ids.length} uncovered work-area node(s).`]
        : []),
      ...(repoInsights.externalBoundaries.length > 0
        ? [`Preserved ${repoInsights.externalBoundaries.length} repository-declared external authority boundary hint(s).`]
        : []),
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
  mkdirSync(veritasArtifactPath(rootDir, 'evidence'), { recursive: true });

  for (const [path, payload] of Object.entries(recommendation.artifact_payloads)) {
    const absolutePath = resolve(rootDir, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, payload, 'utf8');
  }
  const ignoreResult = mergeGeneratedOutputIgnores(rootDir);

  return {
    rootDir,
    projectName: recommendation.project_name,
    evidenceCheck: recommendation.evidenceCheck,
    repoInsights: recommendation.repo_insights,
    codeownersBlock: buildSuggestedCodeownersBlock(),
    generatedFiles: [
      ...Object.keys(recommendation.artifact_payloads),
      `${veritasArtifactRepoPath('evidence')}/`,
      ...(ignoreResult.changed ? [ignoreResult.path] : []),
    ],
    generatedOutputIgnores: ignoreResult.addedEntries,
  };
}
