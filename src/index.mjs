import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export function loadAdapterConfig(configPath) {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function loadPolicyPack(policyPackPath) {
  return JSON.parse(readFileSync(policyPackPath, 'utf8'));
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
    return {
      resolvedPhase: options.phase ?? config.graph.activePhase,
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

export function writeEvidenceArtifact(record, config, rootDir) {
  const artifactDir = resolve(rootDir, config.evidence.artifactDir);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = resolve(artifactDir, `${record.run_id}.json`);
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

export function buildMarkdownSummary(record, artifactPath) {
  const lines = [
    '## Guidance Report',
    '',
    `- **Adapter:** ${record.adapter.name} (${record.adapter.kind})`,
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
    if (token === '--summary-path') {
      options.summaryPath = argv[index + 1];
      index += 1;
      continue;
    }
    files.push(token);
  }

  return { options, files };
}

export function runGuidanceReportCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseArgs(argv);
  const rootDir = options.rootDir ? resolve(options.rootDir) : defaults.rootDir;
  const adapterPath = options.adapterPath
    ? resolve(options.adapterPath)
    : defaults.adapterPath;
  const policyPackPath = options.policyPackPath
    ? resolve(options.policyPackPath)
    : defaults.policyPackPath;

  if (!rootDir || !adapterPath || !policyPackPath) {
    throw new Error(
      'Guidance report requires rootDir, adapterPath, and policyPackPath',
    );
  }

  const files =
    explicitFiles.length > 0
      ? explicitFiles
      : listChangedFiles(options.changedFrom, options.changedTo, rootDir);

  if (files.length === 0) {
    throw new Error('guidance-report requires at least one file path');
  }

  const config = loadAdapterConfig(adapterPath);
  const policyPack = loadPolicyPack(policyPackPath);
  const record = buildEvidenceRecord({
    files,
    options,
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
