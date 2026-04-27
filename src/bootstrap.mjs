import { basename, dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadJson } from './load.mjs';
import { buildGovernanceBlock, replaceGovernanceBlock } from './governance.mjs';

const DEFAULT_SELECTED_INSTRUCTION_TARGETS = [
  { path: 'AGENTS.md', tool: 'codex', required: true },
  { path: 'CLAUDE.md', tool: 'claude-code', required: true },
];

const OPTIONAL_INSTRUCTION_TARGETS = [
  { path: '.cursorrules', tool: 'cursor', required: false },
  {
    path: '.github/copilot-instructions.md',
    tool: 'github-copilot',
    required: false,
  },
];

const INIT_RECOMMENDATION_SCHEMA_VERSION = 1;

export function slugifyProjectName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return loadJson(path);
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonPayload(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeInstructionTargets(targets) {
  if (!Array.isArray(targets)) return [...DEFAULT_SELECTED_INSTRUCTION_TARGETS];
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

function toolForInstructionPath(path) {
  if (path === 'AGENTS.md') return 'codex';
  if (path === 'CLAUDE.md') return 'claude-code';
  if (path === '.cursorrules') return 'cursor';
  if (path === '.github/copilot-instructions.md') return 'github-copilot';
  return 'agent';
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

function detectSourceRoots(rootDir) {
  return ['src/', 'app/', 'packages/', 'apps/', 'docs/', 'content/'].filter((path) =>
    existsSync(resolve(rootDir, path)),
  );
}

function detectToolingRoots(rootDir) {
  return ['scripts/', 'vendor/'].filter((path) => existsSync(resolve(rootDir, path)));
}

function detectTestRoots(rootDir) {
  return ['tests/', 'test/', 'spec/'].filter((path) =>
    existsSync(resolve(rootDir, path)),
  );
}

function inferBaseRef(rootDir) {
  for (const candidate of ['origin/main', 'origin/master', 'origin/trunk']) {
    const remoteRef = candidate.replace('origin/', '');
    if (existsSync(resolve(rootDir, `.git/refs/remotes/origin/${remoteRef}`))) {
      return candidate;
    }
  }

  for (const candidate of ['main', 'master', 'trunk']) {
    if (existsSync(resolve(rootDir, `.git/refs/heads/${candidate}`))) {
      return candidate;
    }
  }

  if (existsSync(resolve(rootDir, '.git'))) {
    try {
      const headBranch = execFileSync(
        'git',
        ['symbolic-ref', '--quiet', '--short', 'HEAD'],
        {
          cwd: rootDir,
          encoding: 'utf8',
          windowsHide: true,
        },
      ).trim();
      if (headBranch) {
        return headBranch;
      }
    } catch (error) {
      if (error?.status !== 1 && error?.status !== 128) {
        throw error;
      }
    }
  }

  return '<base-ref>';
}

export function inferBootstrapRepoInsights(rootDir) {
  const packageJson = readJsonIfExists(resolve(rootDir, 'package.json'));
  const scripts = packageJson?.scripts ?? {};
  const sourceRoots = detectSourceRoots(rootDir);
  const toolingRoots = detectToolingRoots(rootDir);
  const testRoots = detectTestRoots(rootDir);
  const hasWorkflows = existsSync(resolve(rootDir, '.github/workflows'));
  const hasWorkspaceConfig =
    existsSync(resolve(rootDir, 'pnpm-workspace.yaml')) ||
    existsSync(resolve(rootDir, 'turbo.json')) ||
    existsSync(resolve(rootDir, 'nx.json')) ||
    (existsSync(resolve(rootDir, 'package.json')) && Array.isArray(packageJson?.workspaces));

  let repoKind = 'application';
  if (hasWorkspaceConfig || sourceRoots.includes('packages/') || sourceRoots.includes('apps/')) {
    repoKind = 'workspace';
  } else if (
    (sourceRoots.includes('docs/') || sourceRoots.includes('content/')) &&
    !sourceRoots.includes('src/') &&
    !sourceRoots.includes('app/')
  ) {
    repoKind = 'docs';
  }

  const scriptPriority =
    repoKind === 'docs'
      ? ['docs:build', 'build', 'test', 'verify']
      : ['ci:fast', 'verify', 'test:smoke', 'test', 'build'];
  const matchingScript = scriptPriority.find((name) => typeof scripts[name] === 'string');
  const proofLane = matchingScript ? `npm run ${matchingScript}` : 'npm test';

  return {
    repoKind,
    sourceRoots,
    toolingRoots,
    testRoots,
    hasWorkflows,
    proofLane,
    enableSurfaceProofRouting: repoKind === 'workspace' || toolingRoots.length > 0,
    baseRef: inferBaseRef(rootDir),
    packageManager: packageJson ? 'npm' : 'unknown',
    matchedScripts: scriptPriority.filter((name) => typeof scripts[name] === 'string'),
    legacyVerification: detectLegacyVerification(rootDir, scripts),
  };
}

function detectLegacyVerification(rootDir, scripts = {}) {
  const scriptEntries = Object.entries(scripts)
    .filter(([name, command]) => {
      if (typeof command !== 'string') return false;
      return (
        /convergence|guidance|guardrail|ai-guidance|verify:/.test(name) ||
        /convergence|guidance|guardrail|ai-guidance|\.ai-guidance/.test(command)
      );
    })
    .map(([name, command]) => ({
      kind: 'package-script',
      id: name,
      command,
      recommendedDisposition: name.includes('verify') ? 'candidate' : 'advisory',
      reason: 'Legacy or custom verification-shaped package script detected during brownfield init.',
    }));

  const fileEntries = [
    '.ai-guidance',
    'vendor/ai-guidance-framework',
    'scripts/verify-convergence.mjs',
    'scripts/guidance-report.mjs',
  ]
    .filter((path) => existsSync(resolve(rootDir, path)))
    .map((path) => ({
      kind: 'legacy-path',
      id: path,
      path,
      recommendedDisposition: path === '.ai-guidance' ? 'candidate' : 'advisory',
      reason: 'Legacy guidance or convergence path detected; inventory before copying into Veritas.',
    }));

  return {
    detected: scriptEntries.length + fileEntries.length > 0,
    items: [...scriptEntries, ...fileEntries],
    recommendedProofFamilyDefaults: {
      unknownCatchEvidenceDefault: 'candidate',
      requiredNeedsOwner: true,
      requiredNeedsReviewTrigger: true,
      productBehaviorNeedsReplacementTest: true,
    },
  };
}

function buildAdaptiveNodes(repoInsights) {
  const nodes = [
    {
      id: 'governance.guidance',
      kind: 'governance-surface',
      label: '.veritas/**',
      patterns: ['.veritas/'],
      'governance-locked': true,
    },
    {
      id: 'governance.root-manifests',
      kind: 'governance-surface',
      label: 'root manifests',
      patterns: ['package.json', 'package-lock.json', 'README.md', '.gitignore', 'AGENTS.md'],
    },
  ];

  if (repoInsights.hasWorkflows) {
    nodes.push({
      id: 'delivery.workflows',
      kind: 'delivery-surface',
      label: '.github/**',
      patterns: ['.github/'],
    });
  }

  for (const root of repoInsights.toolingRoots ?? []) {
    nodes.push({
      id: `tooling.${root.replace(/\/$/, '').replace(/[^a-z0-9]+/g, '.')}`,
      kind: 'tooling-surface',
      label: `${root}**`,
      patterns: [root],
    });
  }

  const sourceRoots = repoInsights.sourceRoots.length > 0 ? repoInsights.sourceRoots : ['src/'];
  const testRoots = repoInsights.testRoots.length > 0 ? repoInsights.testRoots : ['tests/'];

  for (const root of sourceRoots) {
    const label = `${root}**`;
    const idBase = root.replace(/\/$/, '').replace(/[^a-z0-9]+/g, '.');

    if (root === 'packages/' || root === 'apps/') {
      nodes.push({
        id: `workspace.${idBase}`,
        kind: 'shared-package',
        label,
        patterns: [root],
      });
      continue;
    }

    if (root === 'docs/' || root === 'content/') {
      nodes.push({
        id: `docs.${idBase}`,
        kind: 'product-surface',
        label,
        patterns: [root],
      });
      continue;
    }

    nodes.push({
      id: `app.${idBase}`,
      kind: 'product-surface',
      label,
      patterns: [root],
    });
  }

  for (const root of testRoots) {
    nodes.push({
      id: `verification.${root.replace(/\/$/, '').replace(/[^a-z0-9]+/g, '.')}`,
      kind: 'verification-surface',
      label: `${root}**`,
      patterns: [root],
    });
  }

  return nodes;
}

function buildStarterEvidenceConfig({ proofLane, repoInsights }) {
  const evidence = {
    artifactDir: '.veritas/evidence',
    proofLanes: [
      {
        id: 'required-proof',
        command: proofLane,
        method: 'validation',
        summary: 'Default repository proof lane.',
      },
    ],
    requiredProofLaneIds: ['required-proof'],
    reportTransport: 'local-json',
  };

  if (repoInsights.enableSurfaceProofRouting) {
    evidence.defaultProofLaneIds = ['required-proof'];
    evidence.uncoveredPathPolicy = 'warn';
  }

  return evidence;
}

export function buildStarterAdapter({
  projectName,
  proofLane = 'npm test',
  instructionTargets = [
    ...DEFAULT_SELECTED_INSTRUCTION_TARGETS,
    ...OPTIONAL_INSTRUCTION_TARGETS,
  ],
  repoInsights = {
    repoKind: 'application',
    sourceRoots: [],
    toolingRoots: [],
    testRoots: [],
    hasWorkflows: true,
  },
}) {
  const projectSlug = slugifyProjectName(projectName);

  return {
    name: projectSlug,
    kind: 'repo-adapter',
    policy: {
      defaultFalsePositiveReview: 'unknown',
      defaultPromotionCandidate: false,
      defaultOverrideOrBypass: false,
    },
    graph: {
      version: 1,
      defaultResolution: {
        phase: 'Phase 0 (Bootstrap)',
        workstream: 'Initial Project Setup',
        matchedArtifacts: ['README.md'],
      },
      nonSliceableInvariants: [
        'baseline proof lane',
        'repo-local guidance',
        'tracked policy artifacts',
      ],
      resolverPrecedence: [
        'explicit task or issue reference',
        'matching local artifact under .veritas/**',
        'active repo roadmap or README guidance',
        'multi-workstream fallback suppresses promotion',
      ],
      resolutionRules: [
        {
          id: 'veritas-files',
          match: {
            patterns: ['.veritas/'],
          },
          resolution: {
            phase: 'Phase 0 (Bootstrap)',
            workstream: 'Initial Project Setup',
            matchedArtifacts: ['.veritas/**'],
          },
        },
      ],
      nodes: buildAdaptiveNodes(repoInsights),
    },
    evidence: buildStarterEvidenceConfig({ proofLane, repoInsights }),
    activation: {
      aiInstructionFiles: normalizeInstructionTargets(instructionTargets),
    },
  };
}

export function buildStarterPolicyPack({ projectName, instructionTargets = DEFAULT_SELECTED_INSTRUCTION_TARGETS }) {
  const projectSlug = slugifyProjectName(projectName);
  const governanceBlockTargets = normalizeInstructionTargets(instructionTargets).map((target) => target.path);

  return {
    version: 1,
    name: `${projectSlug}-default`,
    description:
      'Conservative starter policy pack for a newly bootstrapped Veritas-enabled repository.',
    rules: [
      {
        id: 'required-veritas-artifacts',
        classification: 'hard-invariant',
        stage: 'block',
        message:
          'The bootstrap Veritas artifacts must stay present so agents and reviewers share the same baseline.',
        owner: 'repo-core',
        rollback_switch: null,
        match: {
          artifacts: [
            '.veritas/README.md',
            '.veritas/GOVERNANCE.md',
            '.veritas/repo.adapter.json',
            '.veritas/policy-packs/default.policy-pack.json',
            '.veritas/team/default.team-profile.json',
          ],
        },
      },
      {
        id: 'ai-instruction-files-synced',
        classification: 'hard-invariant',
        stage: 'warn',
        message:
          'All required AI tool instruction files must contain the Veritas governance block.',
        owner: 'repo-maintainers',
        rollback_switch: null,
        match: {
          'governance-block': governanceBlockTargets,
        },
      },
      {
        id: 'prefer-veritas-routed-delivery',
        classification: 'promotable-policy',
        stage: 'recommend',
        message:
          'Prefer running new AI-guided changes through the Veritas report and the documented proof lane before review.',
        owner: 'repo-maintainers',
        rollback_switch: 'soften-veritas-route',
        match: {
          files: ['.veritas/README.md'],
        },
      },
    ],
  };
}

export function buildStarterTeamProfile({ projectName, proofLane = 'npm test' }) {
  const projectSlug = slugifyProjectName(projectName);

  return {
    version: 1,
    id: `${projectSlug}-default`,
    name: `${projectName} Default`,
    description:
      'Conservative starter profile: begin in shadow mode, learn first, and only harden rules after repeated evidence.',
    defaults: {
      mode: 'shadow',
      new_rule_stage: 'recommend',
    },
    review_preferences: {
      human_signoff_required_for_stage_promotion: true,
      reviewer_confidence_scale: ['low', 'medium', 'high'],
      major_rewrite_definition:
        'A major rewrite replaces the main structure or control flow instead of making local edits.',
    },
    promotion_preferences: {
      proof_lanes_required_before_block: [proofLane],
      warnings_block_in_ci: false,
      require_consistent_eval_before_promotion: true,
    },
  };
}

export function buildBootstrapReadme({
  projectName,
  proofLane = 'npm test',
  recommendationSummary = null,
  ownerAnswers = null,
  repoInsights = {
    repoKind: 'application',
    sourceRoots: [],
    toolingRoots: [],
    testRoots: [],
    hasWorkflows: false,
    matchedScripts: [],
  },
}) {
  return `# Veritas Starter Kit

This repo was bootstrapped for \`${projectName}\` with a conservative starter kit for agent-guided development.

## Generated Files

- \`.veritas/README.md\`
- \`.veritas/GOVERNANCE.md\`
- \`.veritas/repo.adapter.json\`
- \`.veritas/policy-packs/default.policy-pack.json\`
- \`.veritas/team/default.team-profile.json\`

## Inferred Repo Shape

- Repo kind: \`${repoInsights.repoKind}\`
- Source roots: ${
    repoInsights.sourceRoots.length > 0
      ? `\`${repoInsights.sourceRoots.join('`, `')}\``
      : '`src/` (default)'
  }
- Tooling roots: ${
    (repoInsights.toolingRoots ?? []).length > 0
      ? `\`${repoInsights.toolingRoots.join('`, `')}\``
      : '`none`'
  }
- Test roots: ${
    repoInsights.testRoots.length > 0
      ? `\`${repoInsights.testRoots.join('`, `')}\``
      : '`tests/` (default)'
  }
- GitHub workflows detected: \`${repoInsights.hasWorkflows ? 'yes' : 'no'}\`
- Matching scripts seen: ${
    repoInsights.matchedScripts.length > 0
      ? `\`${repoInsights.matchedScripts.join('`, `')}\``
      : '`none`'
  }

## What To Do Next

1. Confirm the inferred source/test roots match the real repo layout.
2. Replace the suggested proof lane if a stronger project health command exists.
3. Keep the team profile in \`shadow\` mode until you have enough evidence to tighten rules.

${
  recommendationSummary
    ? `## Initialization Recommendation\n\n${recommendationSummary}\n\n`
    : ''
}${
  ownerAnswers && Object.keys(ownerAnswers).length > 0
    ? `## Owner Answers\n\n\`\`\`json\n${JSON.stringify(ownerAnswers, null, 2)}\n\`\`\`\n\n`
    : ''
}

## Suggested Commands

\`\`\`bash
npx @kontourai/veritas print package-scripts
npx @kontourai/veritas print ci-snippet
npx @kontourai/veritas apply package-scripts
npx @kontourai/veritas apply ci-snippet
npx @kontourai/veritas runtime status
npx @kontourai/veritas report package.json
\`\`\`

If you prefer explicit paths:

\`\`\`bash
npx @kontourai/veritas report \\
  --adapter ./.veritas/repo.adapter.json \\
  --policy-pack ./.veritas/policy-packs/default.policy-pack.json \\
  package.json
\`\`\`

## Suggested Proof Lane

\`${proofLane}\`

## Surface-Aware Routing

${
  repoInsights.enableSurfaceProofRouting
    ? 'This repo shape justifies surface-aware proof routing, so the starter adapter also includes `defaultProofLaneIds` and `uncoveredPathPolicy` alongside explicit proof-lane objects.'
    : 'This starter stays on the minimal single-proof-lane path by default. Surface-aware proof routing can be added later if the repo grows multiple independently verified surfaces.'
}

## Why This Exists

The goal is to give any compatible agent just-in-time repo guidance from day one, while keeping review and CI grounded in the same starter rules.
`;
}

export function buildGovernanceInstructions() {
  return `# Governance Surface

Zone 1 is human-owned. Do not modify:
- \`.veritas/repo.adapter.json\`
- \`.veritas/policy-packs/\`
- \`.veritas/team/\`

Zone 2 is additive policy growth. Agents may:
- add new surface nodes for new feature directories
- add advisory-tier rules for new surfaces

Do not weaken or delete existing governance.

Zone 3 is generated output:
- \`.veritas/evidence/\`
- \`.veritas/eval-drafts/\`
- \`.veritas/evals/\`
- \`.veritas/checkins/\`
`;
}

export function buildSuggestedCodeownersBlock() {
  return `# Veritas constitutional core - changes require human governance approval
.veritas/repo.adapter.json  @your-team/governance
.veritas/policy-packs/      @your-team/governance
.veritas/team/              @your-team/governance`;
}

export function writeBootstrapStarterKit({
  rootDir,
  projectName = basename(resolve(rootDir)),
  proofLane,
  instructionTargets,
  force = false,
}) {
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedProofLane = proofLane ?? repoInsights.proofLane;
  const selectedInstructionTargets = normalizeInstructionTargets(instructionTargets ?? DEFAULT_SELECTED_INSTRUCTION_TARGETS);
  const adapterPath = resolve(rootDir, '.veritas/repo.adapter.json');
  const policyPackPath = resolve(rootDir, '.veritas/policy-packs/default.policy-pack.json');
  const teamProfilePath = resolve(rootDir, '.veritas/team/default.team-profile.json');
  const readmePath = resolve(rootDir, '.veritas/README.md');
  const governancePath = resolve(rootDir, '.veritas/GOVERNANCE.md');
  const requiredInstructionFiles = selectedInstructionTargets.map((target) => resolve(rootDir, target.path));

  const files = [
    [adapterPath, buildStarterAdapter({ projectName, proofLane: resolvedProofLane, repoInsights, instructionTargets: selectedInstructionTargets })],
    [policyPackPath, buildStarterPolicyPack({ projectName, instructionTargets: selectedInstructionTargets })],
    [teamProfilePath, buildStarterTeamProfile({ projectName, proofLane: resolvedProofLane })],
  ];

  for (const [filePath] of files) {
    if (existsSync(filePath) && !force) {
      throw new Error(
        `Refusing to overwrite existing file: ${relative(rootDir, filePath)} (use --force to replace it)`,
      );
    }
  }
  if (existsSync(readmePath) && !force) {
    throw new Error(
      'Refusing to overwrite existing file: .veritas/README.md (use --force to replace it)',
    );
  }
  if (existsSync(governancePath) && !force) {
    throw new Error(
      'Refusing to overwrite existing file: .veritas/GOVERNANCE.md (use --force to replace it)',
    );
  }

  mkdirSync(resolve(rootDir, '.veritas/policy-packs'), { recursive: true });
  mkdirSync(resolve(rootDir, '.veritas/team'), { recursive: true });
  mkdirSync(resolve(rootDir, '.veritas/evidence'), { recursive: true });

  for (const [filePath, payload] of files) {
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  writeFileSync(
    readmePath,
    buildBootstrapReadme({ projectName, proofLane: resolvedProofLane, repoInsights }),
    'utf8',
  );
  writeFileSync(governancePath, buildGovernanceInstructions(), 'utf8');
  const governanceBlock = buildGovernanceBlock();
  for (const instructionPath of requiredInstructionFiles) {
    const existingContent = existsSync(instructionPath)
      ? readFileSync(instructionPath, 'utf8')
      : '';
    writeFileSync(
      instructionPath,
      replaceGovernanceBlock(existingContent, governanceBlock),
      'utf8',
    );
  }

  return {
    rootDir,
    projectName,
    proofLane: resolvedProofLane,
    repoInsights,
    codeownersBlock: buildSuggestedCodeownersBlock(),
    generatedFiles: [
      relative(rootDir, readmePath).replaceAll('\\', '/'),
      relative(rootDir, governancePath).replaceAll('\\', '/'),
      relative(rootDir, adapterPath).replaceAll('\\', '/'),
      relative(rootDir, policyPackPath).replaceAll('\\', '/'),
      relative(rootDir, teamProfilePath).replaceAll('\\', '/'),
      ...requiredInstructionFiles.map((filePath) =>
        relative(rootDir, filePath).replaceAll('\\', '/'),
      ),
    ],
  };
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

export function buildSuggestedPackageScripts({
  proofLane = 'npm test',
  baseRef = '<base-ref>',
}) {
  return {
    'veritas:init': 'npm exec -- veritas init',
    'veritas:print:scripts': 'npm exec -- veritas print package-scripts',
    'veritas:print:ci': 'npm exec -- veritas print ci-snippet',
    'veritas:report': 'npm exec -- veritas report --run-id local-smoke package.json',
    'veritas:report:working-tree': 'npm exec -- veritas report --working-tree',
    'veritas:report:diff': `npm exec -- veritas report --changed-from ${baseRef} --changed-to HEAD`,
    'veritas:status:runtime': 'npm exec -- veritas runtime status',
    'veritas:proof': proofLane,
    'lint:governance': 'npm exec -- veritas shadow run --format feedback --working-tree',
    'veritas:eval': 'npm exec -- veritas shadow run',
  };
}

export function buildSuggestedCiSnippet({
  proofLane = 'npm test',
  baseRef = '<base-ref>',
}) {
  return `# Suggested Veritas CI snippet
- name: Run project proof lane
  run: ${proofLane}

- name: Generate Veritas report
  run: npm exec -- veritas report --changed-from ${baseRef} --changed-to HEAD
`;
}
