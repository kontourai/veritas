import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export function loadAdapterConfig(configPath) {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function loadPolicyPack(policyPackPath) {
  return JSON.parse(readFileSync(policyPackPath, 'utf8'));
}

export function loadTeamProfile(teamProfilePath) {
  return JSON.parse(readFileSync(teamProfilePath, 'utf8'));
}

export function loadEvidenceArtifact(evidencePath) {
  return JSON.parse(readFileSync(evidencePath, 'utf8'));
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeRepoPath(filePath, rootDir) {
  return relative(rootDir, resolve(rootDir, filePath)).replaceAll('\\', '/');
}

export function matchesPatterns(filePath, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith('/') ? filePath.startsWith(pattern) : filePath === pattern,
  );
}

export function matchesPatternsForAnyFile(files, patterns) {
  return files.some((file) => matchesPatterns(file, patterns));
}

export function classifyNodes(files, config, rootDir) {
  const matchedNodeIds = new Set();
  const matchedLaneLabels = new Set();
  const unmatchedFiles = [];

  for (const file of files) {
    const normalized = normalizeRepoPath(file, rootDir);
    let matched = false;
    for (const node of config.graph.nodes) {
      if (matchesPatterns(normalized, node.patterns)) {
        matchedNodeIds.add(node.id);
        matchedLaneLabels.add(node.label);
        matched = true;
      }
    }
    if (!matched) {
      unmatchedFiles.push(normalized);
    }
  }

  return {
    affectedNodes: [...matchedNodeIds].sort(),
    affectedLanes: [...matchedLaneLabels].sort(),
    unmatchedFiles,
  };
}

export function resolveWorkstream(options, config, normalizedFiles = []) {
  if (options.workstream) {
    const resolvedPhase =
      options.phase ??
      config.graph.activePhase ??
      config.graph.defaultResolution?.phase;
    return {
      resolvedPhase,
      resolvedWorkstream: options.workstream,
      matchedArtifacts: ['explicit-workstream'],
      promotionAllowed: options.workstream !== 'multi-workstream',
    };
  }

  for (const rule of config.graph.resolutionRules ?? []) {
    if (matchesPatternsForAnyFile(normalizedFiles, rule.match.patterns)) {
      return {
        resolvedPhase: rule.resolution.phase,
        resolvedWorkstream: rule.resolution.workstream,
        matchedArtifacts: rule.resolution.matchedArtifacts,
        promotionAllowed: true,
      };
    }
  }

  const defaultResolution = config.graph.defaultResolution;
  return {
    resolvedPhase: defaultResolution.phase,
    resolvedWorkstream: defaultResolution.workstream,
    matchedArtifacts: defaultResolution.matchedArtifacts,
    promotionAllowed: true,
  };
}

export function parseBaselineCiFastStatus(status) {
  if (status === 'success') return true;
  if (status === 'failed') return false;
  return null;
}

export function formatTriState(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

export function buildEvidenceRecord({
  files,
  options = {},
  config,
  policyPack,
  rootDir,
}) {
  const frameworkVersion = config.frameworkVersion ?? config.graph?.version;
  const runId = options.runId ?? `guidance-${Date.now()}`;
  const timestamp = new Date().toISOString();
  const normalizedFiles = files.map((file) => normalizeRepoPath(file, rootDir));
  const { affectedNodes, affectedLanes, unmatchedFiles } = classifyNodes(
    files,
    config,
    rootDir,
  );
  const resolution = resolveWorkstream(options, config, normalizedFiles);
  const baselineCiFastPassed = parseBaselineCiFastStatus(
    options.baselineCiFastStatus,
  );
  const policyDefaults = {
    false_positive_review: config.policy?.defaultFalsePositiveReview ?? 'unknown',
    promotion_candidate: config.policy?.defaultPromotionCandidate ?? false,
    override_or_bypass: config.policy?.defaultOverrideOrBypass ?? false,
  };
  const recommendations = unmatchedFiles.length
    ? [
        {
          kind: 'unmatched-files',
          message: 'Some files do not match a configured lane and need manual review.',
          files: unmatchedFiles,
        },
      ]
    : [];
  const adapterName = config.name ?? config.adapter?.name;
  const adapterKind = config.kind ?? config.adapter?.kind;
  const resolvedPolicyPack =
    policyPack ??
    (() => {
      throw new Error('buildEvidenceRecord requires a policyPack');
    })();

  return {
    framework_version: frameworkVersion,
    run_id: runId,
    timestamp,
    source_ref: options.sourceRef ?? 'local-dry-run',
    source_kind: options.sourceKind ?? 'explicit-files',
    source_scope: options.sourceScope ?? ['explicit'],
    resolved_phase: resolution.resolvedPhase,
    resolved_workstream: resolution.resolvedWorkstream,
    matched_artifacts: resolution.matchedArtifacts,
    affected_nodes: affectedNodes,
    affected_lanes: affectedLanes,
    baseline_ci_fast_passed: baselineCiFastPassed,
    recommendations,
    false_positive_review: policyDefaults.false_positive_review,
    promotion_candidate: policyDefaults.promotion_candidate,
    override_or_bypass: policyDefaults.override_or_bypass,
    owner: options.owner ?? null,
    files: normalizedFiles,
    unresolved_files: unmatchedFiles,
    promotion_allowed: resolution.promotionAllowed,
    framework: {
      version: frameworkVersion,
      resolver_precedence: config.graph.resolverPrecedence,
      policy_defaults: policyDefaults,
    },
    adapter: {
      name: adapterName,
      kind: adapterKind,
      report_transport: config.evidence.reportTransport,
      default_resolution: config.graph.defaultResolution,
      non_sliceable_invariants: config.graph.nonSliceableInvariants,
      required_proof_lanes: config.evidence.requiredProofLanes,
    },
    policy_pack: {
      name: resolvedPolicyPack.name,
      version: resolvedPolicyPack.version,
      rule_count: resolvedPolicyPack.rules.length,
    },
  };
}

function parseBooleanFlag(value, optionName) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${optionName} must be either true or false`);
}

export function buildEvalRecord({
  evidenceRecord,
  evidencePath,
  teamProfile,
  options = {},
  rootDir,
}) {
  if (!evidenceRecord?.run_id) {
    throw new Error('buildEvalRecord requires an evidence record with run_id');
  }
  if (!teamProfile?.id) {
    throw new Error('buildEvalRecord requires a team profile with id');
  }
  if (typeof options.timeToGreenMinutes !== 'number' || Number.isNaN(options.timeToGreenMinutes)) {
    throw new Error('buildEvalRecord requires timeToGreenMinutes');
  }
  if (typeof options.overrideCount !== 'number' || Number.isNaN(options.overrideCount)) {
    throw new Error('buildEvalRecord requires overrideCount');
  }
  if (typeof options.acceptedWithoutMajorRewrite !== 'boolean') {
    throw new Error('buildEvalRecord requires acceptedWithoutMajorRewrite');
  }
  if (typeof options.requiredFollowup !== 'boolean') {
    throw new Error('buildEvalRecord requires requiredFollowup');
  }
  if (options.timeToGreenMinutes < 0) {
    throw new Error('timeToGreenMinutes must be zero or greater');
  }
  if (!Number.isInteger(options.overrideCount) || options.overrideCount < 0) {
    throw new Error('overrideCount must be a non-negative integer');
  }
  if (
    options.reviewerConfidence &&
    options.reviewerConfidence !== 'unknown' &&
    !(
      teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']
    ).includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the team profile scale or be unknown',
    );
  }
  const evidenceRelativePath = relative(rootDir, resolve(evidencePath)).replaceAll('\\', '/');
  if (
    evidenceRelativePath.startsWith('..') ||
    !evidenceRelativePath.startsWith('.ai-guidance/evidence/')
  ) {
    throw new Error(
      'eval record requires a repo-local evidence artifact inside .ai-guidance/evidence/',
    );
  }
  const requiredEvidenceKeys = [
    'framework_version',
    'run_id',
    'timestamp',
    'source_ref',
    'source_kind',
    'source_scope',
    'affected_nodes',
    'affected_lanes',
  ];
  for (const key of requiredEvidenceKeys) {
    if (!(key in evidenceRecord)) {
      throw new Error(`evidence artifact is missing required key: ${key}`);
    }
  }
  const evidenceDigest = sha256Hex(readFileSync(evidencePath, 'utf8'));

  return {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: teamProfile.id,
    mode: teamProfile.defaults?.mode ?? 'shadow',
    evidence: {
      artifact_path: evidenceRelativePath,
      artifact_digest: evidenceDigest,
      timestamp: evidenceRecord.timestamp,
      source_ref: evidenceRecord.source_ref,
      source_kind: evidenceRecord.source_kind,
      source_scope: evidenceRecord.source_scope ?? [],
      affected_nodes: evidenceRecord.affected_nodes ?? [],
      affected_lanes: evidenceRecord.affected_lanes ?? [],
    },
    outcome: {
      accepted_without_major_rewrite: options.acceptedWithoutMajorRewrite,
      required_followup: options.requiredFollowup,
      reviewer_confidence: options.reviewerConfidence ?? 'unknown',
    },
    measurements: {
      time_to_green_minutes: options.timeToGreenMinutes,
      override_count: options.overrideCount,
      false_positive_rules: options.falsePositiveRules ?? [],
      missed_issues: options.missedIssues ?? [],
    },
    notes: options.notes ?? [],
  };
}

function buildRuleResult(rule, overrides = {}) {
  return {
    rule_id: rule.id,
    classification: rule.classification,
    stage: rule.stage,
    message: rule.message,
    owner: rule.owner ?? null,
    rollback_switch: rule.rollback_switch ?? null,
    implemented: false,
    passed: null,
    summary: `Rule ${rule.id} is metadata-only in the current framework.`,
    findings: [],
    ...overrides,
  };
}

export function evaluateRequiredArtifactsRule(rule, { rootDir }) {
  const missingArtifacts = (rule.match?.artifacts ?? []).filter(
    (artifact) => !existsSync(resolve(rootDir, artifact)),
  );

  return buildRuleResult(rule, {
    implemented: true,
    passed: missingArtifacts.length === 0,
    summary:
      missingArtifacts.length === 0
        ? 'All required repository artifacts are present.'
        : 'Some required repository artifacts are missing.',
    findings: missingArtifacts.map((artifact) => ({
      kind: 'missing-artifact',
      artifact,
    })),
  });
}

export function evaluatePolicyRule(rule, context) {
  if (Array.isArray(rule.match?.artifacts)) {
    return evaluateRequiredArtifactsRule(rule, context);
  }

  return buildRuleResult(rule);
}

export function evaluatePolicyPack(policyPack, context, options = {}) {
  const selectedRuleIds = new Set(options.ruleIds ?? []);
  return policyPack.rules
    .filter((rule) => selectedRuleIds.size === 0 || selectedRuleIds.has(rule.id))
    .map((rule) => evaluatePolicyRule(rule, context));
}

export function slugifyProjectName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function detectSourceRoots(rootDir) {
  return ['src/', 'app/', 'packages/', 'apps/', 'docs/', 'content/'].filter((path) =>
    existsSync(resolve(rootDir, path)),
  );
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
      )
        .trim();
      if (headBranch) {
        return headBranch;
      }
    } catch {
      // ignore and fall through to placeholder
    }
  }

  return '<base-ref>';
}

export function inferBootstrapRepoInsights(rootDir) {
  const packageJson = readJsonIfExists(resolve(rootDir, 'package.json'));
  const scripts = packageJson?.scripts ?? {};
  const sourceRoots = detectSourceRoots(rootDir);
  const testRoots = detectTestRoots(rootDir);
  const hasWorkflows = existsSync(resolve(rootDir, '.github/workflows'));
  const hasWorkspaceConfig =
    existsSync(resolve(rootDir, 'pnpm-workspace.yaml')) ||
    existsSync(resolve(rootDir, 'turbo.json')) ||
    existsSync(resolve(rootDir, 'nx.json')) ||
    existsSync(resolve(rootDir, 'package.json')) &&
      Array.isArray(packageJson?.workspaces);

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
    testRoots,
    hasWorkflows,
    proofLane,
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
      label: '.ai-guidance/**',
      patterns: ['.ai-guidance/'],
    },
    {
      id: 'governance.root-manifests',
      kind: 'governance-surface',
      label: 'root manifests',
      patterns: ['package.json', 'README.md', '.gitignore', 'AGENTS.md'],
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

export function buildStarterAdapter({
  projectName,
  proofLane = 'npm test',
  repoInsights = {
    repoKind: 'application',
    sourceRoots: [],
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
        'matching local artifact under .ai-guidance/**',
        'active repo roadmap or README guidance',
        'multi-workstream fallback suppresses promotion',
      ],
      resolutionRules: [
        {
          id: 'guidance-files',
          match: {
            patterns: ['.ai-guidance/'],
          },
          resolution: {
            phase: 'Phase 0 (Bootstrap)',
            workstream: 'Initial Project Setup',
            matchedArtifacts: ['.ai-guidance/**'],
          },
        },
      ],
      nodes: buildAdaptiveNodes(repoInsights),
    },
    evidence: {
      artifactDir: '.ai-guidance/evidence',
      requiredProofLanes: [proofLane],
      reportTransport: 'local-json',
    },
  };
}

export function buildStarterPolicyPack({ projectName }) {
  const projectSlug = slugifyProjectName(projectName);

  return {
    version: 1,
    name: `${projectSlug}-default`,
    description:
      'Conservative starter policy pack for a newly bootstrapped AI-guided repository.',
    rules: [
      {
        id: 'required-guidance-artifacts',
        classification: 'hard-invariant',
        stage: 'block',
        message:
          'The bootstrap guidance artifacts must stay present so agents and reviewers share the same baseline.',
        owner: 'repo-core',
        rollback_switch: null,
        match: {
          artifacts: [
            '.ai-guidance/README.md',
            '.ai-guidance/repo.adapter.json',
            '.ai-guidance/policy-packs/default.policy-pack.json',
            '.ai-guidance/team/default.team-profile.json',
          ],
        },
      },
      {
        id: 'prefer-guidance-routed-delivery',
        classification: 'promotable-policy',
        stage: 'recommend',
        message:
          'Prefer running new AI-guided changes through the guidance report and the documented proof lane before review.',
        owner: 'repo-maintainers',
        rollback_switch: 'soften-guidance-route',
        match: {
          files: ['.ai-guidance/README.md'],
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
    testRoots: [],
    hasWorkflows: false,
    matchedScripts: [],
  },
}) {
  return `# AI Guidance Starter Kit

This repo was bootstrapped for \`${projectName}\` with a conservative starter kit for agent-guided development.

## Generated Files

- \`.ai-guidance/repo.adapter.json\`
- \`.ai-guidance/policy-packs/default.policy-pack.json\`
- \`.ai-guidance/team/default.team-profile.json\`

## Inferred Repo Shape

- Repo kind: \`${repoInsights.repoKind}\`
- Source roots: ${
    repoInsights.sourceRoots.length > 0
      ? `\`${repoInsights.sourceRoots.join('`, `')}\``
      : '`src/` (default)'
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
npm exec -- ai-guidance print package-scripts
npm exec -- ai-guidance print ci-snippet
npm exec -- ai-guidance apply package-scripts
npm exec -- ai-guidance apply ci-snippet
npm exec -- ai-guidance report package.json
\`\`\`

If you prefer explicit paths:

\`\`\`bash
npm exec -- ai-guidance report \\
  --adapter ./.ai-guidance/repo.adapter.json \\
  --policy-pack ./.ai-guidance/policy-packs/default.policy-pack.json \\
  package.json
\`\`\`

## Suggested Proof Lane

\`${proofLane}\`

## Why This Exists

The goal is to give any compatible agent just-in-time repo guidance from day one, while keeping review and CI grounded in the same starter rules.
`;
}

export function writeBootstrapStarterKit({
  rootDir,
  projectName = basename(resolve(rootDir)),
  proofLane,
  force = false,
}) {
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedProofLane = proofLane ?? repoInsights.proofLane;
  const adapterPath = resolve(rootDir, '.ai-guidance/repo.adapter.json');
  const policyPackPath = resolve(
    rootDir,
    '.ai-guidance/policy-packs/default.policy-pack.json',
  );
  const teamProfilePath = resolve(
    rootDir,
    '.ai-guidance/team/default.team-profile.json',
  );
  const readmePath = resolve(rootDir, '.ai-guidance/README.md');

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
      'Refusing to overwrite existing file: .ai-guidance/README.md (use --force to replace it)',
    );
  }

  mkdirSync(resolve(rootDir, '.ai-guidance/policy-packs'), { recursive: true });
  mkdirSync(resolve(rootDir, '.ai-guidance/team'), { recursive: true });
  mkdirSync(resolve(rootDir, '.ai-guidance/evidence'), { recursive: true });

  for (const [filePath, payload] of files) {
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  writeFileSync(
    readmePath,
    buildBootstrapReadme({ projectName, proofLane: resolvedProofLane, repoInsights }),
    'utf8',
  );

  return {
    rootDir,
    projectName,
    proofLane: resolvedProofLane,
    repoInsights,
    generatedFiles: [
      relative(rootDir, readmePath).replaceAll('\\', '/'),
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
    'guidance:init': 'npm exec -- ai-guidance init',
    'guidance:print:scripts': 'npm exec -- ai-guidance print package-scripts',
    'guidance:print:ci': 'npm exec -- ai-guidance print ci-snippet',
    'guidance:report': 'npm exec -- ai-guidance report --run-id local-smoke package.json',
    'guidance:report:diff': `npm exec -- ai-guidance report --changed-from ${baseRef} --changed-to HEAD`,
    'guidance:proof': proofLane,
  };
}

export function buildSuggestedCiSnippet({
  proofLane = 'npm test',
  baseRef = '<base-ref>',
}) {
  return `# Suggested ai-guidance CI snippet
- name: Run project proof lane
  run: ${proofLane}

- name: Generate guidance report
  run: npm exec -- ai-guidance report --changed-from ${baseRef} --changed-to HEAD
`;
}

export function applyPackageScripts({
  rootDir,
  proofLane = 'npm test',
  baseRef = '<base-ref>',
  force = false,
}) {
  const packageJsonPath = resolve(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('apply package-scripts requires package.json at the repo root');
  }

  const packageJson = loadAdapterConfig(packageJsonPath);
  const nextScripts = buildSuggestedPackageScripts({ proofLane, baseRef });
  const currentScripts = packageJson.scripts ?? {};

  for (const [key, value] of Object.entries(nextScripts)) {
    if (!force && key in currentScripts && currentScripts[key] !== value) {
      throw new Error(
        `Refusing to overwrite existing script ${key}; rerun with --force if you want to replace it`,
      );
    }
  }

  packageJson.scripts = { ...currentScripts, ...nextScripts };
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  return {
    rootDir,
    packageJsonPath: relative(rootDir, packageJsonPath).replaceAll('\\', '/'),
    proofLane,
    baseRef,
    appliedScripts: Object.keys(nextScripts),
  };
}

export function applyCiSnippet({
  rootDir,
  proofLane = 'npm test',
  baseRef = '<base-ref>',
  outputPath = '.ai-guidance/snippets/ci-snippet.yml',
  force = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const relativeOutputPath = relative(rootDir, resolvedOutputPath).replaceAll('\\', '/');

  if (
    relativeOutputPath.startsWith('..') ||
    !relativeOutputPath.startsWith('.ai-guidance/snippets/')
  ) {
    throw new Error(
      'apply ci-snippet only supports writing inside .ai-guidance/snippets/',
    );
  }

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${outputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(resolve(rootDir, '.ai-guidance/snippets'), { recursive: true });
  writeFileSync(
    resolvedOutputPath,
    buildSuggestedCiSnippet({ proofLane, baseRef }),
    'utf8',
  );

  return {
    rootDir,
    outputPath: relativeOutputPath,
    proofLane,
    baseRef,
  };
}

export function writeEvidenceArtifact(record, config, rootDir) {
  const artifactDir = resolve(rootDir, config.evidence.artifactDir);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = resolve(artifactDir, `${record.run_id}.json`);
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export function writeEvalArtifact(
  record,
  rootDir,
  outputPath = `.ai-guidance/evals/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  if (
    relativeArtifactPath.startsWith('..') ||
    !relativeArtifactPath.startsWith('.ai-guidance/evals/')
  ) {
    throw new Error(
      'eval artifacts may only be written inside .ai-guidance/evals/',
    );
  }
  if (existsSync(artifactPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeArtifactPath} (use --force to replace it)`,
    );
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export function listChangedFiles(fromRef, toRef, rootDir) {
  if (!fromRef || !toRef) return [];

  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', fromRef, toRef], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function listGitFiles(args, rootDir) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listWorkingTreeFiles(
  { staged = false, unstaged = false, untracked = false } = {},
  rootDir,
) {
  const files = new Set();

  if (staged) {
    for (const file of listGitFiles(
      ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  if (unstaged) {
    for (const file of listGitFiles(
      ['diff', '--name-only', '--diff-filter=ACMR'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  if (untracked) {
    for (const file of listGitFiles(
      ['ls-files', '--others', '--exclude-standard'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  return [...files].sort();
}

export function resolveReportInputs(explicitFiles, options, rootDir) {
  if (explicitFiles.length > 0) {
    return {
      files: explicitFiles,
      sourceKind: 'explicit-files',
      sourceScope: ['explicit'],
      sourceRef: options.sourceRef ?? 'local-dry-run',
    };
  }

  if (options.changedFrom || options.changedTo) {
    if (!options.changedFrom || !options.changedTo) {
      throw new Error(
        'branch-diff reporting requires both --changed-from and --changed-to',
      );
    }
    const sourceRef =
      options.sourceRef ??
      `${options.changedFrom}..${options.changedTo}`;
    return {
      files: listChangedFiles(options.changedFrom, options.changedTo, rootDir),
      sourceKind: 'branch-diff',
      sourceScope: [
        ...(options.changedFrom ? [`changed-from:${options.changedFrom}`] : []),
        ...(options.changedTo ? [`changed-to:${options.changedTo}`] : []),
      ],
      sourceRef,
    };
  }

  const workingTreeScopes = [
    ...(options.workingTree ? ['staged', 'unstaged', 'untracked'] : []),
    ...(options.staged ? ['staged'] : []),
    ...(options.unstaged ? ['unstaged'] : []),
    ...(options.untracked ? ['untracked'] : []),
  ];

  if (workingTreeScopes.length > 0) {
    const uniqueScopes = [...new Set(workingTreeScopes)];
    return {
      files: listWorkingTreeFiles(
        {
          staged: uniqueScopes.includes('staged'),
          unstaged: uniqueScopes.includes('unstaged'),
          untracked: uniqueScopes.includes('untracked'),
        },
        rootDir,
      ),
      sourceKind: 'working-tree',
      sourceScope: uniqueScopes,
      sourceRef: options.sourceRef ?? 'working-tree',
    };
  }

  return {
    files: [],
    sourceKind: 'explicit-files',
    sourceScope: ['explicit'],
    sourceRef: options.sourceRef ?? 'local-dry-run',
  };
}

export function buildMarkdownSummary(record, artifactPath) {
  const lines = [
    '## Guidance Report',
    '',
    `- **Adapter:** ${record.adapter.name} (${record.adapter.kind})`,
    `- **Source:** ${record.source_kind} (${record.source_scope.join(', ')})`,
    `- **Phase:** ${record.resolved_phase}`,
    `- **Workstream:** ${record.resolved_workstream}`,
    `- **Affected nodes:** ${
      record.affected_nodes.length ? record.affected_nodes.join(', ') : 'none'
    }`,
    `- **Affected lanes:** ${
      record.affected_lanes.length ? record.affected_lanes.join(', ') : 'none'
    }`,
    `- **Required proof lane:** \`${record.adapter.required_proof_lanes.join(', ')}\``,
    `- **Baseline \`ci:fast\` passed:** ${formatTriState(record.baseline_ci_fast_passed)}`,
    `- **Report transport:** ${record.adapter.report_transport}`,
    `- **Artifact:** \`${artifactPath}\``,
  ];

  if (record.recommendations.length > 0) {
    lines.push('', '### Recommendations');
    for (const recommendation of record.recommendations) {
      lines.push(`- ${recommendation.message}`);
      if (recommendation.files?.length) {
        lines.push(`  - Files: ${recommendation.files.join(', ')}`);
      }
    }
  } else {
    lines.push('', '- No recommendations.');
  }

  return `${lines.join('\n')}\n`;
}

export function buildEvalMarkdownSummary(record, artifactPath) {
  const lines = [
    '## Guidance Eval',
    '',
    `- **Run ID:** ${record.run_id}`,
    `- **Mode:** ${record.mode}`,
    `- **Team profile:** ${record.team_profile_id}`,
    `- **Evidence artifact:** \`${record.evidence.artifact_path}\``,
    `- **Eval artifact:** \`${artifactPath}\``,
    `- **Accepted without major rewrite:** ${record.outcome.accepted_without_major_rewrite ? 'yes' : 'no'}`,
    `- **Required follow-up:** ${record.outcome.required_followup ? 'yes' : 'no'}`,
    `- **Reviewer confidence:** ${record.outcome.reviewer_confidence}`,
    `- **Time to green:** ${record.measurements.time_to_green_minutes} minutes`,
    `- **Override count:** ${record.measurements.override_count}`,
  ];

  if (record.measurements.false_positive_rules.length > 0) {
    lines.push(`- **False-positive rules:** ${record.measurements.false_positive_rules.join(', ')}`);
  }

  if (record.measurements.missed_issues.length > 0) {
    lines.push(`- **Missed issues:** ${record.measurements.missed_issues.join(', ')}`);
  }

  if (record.notes.length > 0) {
    lines.push('', '### Notes');
    for (const note of record.notes) {
      lines.push(`- ${note}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv) {
  const options = {};
  const files = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--adapter') {
      options.adapterPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--policy-pack') {
      options.policyPackPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--root') {
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--workstream') {
      options.workstream = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--phase') {
      options.phase = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--source-ref') {
      options.sourceRef = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--owner') {
      options.owner = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--baseline-ci-fast-status') {
      options.baselineCiFastStatus = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--run-id') {
      options.runId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--changed-from') {
      options.changedFrom = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--changed-to') {
      options.changedTo = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--working-tree') {
      options.workingTree = true;
      continue;
    }
    if (token === '--staged') {
      options.staged = true;
      continue;
    }
    if (token === '--unstaged') {
      options.unstaged = true;
      continue;
    }
    if (token === '--untracked') {
      options.untracked = true;
      continue;
    }
    if (token === '--summary-path') {
      options.summaryPath = argv[index + 1];
      index += 1;
      continue;
    }
    files.push(token);
  }

  return { options, files };
}

export function parseInitArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--project-name') {
      options.projectName = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--proof-lane') {
      options.proofLane = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--force') {
      options.force = true;
    }
  }

  return options;
}

export function parsePrintArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--proof-lane') {
      options.proofLane = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

export function parseApplyArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--proof-lane') {
      options.proofLane = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--output') {
      options.outputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--force') {
      options.force = true;
    }
  }

  return options;
}

export function parseEvalArgs(argv) {
  const options = {
    falsePositiveRules: [],
    missedIssues: [],
    notes: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      options.rootDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--evidence') {
      options.evidencePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--team-profile') {
      options.teamProfilePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--output') {
      options.outputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--accepted-without-major-rewrite') {
      options.acceptedWithoutMajorRewrite = parseBooleanFlag(
        argv[index + 1],
        '--accepted-without-major-rewrite',
      );
      index += 1;
      continue;
    }
    if (token === '--required-followup') {
      options.requiredFollowup = parseBooleanFlag(
        argv[index + 1],
        '--required-followup',
      );
      index += 1;
      continue;
    }
    if (token === '--reviewer-confidence') {
      options.reviewerConfidence = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--time-to-green-minutes') {
      options.timeToGreenMinutes = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--override-count') {
      options.overrideCount = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--false-positive-rule') {
      options.falsePositiveRules.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--missed-issue') {
      options.missedIssues.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--note') {
      options.notes.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--force') {
      options.force = true;
      continue;
    }
  }

  return options;
}

export function runGuidanceReportCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseArgs(argv);
  const rootDir = options.rootDir ? resolve(options.rootDir) : defaults.rootDir;
  const defaultAdapterPath =
    defaults.adapterPath ?? (rootDir ? resolve(rootDir, '.ai-guidance/repo.adapter.json') : undefined);
  const defaultPolicyPackPath =
    defaults.policyPackPath ??
    (rootDir
      ? resolve(rootDir, '.ai-guidance/policy-packs/default.policy-pack.json')
      : undefined);
  const adapterPath = options.adapterPath
    ? resolve(options.adapterPath)
    : defaultAdapterPath;
  const policyPackPath = options.policyPackPath
    ? resolve(options.policyPackPath)
    : defaultPolicyPackPath;

  if (!rootDir || !adapterPath || !policyPackPath) {
    throw new Error(
      'Guidance report requires rootDir, adapterPath, and policyPackPath',
    );
  }

  const reportInputs = resolveReportInputs(explicitFiles, options, rootDir);
  const files = reportInputs.files;

  if (files.length === 0 && reportInputs.sourceKind === 'explicit-files') {
    throw new Error('guidance-report requires at least one file path');
  }

  const config = loadAdapterConfig(adapterPath);
  const policyPack = loadPolicyPack(policyPackPath);
  const record = buildEvidenceRecord({
    files,
    options: {
      ...options,
      sourceRef: reportInputs.sourceRef,
      sourceKind: reportInputs.sourceKind,
      sourceScope: reportInputs.sourceScope,
    },
    config,
    policyPack,
    rootDir,
  });
  const artifactPath = writeEvidenceArtifact(record, config, rootDir);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const markdownSummary = buildMarkdownSummary(record, relativeArtifactPath);

  const resolvedSummaryPath =
    options.summaryPath ??
    (config.evidence.reportTransport === 'github-step-summary'
      ? process.env.GITHUB_STEP_SUMMARY
      : undefined);

  if (resolvedSummaryPath) {
    appendFileSync(resolvedSummaryPath, markdownSummary, 'utf8');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: relativeArtifactPath,
        markdownSummary,
        ...record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runInitCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseInitArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const projectName = options.projectName ?? defaults.projectName ?? basename(rootDir);
  const result = writeBootstrapStarterKit({
    rootDir,
    projectName,
    proofLane: options.proofLane ?? defaults.proofLane,
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runPrintPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        proofLane,
        repoInsights,
        scripts: buildSuggestedPackageScripts({
          proofLane,
          baseRef: repoInsights.baseRef,
        }),
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        proofLane,
        repoInsights,
        ciSnippet: buildSuggestedCiSnippet({
          proofLane,
          baseRef: repoInsights.baseRef,
        }),
      },
      null,
      2,
    )}\n`,
  );
}

export function runApplyPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;
  const result = applyPackageScripts({
    rootDir,
    proofLane,
    baseRef: repoInsights.baseRef,
    force: options.force ?? false,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        repoInsights,
      },
      null,
      2,
    )}\n`,
  );
}

export function runApplyCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;
  const result = applyCiSnippet({
    rootDir,
    proofLane,
    baseRef: repoInsights.baseRef,
    outputPath: options.outputPath ?? '.ai-guidance/snippets/ci-snippet.yml',
    force: options.force ?? false,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        repoInsights,
      },
      null,
      2,
    )}\n`,
  );
}

export function runEvalRecordCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const evidencePath = options.evidencePath
    ? resolve(rootDir, options.evidencePath)
    : undefined;
  const teamProfilePath = options.teamProfilePath
    ? resolve(rootDir, options.teamProfilePath)
    : resolve(rootDir, '.ai-guidance/team/default.team-profile.json');

  if (!evidencePath) {
    throw new Error('guidance eval record requires --evidence <path>');
  }

  const evidenceRecord = loadEvidenceArtifact(evidencePath);
  const teamProfile = loadTeamProfile(teamProfilePath);
  const record = buildEvalRecord({
    evidenceRecord,
    evidencePath,
    teamProfile,
    options,
    rootDir,
  });
  const artifactPath = writeEvalArtifact(
    record,
    rootDir,
    options.outputPath,
    options.force ?? false,
  );
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const markdownSummary = buildEvalMarkdownSummary(record, relativeArtifactPath);

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: relativeArtifactPath,
        markdownSummary,
        ...record,
      },
      null,
      2,
    )}\n`,
  );
}
