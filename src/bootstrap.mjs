import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadJson } from './load.mjs';
import { buildGovernanceBlock, replaceGovernanceBlock } from './governance.mjs';
import { buildBaselineClaims } from './claims/templates.mjs';
import {
  DEFAULT_SELECTED_INSTRUCTION_TARGETS,
  OPTIONAL_INSTRUCTION_TARGETS,
  buildGovernanceInstructions,
  buildSuggestedCiSnippet,
  buildSuggestedCodeownersBlock,
  buildSuggestedPackageScripts,
  normalizeInstructionTargets,
} from './bootstrap/guidance.mjs';

export {
  buildGovernanceInstructions,
  buildSuggestedCiSnippet,
  buildSuggestedCodeownersBlock,
  buildSuggestedPackageScripts,
};

const INIT_RECOMMENDATION_SCHEMA_VERSION = 1;

const STARTER_REPO_STANDARD_TEMPLATES = new Map([
  ['nextjs-typescript', 'nextjs-typescript.repo-standards.json'],
  ['python-fastapi', 'python-fastapi.repo-standards.json'],
  ['monorepo-pnpm', 'monorepo-pnpm.repo-standards.json'],
]);

const FRAMEWORK_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  const evidenceCheck = matchingScript ? `npm run ${matchingScript}` : 'npm test';

  return {
    repoKind,
    sourceRoots,
    toolingRoots,
    testRoots,
    hasWorkflows,
    evidenceCheck,
    enableWorkAreaEvidenceRouting: repoKind === 'workspace' || toolingRoots.length > 0,
    baseRef: inferBaseRef(rootDir),
    packageManager: packageJson ? 'npm' : 'unknown',
    matchedScripts: scriptPriority.filter((name) => typeof scripts[name] === 'string'),
    existingVerification: detectExistingVerification(rootDir, scripts),
  };
}

function detectExistingVerification(rootDir, scripts = {}) {
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
      reason: 'Existing custom verification-shaped package script detected during brownfield init.',
    }));

  const fileEntries = [
    '.ai-guidance',
    'vendor/ai-guidance-framework',
    'scripts/verify-convergence.mjs',
    'scripts/guidance-report.mjs',
  ]
    .filter((path) => existsSync(resolve(rootDir, path)))
    .map((path) => ({
      kind: 'existing-path',
      id: path,
      path,
      recommendedDisposition: path === '.ai-guidance' ? 'candidate' : 'advisory',
      reason: 'Existing guidance or convergence path detected; inventory before copying into Veritas.',
    }));

  return {
    detected: scriptEntries.length + fileEntries.length > 0,
    items: [...scriptEntries, ...fileEntries],
    recommendedEvidenceInventoryDefaults: {
      unknownCatchEvidenceDefault: 'candidate',
      requiredNeedsOwner: true,
      requiredNeedsReviewTrigger: true,
      productBehaviorNeedsReplacementTest: true,
    },
  };
}

export function buildAdaptiveNodes(repoInsights) {
  const nodes = [
    {
      id: 'governance.guidance',
      kind: 'protected-area',
      label: '.veritas/**',
      patterns: ['.veritas/'],
      'governance-locked': true,
    },
    {
      id: 'governance.root-manifests',
      kind: 'protected-area',
      label: 'root manifests',
      patterns: ['package.json', 'package-lock.json', 'README.md', '.gitignore', 'AGENTS.md'],
    },
  ];

  if (repoInsights.hasWorkflows) {
    nodes.push({
      id: 'delivery.workflows',
      kind: 'delivery-area',
      label: '.github/**',
      patterns: ['.github/'],
    });
  }

  for (const root of repoInsights.toolingRoots ?? []) {
    nodes.push({
      id: `tooling.${root.replace(/\/$/, '').replace(/[^a-z0-9]+/g, '.')}`,
      kind: 'tooling-area',
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
        kind: 'product-area',
        label,
        patterns: [root],
      });
      continue;
    }

    nodes.push({
      id: `app.${idBase}`,
      kind: 'product-area',
      label,
      patterns: [root],
    });
  }

  for (const root of testRoots) {
    nodes.push({
      id: `verification.${root.replace(/\/$/, '').replace(/[^a-z0-9]+/g, '.')}`,
      kind: 'verification-area',
      label: `${root}**`,
      patterns: [root],
    });
  }

  return nodes;
}

function buildStarterEvidenceConfig({ evidenceCheck, repoInsights }) {
  const evidence = {
    artifactDir: '.veritas/evidence',
    evidenceChecks: [
      {
        id: 'required-evidence-check',
        command: evidenceCheck,
        method: 'validation',
        summary: 'Default repository evidenceCheck.',
      },
    ],
    requiredEvidenceCheckIds: ['required-evidence-check'],
    reportTransport: 'local-json',
  };

  if (repoInsights.enableWorkAreaEvidenceRouting) {
    evidence.defaultEvidenceCheckIds = ['required-evidence-check'];
    evidence.uncoveredPathPolicy = 'warn';
  }

  return evidence;
}

export function buildStarterRepoMap({
  projectName,
  evidenceCheck = 'npm test',
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
    kind: 'repo-map',
    policy: {
      defaultFalsePositiveReview: 'unknown',
      defaultPromotionCandidate: false,
      defaultExceptionAllowed: false,
    },
    graph: {
      version: 1,
      defaultResolution: {
        phase: 'Phase 0 (Bootstrap)',
        workstream: 'Initial Project Setup',
        matchedArtifacts: ['README.md'],
      },
      nonSliceableInvariants: [
        'baseline evidenceCheck',
        'repo-local guidance',
        'tracked standards artifacts',
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
    evidence: buildStarterEvidenceConfig({ evidenceCheck, repoInsights }),
    activation: {
      aiInstructionFiles: normalizeInstructionTargets(instructionTargets),
    },
  };
}

export function buildStarterRepoStandards({ projectName, instructionTargets = DEFAULT_SELECTED_INSTRUCTION_TARGETS }) {
  const projectSlug = slugifyProjectName(projectName);
  const governanceBlockTargets = normalizeInstructionTargets(instructionTargets).map((target) => target.path);

  return {
    version: 1,
    name: `${projectSlug}-default`,
    description:
      'Conservative starter Repo Standards for a newly bootstrapped Veritas-enabled repository.',
    rules: [
      {
        id: 'required-veritas-artifacts',
        kind: 'required-artifacts',
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
            '.veritas/repo-map.json',
            '.veritas/repo-standards/default.repo-standards.json',
            '.veritas/authority/default.authority-settings.json',
          ],
        },
      },
      {
        id: 'ai-instruction-files-synced',
        kind: 'governance-block',
        classification: 'hard-invariant',
        stage: 'warn',
        message:
          'All required AI tool instruction files must contain the Veritas guidance block.',
        owner: 'repo-maintainers',
        rollback_switch: null,
        match: {
          'governance-block': governanceBlockTargets,
        },
      },
      {
        id: 'prefer-veritas-routed-delivery',
        kind: 'required-artifacts',
        classification: 'promotable-policy',
        stage: 'recommend',
        message:
          'Prefer running new AI-guided changes through Veritas readiness checks and the documented evidenceCheck before review.',
        owner: 'repo-maintainers',
        rollback_switch: 'soften-veritas-route',
        match: {
          artifacts: ['.veritas/README.md'],
        },
      },
    ],
  };
}

export function listStarterRepoStandards() {
  return [...STARTER_REPO_STANDARD_TEMPLATES.keys()];
}

export function loadStarterRepoStandards(template) {
  if (!template) return null;
  const fileName = STARTER_REPO_STANDARD_TEMPLATES.get(template);
  if (!fileName) {
    throw new Error(`Unknown Veritas Repo Standards template: ${template}. Available templates: ${listStarterRepoStandards().join(', ')}`);
  }
  const templatePath = resolve(FRAMEWORK_ROOT_DIR, 'examples/repo-standards', fileName);
  return loadJson(templatePath, `Repo Standards template ${template}`);
}

export function buildStarterAuthoritySettings({ projectName, evidenceCheck = 'npm test' }) {
  const projectSlug = slugifyProjectName(projectName);

  return {
    version: 1,
    id: `${projectSlug}-default`,
    name: `${projectName} Default`,
    description:
      'Conservative starter settings: observe first, learn from evidence, and only require what has earned trust.',
    defaults: {
      mode: 'observe',
      new_rule_stage: 'recommend',
    },
    review_preferences: {
      human_signoff_required_for_stage_promotion: true,
      reviewer_confidence_scale: ['low', 'medium', 'high'],
      major_rewrite_definition:
        'A major rewrite replaces the main structure or requirement flow instead of making local edits.',
      attestation_approval_ref_policy: {
        mode: 'reference-only',
        allowed_prefixes: [],
      },
    },
    promotion_preferences: {
      evidence_checks_required_before_require: [evidenceCheck],
      warnings_block_in_ci: false,
      require_consistent_feedback_before_promotion: true,
    },
  };
}

export function buildBootstrapReadme({
  projectName,
  evidenceCheck = 'npm test',
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
- \`.veritas/repo-map.json\`
- \`.veritas/repo-standards/default.repo-standards.json\`
- \`.veritas/authority/default.authority-settings.json\`

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
2. Replace the suggested evidenceCheck if a stronger project health command exists.
3. Keep uncertain requirements in Observe or Guide until evidence shows they should be required.

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
npx @kontourai/veritas readiness --working-tree
npx @kontourai/veritas readiness --check coverage --working-tree
npx @kontourai/veritas integrations codex status
npx @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
\`\`\`

If you prefer explicit paths:

\`\`\`bash
npx @kontourai/veritas readiness --check evidence \\
  --repo-map ./.veritas/repo-map.json \\
  --repo-standards ./.veritas/repo-standards/default.repo-standards.json \\
  package.json
\`\`\`

## Suggested Evidence Check

\`${evidenceCheck}\`

## Work-Area Evidence Routing

${
  repoInsights.enableWorkAreaEvidenceRouting
    ? 'This repo shape justifies work-area evidence routing, so the starter Repo Map also includes `defaultEvidenceCheckIds` and `uncoveredPathPolicy` alongside explicit evidence-check objects.'
    : 'This starter stays on the minimal single-check path by default. Work-area evidence routing can be added later if the repo grows multiple independently verified work areas.'
}

## Why This Exists

The goal is to give developers and agents just-in-time repo guidance from day one, while keeping review and CI grounded in the same starter standards.
`;
}

export function buildBootstrapStarterKitPlan({
  rootDir,
  projectName = basename(resolve(rootDir)),
  evidenceCheck,
  instructionTargets,
  template,
}) {
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedEvidenceCheck = evidenceCheck ?? repoInsights.evidenceCheck;
  const selectedInstructionTargets = normalizeInstructionTargets(instructionTargets ?? DEFAULT_SELECTED_INSTRUCTION_TARGETS);
  const repoMapPath = resolve(rootDir, '.veritas/repo-map.json');
  const repoStandardsPath = resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const authoritySettingsPath = resolve(rootDir, '.veritas/authority/default.authority-settings.json');
  const readmePath = resolve(rootDir, '.veritas/README.md');
  const governancePath = resolve(rootDir, '.veritas/GOVERNANCE.md');
  const claimStorePath = resolve(rootDir, 'veritas.claims.json');
  const requiredInstructionFiles = selectedInstructionTargets.map((target) => resolve(rootDir, target.path));
  const starterRepoMap = buildStarterRepoMap({ projectName, evidenceCheck: resolvedEvidenceCheck, repoInsights, instructionTargets: selectedInstructionTargets });
  const governanceBlock = buildGovernanceBlock();
  const files = [
    [repoMapPath, starterRepoMap],
    [repoStandardsPath, loadStarterRepoStandards(template) ?? buildStarterRepoStandards({ projectName, instructionTargets: selectedInstructionTargets })],
    [authoritySettingsPath, buildStarterAuthoritySettings({ projectName, evidenceCheck: resolvedEvidenceCheck })],
    [claimStorePath, {
      schemaVersion: 1,
      producer: 'veritas',
      ...buildBaselineClaims(projectName, {
        hasGovernance: true,
        evidenceCheckCommands: [resolvedEvidenceCheck],
        workAreas: starterRepoMap.graph?.nodes ?? [],
      }),
    }],
  ];
  const textFiles = [
    [readmePath, buildBootstrapReadme({ projectName, evidenceCheck: resolvedEvidenceCheck, repoInsights })],
    [governancePath, buildGovernanceInstructions()],
    ...requiredInstructionFiles.map((instructionPath) => {
      const existingContent = existsSync(instructionPath)
        ? readFileSync(instructionPath, 'utf8')
        : '';
      return [instructionPath, replaceGovernanceBlock(existingContent, governanceBlock)];
    }),
  ];

  return {
    rootDir,
    projectName,
    template: template ?? null,
    evidenceCheck: resolvedEvidenceCheck,
    repoInsights,
    selectedInstructionTargets,
    files,
    textFiles,
    instructionFiles: requiredInstructionFiles,
    directories: [
      resolve(rootDir, '.veritas/repo-standards'),
      resolve(rootDir, '.veritas/authority'),
      resolve(rootDir, '.veritas/evidence'),
    ],
    codeownersBlock: buildSuggestedCodeownersBlock(),
    generatedFiles: [
      relative(rootDir, readmePath).replaceAll('\\', '/'),
      relative(rootDir, governancePath).replaceAll('\\', '/'),
      relative(rootDir, repoMapPath).replaceAll('\\', '/'),
      relative(rootDir, repoStandardsPath).replaceAll('\\', '/'),
      relative(rootDir, authoritySettingsPath).replaceAll('\\', '/'),
      relative(rootDir, claimStorePath).replaceAll('\\', '/'),
      ...requiredInstructionFiles.map((filePath) =>
        relative(rootDir, filePath).replaceAll('\\', '/'),
      ),
    ],
  };
}

export function writeBootstrapStarterKit({
  rootDir,
  projectName = basename(resolve(rootDir)),
  evidenceCheck,
  instructionTargets,
  template,
  force = false,
}) {
  const plan = buildBootstrapStarterKitPlan({
    rootDir,
    projectName,
    evidenceCheck,
    instructionTargets,
    template,
  });

  for (const [filePath] of plan.files) {
    if (existsSync(filePath) && !force) {
      throw new Error(
        `Refusing to overwrite existing file: ${relative(rootDir, filePath)} (use --force to replace it)`,
      );
    }
  }
  const instructionFileSet = new Set(plan.instructionFiles.map((filePath) => resolve(filePath)));
  for (const [filePath] of plan.textFiles) {
    if (instructionFileSet.has(resolve(filePath))) continue;
    if (existsSync(filePath) && !force) {
      throw new Error(
        `Refusing to overwrite existing file: ${relative(rootDir, filePath).replaceAll('\\', '/')} (use --force to replace it)`,
      );
    }
  }

  for (const directory of plan.directories) mkdirSync(directory, { recursive: true });

  for (const [filePath, payload] of plan.files) {
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  for (const [filePath, payload] of plan.textFiles) {
    writeFileSync(filePath, payload, 'utf8');
  }

  return {
    rootDir: plan.rootDir,
    projectName: plan.projectName,
    template: plan.template,
    evidenceCheck: plan.evidenceCheck,
    repoInsights: plan.repoInsights,
    codeownersBlock: plan.codeownersBlock,
    generatedFiles: plan.generatedFiles,
  };
}
