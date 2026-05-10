import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAdapterConfig, loadPolicyPack } from './load.mjs';
import { assertWithinDir, normalizeRepoPath, relativeRepoPath } from './paths.mjs';
import { resolveGitHead, stagedDiffSha256 } from './shell.mjs';
import { classifyNodes } from './repo/classify.mjs';
import { matchesPatternsForAnyFile } from './util/patterns.mjs';
import { uniqueStrings } from './util/strings.mjs';
import { evaluatePolicyPack } from './rules/evaluate.mjs';
import {
  buildSurfaceTrustInput,
  buildSurfaceTrustReportSummary,
  validateSurfaceTrustInputAtBoundary,
} from './surface/projection.mjs';
import {
  buildAttestationPolicyResult,
  inspectAttestationStatus,
} from './attestations.mjs';
import {
  readSurfaceProofRoutes,
  readProofLanes,
  readDefaultProofLaneIds,
  readRequiredProofLaneIds,
  proofCommandsForLaneIds,
  proofLaneRecordsForCommands,
  loadProofFamilyResults,
  buildVerificationBudget,
  buildExternalToolResults,
  readUncoveredPathPolicy,
  routeMatchesAnyNode,
  serializeSurfaceProofRoutes,
} from './proof/index.mjs';
import {
  buildMarkdownSummary,
  feedbackStatusForPolicyResult,
  buildFeedbackSummary,
  feedbackHasFailures,
  buildEvalMarkdownSummary,
  buildEvalDraftMarkdownSummary,
} from './report/format.mjs';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveSourceRef({ explicitSourceRef, rootDir, sourceKind = 'explicit-files' } = {}) {
  if (explicitSourceRef) return explicitSourceRef;
  const head = rootDir ? resolveGitHead(rootDir) : null;
  if (head && sourceKind !== 'working-tree') return head;
  const hash = rootDir ? stagedDiffSha256(rootDir) : sha256Hex('');
  return `working-tree:${hash}`;
}

export function resolveProofPlan({
  files,
  config,
  rootDir,
  explicitProofCommand,
}) {
  const {
    affectedNodes,
    affectedLanes,
    unmatchedFiles,
    matchedNodes,
    fileNodes,
  } = classifyNodes(files, config, rootDir);
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
    proofCommands = proofCommandsForLaneIds(config, uniqueStrings(matchedRoutes.flatMap((route) => route.proofLaneIds ?? [])));
    if (affectedNodes.some((nodeId) => !routedNodeIds.has(nodeId))) {
      const defaultProofLaneIds = readDefaultProofLaneIds(config);
      const requiredProofLaneIds = readRequiredProofLaneIds(config);
      proofCommands = uniqueStrings([
        ...proofCommands,
        ...proofCommandsForLaneIds(config, defaultProofLaneIds.length > 0 ? defaultProofLaneIds : requiredProofLaneIds),
      ]);
    }
    resolutionSource = 'surface';
  } else {
    const defaultProofLaneIds = readDefaultProofLaneIds(config);
    const requiredProofLaneIds = readRequiredProofLaneIds(config);

    if (defaultProofLaneIds.length > 0) {
      proofCommands = proofCommandsForLaneIds(config, defaultProofLaneIds);
      resolutionSource = 'default';
    } else if (requiredProofLaneIds.length > 0) {
      proofCommands = proofCommandsForLaneIds(config, requiredProofLaneIds);
      resolutionSource = 'required';
    }
  }

  return {
    affectedNodes,
    affectedLanes,
    matchedNodes,
    fileNodes,
    unmatchedFiles,
    uncoveredPathPolicy,
    uncoveredPathResult: unmatchedFiles.length > 0 ? uncoveredPathPolicy : 'clear',
    proofCommands,
    proofLanes: proofLaneRecordsForCommands(config, proofCommands),
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
  const { affectedNodes, affectedLanes, unmatchedFiles, matchedNodes, fileNodes } = proofPlan;
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
    options.policyResults ??
    evaluatePolicyPack(resolvedPolicyPack, {
      rootDir,
      changedFiles: normalizedFiles,
      config,
      actor: options.actor,
    });
  const selectedProofLaneSources =
    proofPlan.proofLanes ?? proofLaneRecordsForCommands(config, proofPlan.proofCommands);
  const selectedProofLanes = selectedProofLaneSources.map((lane) => ({
    id: lane.id,
    command: lane.command,
    method: lane.method,
    surface_claim_ids: uniqueStrings(lane.surfaceClaimIds ?? []),
    summary: lane.summary ?? `Proof lane ${lane.id}: ${lane.command}`,
  }));
  const selectedProofLaneIds = selectedProofLanes.map((lane) => lane.id);
  const proofFamilyResults = loadProofFamilyResults(config, rootDir, selectedProofLaneIds);
  const allProofLanes = readProofLanes(config).map((lane) => ({
    id: lane.id,
    command: lane.command,
    method: lane.method,
    surface_claim_ids: uniqueStrings(lane.surfaceClaimIds ?? []),
    summary: lane.summary ?? '',
    selected: selectedProofLaneIds.includes(lane.id),
  }));

  const record = {
    framework_version: frameworkVersion,
    run_id: runId,
    timestamp,
    source_ref: resolveSourceRef({
      explicitSourceRef: options.sourceRef,
      rootDir,
      sourceKind: options.sourceKind,
    }),
    source_kind: options.sourceKind ?? 'explicit-files',
    source_scope: options.sourceScope ?? ['explicit'],
    resolved_phase: resolution.resolvedPhase,
    resolved_workstream: resolution.resolvedWorkstream,
    matched_artifacts: resolution.matchedArtifacts,
    affected_nodes: affectedNodes,
    affected_node_details: matchedNodes ?? [],
    file_nodes: fileNodes ?? {},
    affected_lanes: affectedLanes,
    selected_proof_commands: proofPlan.proofCommands,
    selected_proof_lanes: selectedProofLanes,
    proof_resolution_source: proofPlan.resolutionSource,
    proof_family_results: proofFamilyResults,
    verification_budget: buildVerificationBudget({
      proofLanes: allProofLanes,
      proofFamilyResults,
    }),
    external_tool_results: buildExternalToolResults({
      proofLanes: selectedProofLaneSources,
      rootDir,
    }),
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
      proof_lanes: allProofLanes.map(({ selected, ...lane }) => lane),
      required_proof_lane_ids: readRequiredProofLaneIds(config),
      default_proof_lane_ids: readDefaultProofLaneIds(config),
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
  const surfaceInput = buildSurfaceTrustInput(record, { rootDir });
  const validatedSurfaceInput = validateSurfaceTrustInputAtBoundary({ input: surfaceInput, record, rootDir });
  return {
    ...record,
    surface: {
      input: validatedSurfaceInput,
      report: buildSurfaceTrustReportSummary({ input: validatedSurfaceInput, record }),
    },
  };
}

export function mergeEvalRecordOptions(options, draft) {
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
      (typeof draft?.prefilled_measurements?.time_to_green_minutes === 'number'
        ? draft.prefilled_measurements.time_to_green_minutes
        : undefined),
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

// bootstrap/install domains live in dedicated modules

// hook/install runtime lives in dedicated modules

export function writeEvidenceArtifact(record, config, rootDir) {
  const artifactDir = resolve(rootDir, config.evidence.artifactDir);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = resolve(artifactDir, `${record.run_id}.json`);
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

function safeClaimFilename(claimId) {
  return `${claimId.replace(/[^A-Za-z0-9._-]+/g, '-')}.input.json`;
}

function buildSingleClaimInput(input, claim) {
  const evidenceForClaim = input.evidence.filter((item) => item.claimId === claim.id);
  const eventsForClaim = input.events.filter((item) => item.claimId === claim.id);
  return {
    schemaVersion: input.schemaVersion,
    source: input.source,
    generatedAt: new Date().toISOString(),
    claim,
    evidence: evidenceForClaim,
    events: eventsForClaim,
    policy: input.policies.find((policy) => policy.id === claim.verificationPolicyId) ?? null,
  };
}

export function writeSurfaceClaimInputs(record, rootDir) {
  const input = record.surface?.input;
  if (!input?.claims?.length) return [];
  const claimsDir = resolve(rootDir, '.veritas/claims');
  mkdirSync(claimsDir, { recursive: true });
  const written = [];
  for (const claim of input.claims) {
    const path = resolve(claimsDir, safeClaimFilename(claim.id));
    writeFileSync(path, `${JSON.stringify(buildSingleClaimInput(input, claim), null, 2)}\n`, 'utf8');
    written.push(relativeRepoPath(rootDir, path));
  }
  return written;
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
      sourceRef: resolveSourceRef({
        explicitSourceRef: options.sourceRef,
        rootDir,
        sourceKind: 'explicit-files',
      }),
    };
  }

  if (options.changedFrom || options.changedTo) {
    if (!options.changedFrom || !options.changedTo) {
      throw new Error(
        'branch-diff reporting requires both --changed-from and --changed-to',
      );
    }
    const sourceRef = options.sourceRef ?? `${options.changedFrom}..${options.changedTo}`;
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
      sourceRef: resolveSourceRef({
        explicitSourceRef: options.sourceRef,
        rootDir,
        sourceKind: 'working-tree',
      }),
    };
  }

  return {
    files: [],
    sourceKind: 'explicit-files',
    sourceScope: ['explicit'],
    sourceRef: resolveSourceRef({
      explicitSourceRef: options.sourceRef,
      rootDir,
      sourceKind: 'explicit-files',
    }),
  };
}

export function resolveVeritasPaths(options, defaults = {}) {
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
  const { rootDir, adapterPath, policyPackPath, teamProfilePath } = resolveVeritasPaths(options, defaults);

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
  if (options.includeAttestationGate) {
    const attestationStatus = inspectAttestationStatus(rootDir, {
      policyPackPath,
      adapterPath,
      teamProfilePath,
    });
    record.attestation = attestationStatus;
    record.policy_results = [
      buildAttestationPolicyResult(attestationStatus),
      ...record.policy_results,
    ];
  }
  const artifactPath = writeEvidenceArtifact(record, config, rootDir);
  const claimInputPaths = writeSurfaceClaimInputs(record, rootDir);
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
    claimInputPaths,
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

export {
  buildMarkdownSummary,
  feedbackStatusForPolicyResult,
  buildFeedbackSummary,
  feedbackHasFailures,
  buildEvalMarkdownSummary,
  buildEvalDraftMarkdownSummary,
};
