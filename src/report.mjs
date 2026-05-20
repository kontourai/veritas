import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
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
  throwSurfaceTrustInputValidationError,
  validateSurfaceTrustInputAtBoundary,
} from './surface/projection.mjs';
import {
  writeSurfaceDashboardReadModel,
} from './surface/dashboard.mjs';
import {
  buildAttestationPolicyResult,
  inspectAttestationStatus,
} from './attestations.mjs';
import {
  readProofRoutes,
  readProofs,
  readDefaultProofIds,
  readRequiredProofIds,
  proofsByIds,
  proofLabel,
  proofRecordsForCommands,
  loadProofSuiteResults,
  buildVerificationBudget,
  buildExternalToolResults,
  readUncoveredPathPolicy,
  routeMatchesAnyComponent,
  serializeProofRoutes,
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

function sha256Ref(value) {
  return `sha256:${sha256Hex(value)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fileIntegrityRef(rootDir, repoPath) {
  const path = normalizeRepoPath(repoPath, rootDir);
  const absolutePath = resolve(rootDir, path);
  try {
    assertWithinDir(absolutePath, rootDir, `Cannot hash file outside repo: ${repoPath}`);
    if (!existsSync(absolutePath)) return { path, status: 'missing' };
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return { path, status: stat.isDirectory() ? 'directory' : 'non-file' };
    return {
      path,
      hash: sha256Ref(readFileSync(absolutePath)),
      sizeBytes: stat.size,
    };
  } catch (error) {
    return {
      path,
      status: 'unreadable',
      error: error.message,
    };
  }
}

function configIntegrityRef({ name, value, path, rootDir }) {
  const ref = { name };
  if (path && rootDir) ref.path = relativeRepoPath(rootDir, path);
  try {
    if (path && existsSync(path)) {
      ref.hash = sha256Ref(readFileSync(path));
      return ref;
    }
  } catch (error) {
    ref.status = 'unreadable';
    ref.error = error.message;
  }
  ref.hash = sha256Ref(stableStringify(value ?? null));
  return ref;
}

function buildEvidenceIntegrity({
  rootDir,
  normalizedFiles,
  sourceRef,
  sourceKind,
  sourceScope,
  config,
  policyPack,
  options,
}) {
  const sources = options.integritySources ?? {};
  return {
    sourceRef,
    sourceKind,
    sourceScope,
    fileRefs: rootDir
      ? normalizedFiles.map((file) => fileIntegrityRef(rootDir, file))
      : normalizedFiles.map((file) => ({ path: file, status: 'not-hashed' })),
    configRefs: {
      adapter: configIntegrityRef({
        name: config.name ?? config.adapter?.name ?? 'adapter',
        value: config,
        path: sources.adapterPath,
        rootDir,
      }),
      policyPack: configIntegrityRef({
        name: policyPack.name ?? 'policy-pack',
        value: policyPack,
        path: sources.policyPackPath,
        rootDir,
      }),
      ...(sources.teamProfilePath ? {
        teamProfile: configIntegrityRef({
          name: 'team-profile',
          value: null,
          path: sources.teamProfilePath,
          rootDir,
        }),
      } : {}),
    },
  };
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
  const proofRoutes = readProofRoutes(config);
  const matchedRoutes = proofRoutes.filter((route) => routeMatchesAnyComponent(route, affectedNodes));
  let proofs = [];
  let resolutionSource = 'none';

  if (explicitProofCommand) {
    proofs = proofRecordsForCommands(config, [explicitProofCommand]);
    resolutionSource = 'explicit';
  } else if (matchedRoutes.length > 0) {
    const routedComponentIds = new Set(
      matchedRoutes.flatMap((route) => (route.componentIds ?? []).filter((componentId) => affectedNodes.includes(componentId))),
    );
    proofs = proofsByIds(config, uniqueStrings(matchedRoutes.flatMap((route) => route.proofIds ?? [])));
    if (affectedNodes.some((nodeId) => !routedComponentIds.has(nodeId))) {
      const defaultProofIds = readDefaultProofIds(config);
      const requiredProofIds = readRequiredProofIds(config);
      const fallbackProofs = proofsByIds(config, defaultProofIds.length > 0 ? defaultProofIds : requiredProofIds);
      const seenProofIds = new Set(proofs.map((proof) => proof.id));
      proofs = [...proofs, ...fallbackProofs.filter((proof) => !seenProofIds.has(proof.id))];
    }
    resolutionSource = 'surface';
  } else {
    const defaultProofIds = readDefaultProofIds(config);
    const requiredProofIds = readRequiredProofIds(config);

    if (defaultProofIds.length > 0) {
      proofs = proofsByIds(config, defaultProofIds);
      resolutionSource = 'default';
    } else if (requiredProofIds.length > 0) {
      proofs = proofsByIds(config, requiredProofIds);
      resolutionSource = 'required';
    }
  }
  const proofCommands = proofs.flatMap((proof) => (proof.runner ?? 'bash') === 'mcp' ? [] : [proof.command]);

  return {
    affectedNodes,
    affectedLanes,
    matchedNodes,
    fileNodes,
    unmatchedFiles,
    uncoveredPathPolicy,
    uncoveredPathResult: unmatchedFiles.length > 0 ? uncoveredPathPolicy : 'clear',
    proofCommands,
    proofs,
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

function proofResultById(proofResults, id) {
  return (proofResults ?? []).find((result) => result.id === id) ?? null;
}

function proofResultSummary(result) {
  if (!result) return null;
  if (result.passed) return 'All proof checks passed.';
  if (result.runner === 'mcp') {
    const text = result.content?.find((content) => content.type === 'text')?.text;
    return text
      ? `MCP tool error: ${text.split('\n')[0]}`
      : 'MCP tool returned an error.';
  }
  const status = result.exitCode !== null && result.exitCode !== undefined
    ? `exit code ${result.exitCode}`
    : `signal ${result.signal ?? 'unknown'}`;
  const firstOutputLine = String(result.stderr || result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstOutputLine
    ? `Proof checks failed with ${status}: ${firstOutputLine}`
    : `Proof checks failed with ${status}.`;
}

export async function buildEvidenceRecord({
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
  const governanceState = options.governanceState ?? options.attestationStatus;
  const resolvedPolicyResults = governanceState
    ? [
        buildAttestationPolicyResult(governanceState),
        ...policyResults,
      ]
    : policyResults;
  const selectedProofSources =
    proofPlan.proofs ?? proofRecordsForCommands(config, proofPlan.proofCommands);
  const selectedProofs = selectedProofSources.map((proof) => {
    const label = proofLabel(proof);
    const runner = proof.runner ?? 'bash';
    const proofResult = proofResultById(options.proofResults, proof.id);
    return {
      id: proof.id,
      runner,
      label,
      ...(proof.command ? { command: proof.command } : {}),
      method: proof.method,
      surface_claim_ids: uniqueStrings(proof.surfaceClaimIds ?? []),
      summary: proofResultSummary(proofResult) ?? proof.summary ?? `Proof ${proof.id}: ${label}`,
      ...(proofResult ? { proof_result: proofResult } : {}),
    };
  });
  const selectedProofIds = selectedProofs.map((proof) => proof.id);
  const proofSuiteResults = loadProofSuiteResults(config, rootDir, selectedProofIds);
  const allProofs = readProofs(config).map((proof) => ({
    id: proof.id,
    runner: proof.runner ?? 'bash',
    label: proofLabel(proof),
    ...(proof.command ? { command: proof.command } : {}),
    method: proof.method,
    surface_claim_ids: uniqueStrings(proof.surfaceClaimIds ?? []),
    summary: proof.summary ?? '',
    selected: selectedProofIds.includes(proof.id),
  }));
  const sourceRef = resolveSourceRef({
    explicitSourceRef: options.sourceRef,
    rootDir,
    sourceKind: options.sourceKind,
  });
  const sourceKind = options.sourceKind ?? 'explicit-files';
  const sourceScope = options.sourceScope ?? ['explicit'];
  const integrity = buildEvidenceIntegrity({
    rootDir,
    normalizedFiles,
    sourceRef,
    sourceKind,
    sourceScope,
    config,
    policyPack: resolvedPolicyPack,
    options,
  });

  const record = {
    framework_version: frameworkVersion,
    run_id: runId,
    timestamp,
    source_ref: sourceRef,
    source_kind: sourceKind,
    source_scope: sourceScope,
    integrity,
    resolved_phase: resolution.resolvedPhase,
    resolved_workstream: resolution.resolvedWorkstream,
    matched_artifacts: resolution.matchedArtifacts,
    components: affectedNodes,
    component_details: matchedNodes ?? [],
    file_nodes: fileNodes ?? {},
    triggered_proofs: affectedLanes,
    selected_proof_ids: selectedProofIds,
    selected_proof_labels: selectedProofs.map((proof) => proof.label),
    selected_proofs: selectedProofs,
    proof_resolution_source: proofPlan.resolutionSource,
    proof_suite_results: proofSuiteResults,
    verification_budget: buildVerificationBudget({
      proofs: allProofs,
      proofSuiteResults,
    }),
    external_tool_results: buildExternalToolResults({
      proofs: selectedProofSources,
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
      proofs: allProofs.map(({ selected, ...proof }) => proof),
      required_proof_ids: readRequiredProofIds(config),
      default_proof_ids: readDefaultProofIds(config),
      proof_routes: serializeProofRoutes(config),
      uncovered_path_policy: proofPlan.uncoveredPathPolicy,
    },
    policy_pack: {
      name: resolvedPolicyPack.name,
      version: resolvedPolicyPack.version,
      rule_count: resolvedPolicyPack.rules.length,
    },
    policy_results: resolvedPolicyResults,
    ...(governanceState ? { governance_state: governanceState } : {}),
  };
  const surfaceInput = await buildSurfaceTrustInput(record, { rootDir, adapterConfig: config });
  const validatedSurfaceInput = validateSurfaceTrustInputAtBoundary({ input: surfaceInput, record, rootDir });
  let surfaceReport;
  try {
    surfaceReport = buildSurfaceTrustReportSummary({ input: validatedSurfaceInput, record });
  } catch (error) {
    throwSurfaceTrustInputValidationError({ error, input: validatedSurfaceInput, record, rootDir });
  }
  return {
    ...record,
    surface: {
      input: validatedSurfaceInput,
      report: surfaceReport,
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

export async function generateVeritasReport(options = {}, defaults = {}, explicitFiles = []) {
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
  const attestationStatus = options.includeAttestationGate
    ? inspectAttestationStatus(rootDir, {
        policyPackPath,
        adapterPath,
        teamProfilePath,
        now: options.attestationNow ?? options.timestamp,
      })
    : null;
  const record = await buildEvidenceRecord({
    files,
    options: {
      ...options,
      sourceRef: reportInputs.sourceRef,
      sourceKind: reportInputs.sourceKind,
      sourceScope: reportInputs.sourceScope,
      proofPlan,
      integritySources: {
        adapterPath,
        policyPackPath,
        teamProfilePath,
      },
      ...(attestationStatus ? { governanceState: attestationStatus } : {}),
    },
    config,
    policyPack,
    rootDir,
  });
  const artifactPath = writeEvidenceArtifact(record, config, rootDir);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const claimInputPaths = writeSurfaceClaimInputs(record, rootDir);
  const dashboardReadModelPath = writeSurfaceDashboardReadModel(record, rootDir, {
    evidenceArtifactPath: relativeArtifactPath,
    claimInputPaths,
  });
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
    dashboardReadModelPath,
    markdownSummary,
  };
}

export function resolveProofCommands({ adapterPath, files = [], rootDir, explicitProofCommand }) {
  if (!adapterPath || !rootDir) {
    return {
      proofCommands: explicitProofCommand ? [explicitProofCommand] : [],
      proofs: explicitProofCommand ? proofRecordsForCommands({ evidence: { proofs: [{ id: 'explicit-proof', runner: 'bash', command: explicitProofCommand, method: 'validation' }] } }, [explicitProofCommand]) : [],
      resolutionSource: explicitProofCommand ? 'explicit' : 'none',
      affectedNodes: [],
      affectedLanes: [],
      triggeredProofs: [],
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
