import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
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

export function loadEvalDraftArtifact(draftPath) {
  return JSON.parse(readFileSync(draftPath, 'utf8'));
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
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

function uniqueStrings(items = []) {
  return [...new Set(items.filter((item) => typeof item === 'string' && item.length > 0))];
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

function readSurfaceProofRoutes(config) {
  return Array.isArray(config.evidence?.surfaceProofLanes)
    ? config.evidence.surfaceProofLanes
    : [];
}

function readDefaultProofLanes(config) {
  return uniqueStrings(config.evidence?.defaultProofLanes ?? []);
}

function readLegacyProofLanes(config) {
  return uniqueStrings(config.evidence?.requiredProofLanes ?? []);
}

function readUncoveredPathPolicy(config) {
  const policy = config.evidence?.uncoveredPathPolicy;
  if (policy === 'ignore' || policy === 'fail') {
    return policy;
  }
  return 'warn';
}

function routeMatchesAnyNode(route, affectedNodes) {
  return (route.nodeIds ?? []).some((nodeId) => affectedNodes.includes(nodeId));
}

function serializeSurfaceProofRoutes(config) {
  return readSurfaceProofRoutes(config).map((route) => ({
    node_ids: uniqueStrings(route.nodeIds ?? []),
    proof_lanes: uniqueStrings(route.proofLanes ?? []),
  }));
}

export function resolveProofPlan({
  files,
  config,
  rootDir,
  explicitProofCommand,
}) {
  const { affectedNodes, affectedLanes, unmatchedFiles } = classifyNodes(files, config, rootDir);
  const uncoveredPathPolicy = readUncoveredPathPolicy(config);
  const surfaceRoutes = readSurfaceProofRoutes(config);
  const matchedRoutes = surfaceRoutes.filter((route) => routeMatchesAnyNode(route, affectedNodes));
  let proofCommands = [];
  let resolutionSource = 'none';

  if (explicitProofCommand) {
    proofCommands = [explicitProofCommand];
    resolutionSource = 'explicit';
  } else if (matchedRoutes.length > 0) {
    const routedNodeIds = new Set(
      matchedRoutes.flatMap((route) => (route.nodeIds ?? []).filter((nodeId) => affectedNodes.includes(nodeId))),
    );
    proofCommands = uniqueStrings(matchedRoutes.flatMap((route) => route.proofLanes ?? []));
    if (affectedNodes.some((nodeId) => !routedNodeIds.has(nodeId))) {
      const defaultProofLanes = readDefaultProofLanes(config);
      const legacyProofLanes = readLegacyProofLanes(config);
      proofCommands = uniqueStrings([
        ...proofCommands,
        ...(defaultProofLanes.length > 0 ? defaultProofLanes : legacyProofLanes),
      ]);
    }
    resolutionSource = 'surface';
  } else {
    const defaultProofLanes = readDefaultProofLanes(config);
    const legacyProofLanes = readLegacyProofLanes(config);

    if (defaultProofLanes.length > 0) {
      proofCommands = defaultProofLanes;
      resolutionSource = 'default';
    } else if (legacyProofLanes.length > 0) {
      proofCommands = legacyProofLanes;
      resolutionSource = 'legacy';
    }
  }

  return {
    affectedNodes,
    affectedLanes,
    unmatchedFiles,
    uncoveredPathPolicy,
    uncoveredPathResult: unmatchedFiles.length > 0 ? uncoveredPathPolicy : 'clear',
    proofCommands,
    resolutionSource,
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
  const runId = options.runId ?? `veritas-${Date.now()}`;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalizedFiles = files.map((file) => normalizeRepoPath(file, rootDir));
  const proofPlan =
    options.proofPlan ??
    resolveProofPlan({
      files,
      config,
      rootDir,
      explicitProofCommand: options.explicitProofCommand,
    });
  const { affectedNodes, affectedLanes, unmatchedFiles } = proofPlan;
  const unresolvedMessage =
    proofPlan.uncoveredPathResult === 'fail'
      ? 'Some files do not match a configured surface and fail the uncovered-path policy.'
      : proofPlan.uncoveredPathResult === 'ignore'
        ? 'Some files do not match a configured surface and were ignored by policy.'
        : 'Some files do not match a configured surface and need manual review.';
  const recommendations = unmatchedFiles.length
    ? [
        {
          kind: 'unmatched-files',
          severity: proofPlan.uncoveredPathResult,
          message: unresolvedMessage,
          files: unmatchedFiles,
        },
      ]
    : [];
  const resolution = resolveWorkstream(options, config, normalizedFiles);
  const baselineCiFastPassed = parseBaselineCiFastStatus(
    options.baselineCiFastStatus,
  );
  const policyDefaults = {
    false_positive_review: config.policy?.defaultFalsePositiveReview ?? 'unknown',
    promotion_candidate: config.policy?.defaultPromotionCandidate ?? false,
    override_or_bypass: config.policy?.defaultOverrideOrBypass ?? false,
  };
  const adapterName = config.name ?? config.adapter?.name;
  const adapterKind = config.kind ?? config.adapter?.kind;
  const resolvedPolicyPack =
    policyPack ??
    (() => {
      throw new Error('buildEvidenceRecord requires a policyPack');
    })();
  const policyResults =
    options.policyResults ?? evaluatePolicyPack(resolvedPolicyPack, { rootDir });

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
    selected_proof_commands: proofPlan.proofCommands,
    proof_resolution_source: proofPlan.resolutionSource,
    uncovered_path_result: proofPlan.uncoveredPathResult,
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
      required_proof_lanes: readLegacyProofLanes(config),
      default_proof_lanes: readDefaultProofLanes(config),
      surface_proof_lanes: serializeSurfaceProofRoutes(config),
      uncovered_path_policy: proofPlan.uncoveredPathPolicy,
    },
    policy_pack: {
      name: resolvedPolicyPack.name,
      version: resolvedPolicyPack.version,
      rule_count: resolvedPolicyPack.rules.length,
    },
    policy_results: policyResults,
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
  const reviewerConfidenceScale =
    teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high'];
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
    !reviewerConfidenceScale.includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the team profile scale or be unknown',
    );
  }
  const evidence = buildEvalEvidenceContext({ evidenceRecord, evidencePath, rootDir });

  return {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: teamProfile.id,
    mode: teamProfile.defaults?.mode ?? 'shadow',
    evidence,
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

function buildEvalEvidenceContext({ evidenceRecord, evidencePath, rootDir }) {
  const evidenceRelativePath = relative(rootDir, resolve(evidencePath)).replaceAll('\\', '/');
  if (
    evidenceRelativePath.startsWith('..') ||
    !evidenceRelativePath.startsWith('.veritas/evidence/')
  ) {
    throw new Error(
      'eval record requires a repo-local evidence artifact inside .veritas/evidence/',
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
    artifact_path: evidenceRelativePath,
    artifact_digest: evidenceDigest,
    timestamp: evidenceRecord.timestamp,
    source_ref: evidenceRecord.source_ref,
    source_kind: evidenceRecord.source_kind,
    source_scope: evidenceRecord.source_scope ?? [],
    affected_nodes: evidenceRecord.affected_nodes ?? [],
    affected_lanes: evidenceRecord.affected_lanes ?? [],
  };
}

export function buildEvalDraft({
  evidenceRecord,
  evidencePath,
  teamProfile,
  options = {},
  rootDir,
}) {
  if (!evidenceRecord?.run_id) {
    throw new Error('buildEvalDraft requires an evidence record with run_id');
  }
  if (!teamProfile?.id) {
    throw new Error('buildEvalDraft requires a team profile with id');
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
  if (
    options.timeToGreenMinutes !== undefined &&
    (Number.isNaN(options.timeToGreenMinutes) || options.timeToGreenMinutes < 0)
  ) {
    throw new Error('timeToGreenMinutes must be zero or greater when provided');
  }
  if (
    options.overrideCount !== undefined &&
    (!Number.isInteger(options.overrideCount) || options.overrideCount < 0)
  ) {
    throw new Error('overrideCount must be a non-negative integer when provided');
  }

  const prefilledMeasurements = {
    time_to_green_minutes: options.timeToGreenMinutes ?? null,
    override_count: options.overrideCount ?? 0,
    false_positive_rules: options.falsePositiveRules ?? [],
    missed_issues: options.missedIssues ?? [],
  };
  const draft = {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: teamProfile.id,
    mode: teamProfile.defaults?.mode ?? 'shadow',
    evidence: buildEvalEvidenceContext({ evidenceRecord, evidencePath, rootDir }),
    reviewer_confidence_scale: [
      ...(teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
      'unknown',
    ],
    prefilled_outcome: {
      reviewer_confidence: options.reviewerConfidence ?? 'unknown',
    },
    prefilled_measurements: prefilledMeasurements,
    notes: options.notes ?? [],
    missing_confirmation_fields: [
      'accepted_without_major_rewrite',
      'required_followup',
      ...(prefilledMeasurements.time_to_green_minutes === null
        ? ['time_to_green_minutes']
        : []),
    ],
  };

  return draft;
}

function mergeEvalRecordOptions(options, draft) {
  const falsePositiveRules = options.falsePositiveRules ?? [];
  const missedIssues = options.missedIssues ?? [];
  const notes = options.notes ?? [];

  return {
    acceptedWithoutMajorRewrite: options.acceptedWithoutMajorRewrite,
    requiredFollowup: options.requiredFollowup,
    reviewerConfidence:
      options.reviewerConfidence ?? draft?.prefilled_outcome?.reviewer_confidence,
    timeToGreenMinutes:
      options.timeToGreenMinutes ??
      draft?.prefilled_measurements?.time_to_green_minutes,
    overrideCount:
      options.overrideCount ?? draft?.prefilled_measurements?.override_count,
    falsePositiveRules:
      falsePositiveRules.length > 0
        ? falsePositiveRules
        : (draft?.prefilled_measurements?.false_positive_rules ?? []),
    missedIssues:
      missedIssues.length > 0
        ? missedIssues
        : (draft?.prefilled_measurements?.missed_issues ?? []),
    notes: notes.length > 0 ? notes : (draft?.notes ?? []),
  };
}

function buildEvalRecordCommand(draftPath, draft) {
  const args = [
    'npm',
    'exec',
    '--',
    'veritas',
    'eval',
    'record',
    '--draft',
    draftPath,
    '--accepted-without-major-rewrite',
    '<true|false>',
    '--required-followup',
    '<true|false>',
    '--reviewer-confidence',
    draft.prefilled_outcome.reviewer_confidence,
    '--time-to-green-minutes',
    draft.prefilled_measurements.time_to_green_minutes === null
      ? '<minutes>'
      : String(draft.prefilled_measurements.time_to_green_minutes),
    '--override-count',
    String(draft.prefilled_measurements.override_count),
  ];

  for (const rule of draft.prefilled_measurements.false_positive_rules) {
    args.push('--false-positive-rule', rule);
  }
  for (const issue of draft.prefilled_measurements.missed_issues) {
    args.push('--missed-issue', issue);
  }
  for (const note of draft.notes) {
    args.push('--note', note);
  }

  return args.map(shellQuote).join(' ');
}

function validateEvalDraftContext({ draftPath, draftRecord, rootDir, teamProfile }) {
  const draftRelativePath = relative(rootDir, resolve(draftPath)).replaceAll('\\', '/');
  if (
    draftRelativePath.startsWith('..') ||
    !draftRelativePath.startsWith('.veritas/eval-drafts/')
  ) {
    throw new Error(
      'eval record requires a repo-local draft artifact inside .veritas/eval-drafts/',
    );
  }
  const requiredDraftKeys = [
    'version',
    'run_id',
    'team_profile_id',
    'mode',
    'evidence',
    'reviewer_confidence_scale',
    'prefilled_outcome',
    'prefilled_measurements',
    'notes',
    'missing_confirmation_fields',
  ];
  for (const key of requiredDraftKeys) {
    if (!(key in draftRecord)) {
      throw new Error(`eval draft is missing required key: ${key}`);
    }
  }
  if (teamProfile.id !== draftRecord.team_profile_id) {
    throw new Error(
      'eval record draft must be completed with the same team profile that created it',
    );
  }
  const expectedScale = [
    ...(teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
    'unknown',
  ];
  if (JSON.stringify(expectedScale) !== JSON.stringify(draftRecord.reviewer_confidence_scale)) {
    throw new Error(
      'eval record draft reviewer confidence scale must match the team profile scale',
    );
  }
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
  const toolingRoots = detectToolingRoots(rootDir);
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
    toolingRoots,
    testRoots,
    hasWorkflows,
    proofLane,
    enableSurfaceProofRouting:
      repoKind === 'workspace' || toolingRoots.length > 0,
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

export function writeBootstrapStarterKit({
  rootDir,
  projectName = basename(resolve(rootDir)),
  proofLane,
  force = false,
}) {
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedProofLane = proofLane ?? repoInsights.proofLane;
  const adapterPath = resolve(rootDir, '.veritas/repo.adapter.json');
  const policyPackPath = resolve(
    rootDir,
    '.veritas/policy-packs/default.policy-pack.json',
  );
  const teamProfilePath = resolve(
    rootDir,
    '.veritas/team/default.team-profile.json',
  );
  const readmePath = resolve(rootDir, '.veritas/README.md');

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

export function buildSuggestedGitHook({ hook = 'post-commit' } = {}) {
  if (hook !== 'post-commit') {
    throw new Error(`Unsupported git hook kind: ${hook}`);
  }

  return `#!/bin/sh
set -eu

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

if git rev-parse --verify --quiet HEAD~1 >/dev/null; then
  npm exec -- veritas shadow run --changed-from HEAD~1 --changed-to HEAD
else
  EMPTY_TREE="$(git hash-object -t tree /dev/null)"
  npm exec -- veritas shadow run --changed-from "$EMPTY_TREE" --changed-to HEAD
fi
`;
}

export function buildSuggestedRuntimeHook() {
  return `#!/bin/sh
set -eu

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

if [ "$#" -eq 0 ]; then
  exec npm exec -- veritas shadow run --working-tree
fi

exec npm exec -- veritas shadow run "$@"
`;
}

export function buildSuggestedCodexHookConfig() {
  return {
    hooks: {
      Stop: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: '.veritas/hooks/agent-runtime.sh',
              statusMessage: 'Running Veritas shadow automation',
              timeout: 60,
            },
          ],
        },
      ],
    },
  };
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
  outputPath = '.veritas/snippets/ci-snippet.yml',
  force = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const relativeOutputPath = relative(rootDir, resolvedOutputPath).replaceAll('\\', '/');

  if (
    relativeOutputPath.startsWith('..') ||
    !relativeOutputPath.startsWith('.veritas/snippets/')
  ) {
    throw new Error(
      'apply ci-snippet only supports writing inside .veritas/snippets/',
    );
  }

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${outputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(resolve(rootDir, '.veritas/snippets'), { recursive: true });
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

export function applyGitHook({
  rootDir,
  hook = 'post-commit',
  outputPath = `.githooks/${hook}`,
  force = false,
  configureGit = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const relativeOutputPath = relative(rootDir, resolvedOutputPath).replaceAll('\\', '/');

  if (
    relativeOutputPath.startsWith('..') ||
    !relativeOutputPath.startsWith('.githooks/')
  ) {
    throw new Error('apply git-hook only supports writing inside .githooks/');
  }

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }
  if (configureGit && basename(relativeOutputPath) !== hook) {
    throw new Error(
      `apply git-hook with --configure-git requires the output filename to match ${hook}`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, buildSuggestedGitHook({ hook }), 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  let configuredHooksPath = null;
  if (configureGit) {
    configuredHooksPath = dirname(relativeOutputPath);
    execFileSync('git', ['config', 'core.hooksPath', configuredHooksPath], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    });
  }

  return {
    rootDir,
    hook,
    outputPath: relativeOutputPath,
    configuredHooksPath,
  };
}

export function applyRuntimeHook({
  rootDir,
  outputPath = '.veritas/hooks/agent-runtime.sh',
  force = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const relativeOutputPath = relative(rootDir, resolvedOutputPath).replaceAll('\\', '/');

  if (
    relativeOutputPath.startsWith('..') ||
    !relativeOutputPath.startsWith('.veritas/hooks/')
  ) {
    throw new Error(
      'apply runtime-hook only supports writing inside .veritas/hooks/',
    );
  }

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, buildSuggestedRuntimeHook(), 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  return {
    rootDir,
    outputPath: relativeOutputPath,
  };
}

function mergeCodexHooksConfig(existingConfig, adapterConfig) {
  const merged = {
    ...existingConfig,
    hooks: { ...(existingConfig?.hooks ?? {}) },
  };
  const adapterEntries = Array.isArray(adapterConfig?.hooks?.Stop)
    ? adapterConfig.hooks.Stop
    : [];
  const currentEntries = Array.isArray(merged.hooks.Stop) ? merged.hooks.Stop : [];
  const adapterCommand = adapterEntries[0]?.hooks?.[0]?.command;
  const filteredEntries = currentEntries
    .map((entry) => {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const remainingHooks = hooks.filter((hook) => hook?.command !== adapterCommand);
      if (remainingHooks.length === 0) {
        return null;
      }
      return {
        ...entry,
        hooks: remainingHooks,
      };
    })
    .filter(Boolean);
  merged.hooks.Stop = [...filteredEntries, ...adapterEntries];
  return merged;
}

function resolveCodexHooksTarget(rootDir, options = {}) {
  if (options.targetHooksFile && options.codexHome) {
    throw new Error(
      'codex-hook accepts either --target-hooks-file or --codex-home, not both',
    );
  }

  if (options.targetHooksFile) {
    return resolve(rootDir, options.targetHooksFile);
  }
  if (options.codexHome) {
    return resolve(rootDir, options.codexHome, 'hooks.json');
  }
  return null;
}

function codexHookAdapterCommand() {
  return buildSuggestedCodexHookConfig().hooks.Stop[0].hooks[0].command;
}

function formatTargetPath(rootDir, targetPath) {
  const relativeTargetPath = relative(rootDir, targetPath).replaceAll('\\', '/');
  return relativeTargetPath.startsWith('..')
    ? targetPath.replaceAll('\\', '/')
    : relativeTargetPath;
}

function inspectCodexHookTarget(rootDir, options = {}) {
  const resolvedTargetPath = resolveCodexHooksTarget(rootDir, options);
  if (!resolvedTargetPath) {
    return {
      resolvedTargetPath: null,
      checked: false,
      targetExists: false,
      adapterInstalled: false,
    };
  }

  const targetExists = existsSync(resolvedTargetPath);
  let adapterInstalled = false;
  if (targetExists) {
    try {
      const parsed = JSON.parse(readFileSync(resolvedTargetPath, 'utf8'));
      const stopEntries = Array.isArray(parsed?.hooks?.Stop) ? parsed.hooks.Stop : [];
      adapterInstalled = stopEntries.some((entry) => {
        const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
        return hooks.some((hook) => hook?.command === codexHookAdapterCommand());
      });
    } catch {
      adapterInstalled = false;
    }
  }

  return {
    resolvedTargetPath: formatTargetPath(rootDir, resolvedTargetPath),
    checked: true,
    targetExists,
    adapterInstalled,
  };
}

function isExecutable(path) {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function readGitConfigValue(rootDir, key) {
  try {
    return execFileSync('git', ['config', '--get', key], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

export function inspectRuntimeAdapterStatus(rootDir, options = {}) {
  const gitHookPath = resolve(rootDir, '.githooks/post-commit');
  const runtimeHookPath = resolve(rootDir, '.veritas/hooks/agent-runtime.sh');
  const codexArtifactPath = resolve(rootDir, '.veritas/runtime/codex-hooks.json');
  const configuredHooksPath = readGitConfigValue(rootDir, 'core.hooksPath');
  const codexTarget = inspectCodexHookTarget(rootDir, options);

  const status = {
    gitHook: {
      path: '.githooks/post-commit',
      exists: existsSync(gitHookPath),
      executable: isExecutable(gitHookPath),
      configuredHooksPath,
      configured: configuredHooksPath === '.githooks',
    },
    runtimeHook: {
      path: '.veritas/hooks/agent-runtime.sh',
      exists: existsSync(runtimeHookPath),
      executable: isExecutable(runtimeHookPath),
    },
    codexArtifact: {
      path: '.veritas/runtime/codex-hooks.json',
      exists: existsSync(codexArtifactPath),
    },
    codexTarget,
    nextCommands: [],
  };

  if (!status.gitHook.exists || !status.gitHook.configured) {
    status.nextCommands.push(
      `npm exec -- veritas apply git-hook --configure-git${status.gitHook.exists ? ' --force' : ''}`,
    );
  } else if (!status.gitHook.executable) {
    status.nextCommands.push('npm exec -- veritas apply git-hook --configure-git --force');
  }
  if (!status.runtimeHook.exists) {
    status.nextCommands.push('npm exec -- veritas apply runtime-hook');
  } else if (!status.runtimeHook.executable) {
    status.nextCommands.push('npm exec -- veritas apply runtime-hook --force');
  }
  if (!status.codexArtifact.exists) {
    status.nextCommands.push('npm exec -- veritas print codex-hook');
  }
  if (!codexTarget.checked) {
    status.nextCommands.push(
      'npm exec -- veritas print codex-hook --codex-home /path/to/.codex',
    );
  } else if (options.codexHome && !codexTarget.adapterInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas apply codex-hook --codex-home ${shellQuote(options.codexHome)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  } else if (options.targetHooksFile && !codexTarget.adapterInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas apply codex-hook --target-hooks-file ${shellQuote(options.targetHooksFile)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  }

  return status;
}

export function applyCodexHook({
  rootDir,
  outputPath = '.veritas/runtime/codex-hooks.json',
  force = false,
  targetHooksFile,
  codexHome,
}) {
  resolveCodexHooksTarget(rootDir, { targetHooksFile, codexHome });
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const relativeOutputPath = relative(rootDir, resolvedOutputPath).replaceAll('\\', '/');

  if (
    relativeOutputPath.startsWith('..') ||
    !relativeOutputPath.startsWith('.veritas/runtime/')
  ) {
    throw new Error(
      'apply codex-hook only supports writing inside .veritas/runtime/',
    );
  }

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  const adapterConfig = buildSuggestedCodexHookConfig();
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, `${JSON.stringify(adapterConfig, null, 2)}\n`, 'utf8');

  let mergedTargetPath = null;
  const resolvedTargetPath = resolveCodexHooksTarget(rootDir, {
    targetHooksFile,
    codexHome,
  });
  if (resolvedTargetPath) {
    const existingConfig = existsSync(resolvedTargetPath)
      ? JSON.parse(readFileSync(resolvedTargetPath, 'utf8'))
      : {};
    const mergedConfig = mergeCodexHooksConfig(existingConfig, adapterConfig);
    mkdirSync(dirname(resolvedTargetPath), { recursive: true });
    writeFileSync(resolvedTargetPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
    mergedTargetPath = formatTargetPath(rootDir, resolvedTargetPath);
  }

  return {
    rootDir,
    outputPath: relativeOutputPath,
    mergedTargetPath,
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
  outputPath = `.veritas/evals/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  if (
    relativeArtifactPath.startsWith('..') ||
    !relativeArtifactPath.startsWith('.veritas/evals/')
  ) {
    throw new Error(
      'eval artifacts may only be written inside .veritas/evals/',
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

export function writeEvalDraftArtifact(
  record,
  rootDir,
  outputPath = `.veritas/eval-drafts/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  if (
    relativeArtifactPath.startsWith('..') ||
    !relativeArtifactPath.startsWith('.veritas/eval-drafts/')
  ) {
    throw new Error(
      'eval drafts may only be written inside .veritas/eval-drafts/',
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
  const policyPassCount = record.policy_results.filter((result) => result.passed === true).length;
  const policyFailCount = record.policy_results.filter((result) => result.passed === false).length;
  const policyMetadataOnlyCount = record.policy_results.filter(
    (result) => result.passed === null,
  ).length;
  const lines = [
    '## Veritas Report',
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
    `- **Selected proof commands:** \`${record.selected_proof_commands.join(', ') || 'none'}\``,
    `- **Proof resolution source:** ${record.proof_resolution_source}`,
    `- **Uncovered path result:** ${record.uncovered_path_result}`,
    `- **Baseline \`ci:fast\` passed:** ${formatTriState(record.baseline_ci_fast_passed)}`,
    `- **Report transport:** ${record.adapter.report_transport}`,
    `- **Policy results:** ${policyPassCount} passed, ${policyFailCount} failed, ${policyMetadataOnlyCount} metadata-only`,
    `- **Artifact:** \`${artifactPath}\``,
  ];

  if (record.policy_results.length > 0) {
    lines.push('', '### Policy Results');
    for (const result of record.policy_results) {
      const status =
        result.passed === true ? 'pass' : result.passed === false ? 'fail' : 'metadata-only';
      lines.push(`- ${result.rule_id}: ${status} — ${result.summary}`);
      for (const finding of result.findings ?? []) {
        if (finding.artifact) {
          lines.push(`  - Artifact: ${finding.artifact}`);
        }
      }
    }
  }

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
    '## Veritas Eval',
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

export function buildEvalDraftMarkdownSummary(record, artifactPath, suggestedRecordCommand) {
  const lines = [
    '## Veritas Eval Draft',
    '',
    `- **Run ID:** ${record.run_id}`,
    `- **Mode:** ${record.mode}`,
    `- **Team profile:** ${record.team_profile_id}`,
    `- **Evidence artifact:** \`${record.evidence.artifact_path}\``,
    `- **Draft artifact:** \`${artifactPath}\``,
    `- **Missing confirmation fields:** ${record.missing_confirmation_fields.join(', ')}`,
    '',
    '### Next Step',
    '',
    `\`${suggestedRecordCommand}\``,
  ];

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
      continue;
    }
    if (token === '--hook') {
      options.hook = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--target-hooks-file') {
      options.targetHooksFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--codex-home') {
      options.codexHome = argv[index + 1];
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
    if (token === '--hook') {
      options.hook = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--force') {
      options.force = true;
      continue;
    }
    if (token === '--configure-git') {
      options.configureGit = true;
      continue;
    }
    if (token === '--target-hooks-file') {
      options.targetHooksFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--codex-home') {
      options.codexHome = argv[index + 1];
      index += 1;
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
    if (token === '--draft') {
      options.draftPath = argv[index + 1];
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

export function parseShadowArgs(argv) {
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
    if (token === '--team-profile') {
      options.teamProfilePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--run-id') {
      options.runId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--working-tree') {
      options.workingTree = true;
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
    if (token === '--proof-command') {
      options.proofCommand = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--skip-proof') {
      options.skipProof = true;
      continue;
    }
    if (token === '--baseline-ci-fast-status') {
      options.baselineCiFastStatus = argv[index + 1];
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
    }
  }

  return options;
}

function resolveVeritasPaths(options, defaults = {}) {
  const rootDir = options.rootDir ? resolve(options.rootDir) : defaults.rootDir;
  const defaultAdapterPath =
    defaults.adapterPath ??
    (rootDir ? resolve(rootDir, '.veritas/repo.adapter.json') : undefined);
  const defaultPolicyPackPath =
    defaults.policyPackPath ??
    (rootDir
      ? resolve(rootDir, '.veritas/policy-packs/default.policy-pack.json')
      : undefined);
  const defaultTeamProfilePath =
    defaults.teamProfilePath ??
    (rootDir ? resolve(rootDir, '.veritas/team/default.team-profile.json') : undefined);

  return {
    rootDir,
    adapterPath: options.adapterPath
      ? resolve(rootDir ?? process.cwd(), options.adapterPath)
      : defaultAdapterPath,
    policyPackPath: options.policyPackPath
      ? resolve(rootDir ?? process.cwd(), options.policyPackPath)
      : defaultPolicyPackPath,
    teamProfilePath: options.teamProfilePath
      ? resolve(rootDir ?? process.cwd(), options.teamProfilePath)
      : defaultTeamProfilePath,
  };
}

export function generateVeritasReport(options = {}, defaults = {}, explicitFiles = []) {
  const { rootDir, adapterPath, policyPackPath } = resolveVeritasPaths(options, defaults);

  if (!rootDir || !adapterPath || !policyPackPath) {
    throw new Error(
      'Veritas report requires rootDir, adapterPath, and policyPackPath',
    );
  }

  const reportInputs = resolveReportInputs(explicitFiles, options, rootDir);
  const files = reportInputs.files;

  if (files.length === 0 && reportInputs.sourceKind === 'explicit-files') {
    throw new Error('veritas report requires at least one file path');
  }

  const config = loadAdapterConfig(adapterPath);
  const policyPack = loadPolicyPack(policyPackPath);
  const proofPlan = resolveProofPlan({
    files,
    config,
    rootDir,
    explicitProofCommand: options.explicitProofCommand,
  });
  const record = buildEvidenceRecord({
    files,
    options: {
      ...options,
      sourceRef: reportInputs.sourceRef,
      sourceKind: reportInputs.sourceKind,
      sourceScope: reportInputs.sourceScope,
      proofPlan,
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

  return {
    rootDir,
    config,
    record,
    artifactPath: relativeArtifactPath,
    markdownSummary,
  };
}

export function generateEvalDraft(options = {}, defaults = {}) {
  const { rootDir, teamProfilePath } = resolveVeritasPaths(options, defaults);
  const evidencePath = options.evidencePath
    ? resolve(rootDir, options.evidencePath)
    : undefined;

  if (!rootDir || !teamProfilePath) {
    throw new Error('Veritas eval draft requires rootDir and teamProfilePath');
  }
  if (!evidencePath) {
    throw new Error('veritas eval draft requires --evidence <path>');
  }

  const evidenceRecord = loadEvidenceArtifact(evidencePath);
  const teamProfile = loadTeamProfile(teamProfilePath);
  const record = buildEvalDraft({
    evidenceRecord,
    evidencePath,
    teamProfile,
    options,
    rootDir,
  });
  const artifactPath = writeEvalDraftArtifact(
    record,
    rootDir,
    options.outputPath,
    options.force ?? false,
  );
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const suggestedRecordCommand = buildEvalRecordCommand(relativeArtifactPath, record);
  const markdownSummary = buildEvalDraftMarkdownSummary(
    record,
    relativeArtifactPath,
    suggestedRecordCommand,
  );

  return {
    rootDir,
    teamProfile,
    record,
    artifactPath: relativeArtifactPath,
    suggestedRecordCommand,
    markdownSummary,
  };
}

export function generateEvalRecord(options = {}, defaults = {}) {
  const { rootDir, teamProfilePath } = resolveVeritasPaths(options, defaults);
  if (!rootDir || !teamProfilePath) {
    throw new Error('Veritas eval record requires rootDir and teamProfilePath');
  }
  if (options.evidencePath && options.draftPath) {
    throw new Error('veritas eval record accepts either --evidence or --draft, not both');
  }
  if (!options.evidencePath && !options.draftPath) {
    throw new Error('veritas eval record requires --evidence <path> or --draft <path>');
  }

  const teamProfile = loadTeamProfile(teamProfilePath);
  const draft = options.draftPath
    ? loadEvalDraftArtifact(resolve(rootDir, options.draftPath))
    : null;
  if (draft) {
    validateEvalDraftContext({
      draftPath: resolve(rootDir, options.draftPath),
      draftRecord: draft,
      rootDir,
      teamProfile,
    });
  }
  const evidencePath = options.evidencePath
    ? resolve(rootDir, options.evidencePath)
    : resolve(rootDir, draft.evidence.artifact_path);
  const evidenceRecord = loadEvidenceArtifact(evidencePath);
  const record = buildEvalRecord({
    evidenceRecord,
    evidencePath,
    teamProfile,
    options: mergeEvalRecordOptions(options, draft),
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

  return {
    rootDir,
    teamProfile,
    record,
    artifactPath: relativeArtifactPath,
    markdownSummary,
  };
}

export function resolveProofCommands({ adapterPath, files = [], rootDir, explicitProofCommand }) {
  if (!adapterPath || !rootDir) {
    return {
      proofCommands: explicitProofCommand ? [explicitProofCommand] : [],
      resolutionSource: explicitProofCommand ? 'explicit' : 'none',
      affectedNodes: [],
      affectedLanes: [],
      unmatchedFiles: [],
      uncoveredPathPolicy: 'warn',
      uncoveredPathResult: 'clear',
    };
  }
  const config = loadAdapterConfig(adapterPath);
  return resolveProofPlan({
    files,
    config,
    rootDir,
    explicitProofCommand,
  });
}

function runProofCommand(command, rootDir) {
  const shell = process.env.SHELL ?? '/bin/sh';
  execFileSync(shell, ['-lc', `${command} 1>&2`], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function hasShadowOutcomeInputs(options) {
  return (
    typeof options.acceptedWithoutMajorRewrite === 'boolean' &&
    typeof options.requiredFollowup === 'boolean' &&
    typeof options.timeToGreenMinutes === 'number' &&
    !Number.isNaN(options.timeToGreenMinutes)
  );
}

export function runVeritasReportCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseArgs(argv);
  const result = generateVeritasReport(options, defaults, explicitFiles);

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        markdownSummary: result.markdownSummary,
        ...result.record,
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

export function runPrintGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const hook = options.hook ?? 'post-commit';

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        hook,
        hookBody: buildSuggestedGitHook({ hook }),
        suggestedHooksPath: '.githooks',
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        outputPath: '.veritas/hooks/agent-runtime.sh',
        hookBody: buildSuggestedRuntimeHook(),
        defaultInvocation: '.veritas/hooks/agent-runtime.sh',
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const targetStatus = inspectCodexHookTarget(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });
  const suggestedApplyCommand = options.codexHome
    ? `npm exec -- veritas apply codex-hook --codex-home ${shellQuote(options.codexHome)}`
    : options.targetHooksFile
      ? `npm exec -- veritas apply codex-hook --target-hooks-file ${shellQuote(options.targetHooksFile)}`
      : null;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        outputPath: '.veritas/runtime/codex-hooks.json',
        targetHooksFile: options.targetHooksFile ?? null,
        codexHome: options.codexHome ?? null,
        targetStatus,
        suggestedApplyCommand,
        hookConfig: buildSuggestedCodexHookConfig(),
      },
      null,
      2,
    )}\n`,
  );
}

export function runRuntimeStatusCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const status = inspectRuntimeAdapterStatus(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        ...status,
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
    outputPath: options.outputPath ?? '.veritas/snippets/ci-snippet.yml',
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

export function runApplyGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const hook = options.hook ?? 'post-commit';
  const result = applyGitHook({
    rootDir,
    hook,
    outputPath: options.outputPath ?? `.githooks/${hook}`,
    force: options.force ?? false,
    configureGit: options.configureGit ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyRuntimeHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/hooks/agent-runtime.sh',
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyCodexHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/runtime/codex-hooks.json',
    force: options.force ?? false,
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runEvalRecordCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalRecord(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runEvalDraftCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalDraft(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        suggestedRecordCommand: result.suggestedRecordCommand,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runShadowRunCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseShadowArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const { adapterPath } = resolveVeritasPaths(
    { ...options, rootDir },
    { ...defaults, rootDir },
  );
  const reportInputs = resolveReportInputs(
    [],
    {
      ...options,
      workingTree:
        options.workingTree || (!options.changedFrom && !options.changedTo),
    },
    rootDir,
  );
  const proofPlan = resolveProofCommands({
    adapterPath,
    files: reportInputs.files,
    rootDir,
    explicitProofCommand: options.proofCommand,
  });
  const proofCommands = proofPlan.proofCommands;
  if (!options.skipProof && proofCommands.length === 0) {
    throw new Error(
      'veritas shadow run requires a proof command or an adapter required proof lane',
    );
  }

  if (!options.skipProof) {
    for (const proofCommand of proofCommands) {
      runProofCommand(proofCommand, rootDir);
    }
  }

  const reportResult = generateVeritasReport(
    {
      ...options,
      rootDir,
      workingTree:
        options.workingTree || (!options.changedFrom && !options.changedTo),
      baselineCiFastStatus:
        options.baselineCiFastStatus ?? (options.skipProof ? undefined : 'success'),
      explicitProofCommand: options.proofCommand,
    },
    { ...defaults, rootDir },
  );
  if (reportResult.record.uncovered_path_result === 'fail') {
    throw new Error(
      'veritas shadow run encountered changed files outside configured surfaces and the uncovered-path policy is fail',
    );
  }
  const draftResult = generateEvalDraft(
    {
      ...options,
      rootDir,
      evidencePath: reportResult.artifactPath,
      force: options.force ?? false,
    },
    { ...defaults, rootDir },
  );

  if (!hasShadowOutcomeInputs(options)) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'report-and-draft',
          proofCommands: options.skipProof ? [] : proofCommands,
          proofResolutionSource: proofPlan.resolutionSource,
          proofRan: !options.skipProof,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          suggestedEvalCommand: draftResult.suggestedRecordCommand,
          message:
            'Proof, report, and eval draft completed. The final judgment fields still need confirmation.',
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const evalResult = generateEvalRecord(
    {
      ...options,
      rootDir,
      draftPath: draftResult.artifactPath,
      force: options.force ?? false,
    },
    { ...defaults, rootDir },
  );

  process.stdout.write(
    `${JSON.stringify(
        {
          mode: 'report-draft-and-eval',
          proofCommands: options.skipProof ? [] : proofCommands,
          proofResolutionSource: proofPlan.resolutionSource,
          proofRan: !options.skipProof,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          evalArtifactPath: evalResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          evalMode: evalResult.record.mode,
        },
      null,
      2,
    )}\n`,
  );
}
