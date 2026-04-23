import { basename, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { loadJson } from './load.mjs';

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
    requiredProofLanes: [proofLane],
    reportTransport: 'local-json',
  };

  if (repoInsights.enableSurfaceProofRouting) {
    evidence.defaultProofLanes = [proofLane];
    evidence.uncoveredPathPolicy = 'warn';
  }

  return evidence;
}

export function buildStarterAdapter({
  projectName,
  proofLane = 'npm test',
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
  };
}

export function buildStarterPolicyPack({ projectName }) {
  const projectSlug = slugifyProjectName(projectName);

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

## Suggested Commands

\`\`\`bash
npm exec -- veritas print package-scripts
npm exec -- veritas print ci-snippet
npm exec -- veritas apply package-scripts
npm exec -- veritas apply ci-snippet
npm exec -- veritas runtime status
npm exec -- veritas report package.json
\`\`\`

If you prefer explicit paths:

\`\`\`bash
npm exec -- veritas report \\
  --adapter ./.veritas/repo.adapter.json \\
  --policy-pack ./.veritas/policy-packs/default.policy-pack.json \\
  package.json
\`\`\`

## Suggested Proof Lane

\`${proofLane}\`

## Surface-Aware Routing

${
  repoInsights.enableSurfaceProofRouting
    ? 'This repo shape justifies surface-aware proof routing, so the starter adapter also includes `defaultProofLanes` and `uncoveredPathPolicy` alongside the legacy flat proof lane for compatibility.'
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
  force = false,
}) {
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedProofLane = proofLane ?? repoInsights.proofLane;
  const adapterPath = resolve(rootDir, '.veritas/repo.adapter.json');
  const policyPackPath = resolve(rootDir, '.veritas/policy-packs/default.policy-pack.json');
  const teamProfilePath = resolve(rootDir, '.veritas/team/default.team-profile.json');
  const readmePath = resolve(rootDir, '.veritas/README.md');
  const governancePath = resolve(rootDir, '.veritas/GOVERNANCE.md');

  const files = [
    [adapterPath, buildStarterAdapter({ projectName, proofLane: resolvedProofLane, repoInsights })],
    [policyPackPath, buildStarterPolicyPack({ projectName })],
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
