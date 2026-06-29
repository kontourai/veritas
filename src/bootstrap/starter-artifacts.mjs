import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../load.mjs';
import {
  DEFAULT_SELECTED_INSTRUCTION_TARGETS,
  OPTIONAL_INSTRUCTION_TARGETS,
  normalizeInstructionTargets,
} from './guidance.mjs';

const STARTER_REPO_STANDARD_TEMPLATES = new Map([
  ['nextjs-typescript', 'nextjs-typescript.repo-standards.json'],
  ['python-fastapi', 'python-fastapi.repo-standards.json'],
  ['monorepo-pnpm', 'monorepo-pnpm.repo-standards.json'],
]);

const FRAMEWORK_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function slugifyProjectName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
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
        enforcementLevel: 'Require',
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
        enforcementLevel: 'Guide',
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
        enforcementLevel: 'Observe',
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
      new_rule_enforcement_level: 'Observe',
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
