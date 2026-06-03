import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { generateStandardsFeedbackSummary } from '../standards-feedback/records.mjs';
import { inspectRuntimeIntegrationStatus } from '../integrations/runtime-integrations.mjs';
import { runMergeReadiness } from '../readiness/run.mjs';

const governanceRoots = ['.veritas/repo-map.json', '.veritas/repo-standards', '.veritas/authority'];
const REPO_HOOKS_SETUP_COMMAND = 'npm exec -- veritas setup repo-hooks';
const REPO_HOOKS_REPAIR_COMMAND = 'npm exec -- veritas setup repo-hooks --force';

export function summarizePolicyResults(policyResults) {
  return {
    passed: policyResults.filter((result) => result.passed === true).length,
    failed: policyResults.filter((result) => result.passed === false).length,
    metadata_only: policyResults.filter((result) => result.passed === null).length,
  };
}

export function buildConformanceAlerts(report, runtimeStatus, isCi) {
  const alerts = [];

  if (report.record.policy_results.some((result) => result.passed === false)) {
    alerts.push({
      severity: 'error',
      code: 'policy-failed',
      message: 'One or more evaluated requirements failed.',
    });
  }
  if (report.record.unresolved_files.length > 0) {
    alerts.push({
      severity: 'error',
      code: 'unresolved-files',
      message: `The report still has ${report.record.unresolved_files.length} unresolved file(s).`,
    });
  }
  if (!runtimeStatus.gitHook.exists) {
    alerts.push({
      severity: 'error',
      code: 'missing-git-hook',
      message: 'The tracked post-commit hook is missing.',
      nextCommand: REPO_HOOKS_SETUP_COMMAND,
    });
  } else if (!runtimeStatus.gitHook.executable) {
    alerts.push({
      severity: 'error',
      code: 'git-hook-not-executable',
      message: 'The tracked post-commit hook exists but is not executable.',
      nextCommand: REPO_HOOKS_REPAIR_COMMAND,
    });
  } else if (!runtimeStatus.gitHook.configured && !isCi) {
    alerts.push({
      severity: 'warning',
      code: 'git-hook-not-configured',
      message: 'The tracked post-commit hook is present, but git is not configured to use .githooks.',
      nextCommand: REPO_HOOKS_SETUP_COMMAND,
    });
  }
  if (!runtimeStatus.prePushHook?.exists) {
    alerts.push({
      severity: 'error',
      code: 'missing-pre-push-hook',
      message: 'The tracked pre-push hook is missing.',
      nextCommand: REPO_HOOKS_SETUP_COMMAND,
    });
  } else if (!runtimeStatus.prePushHook.executable) {
    alerts.push({
      severity: 'error',
      code: 'pre-push-hook-not-executable',
      message: 'The tracked pre-push hook exists but is not executable.',
      nextCommand: REPO_HOOKS_REPAIR_COMMAND,
    });
  } else if (!runtimeStatus.prePushHook.configured && !isCi) {
    alerts.push({
      severity: 'warning',
      code: 'pre-push-hook-not-configured',
      message: 'The tracked pre-push hook is present, but git is not configured to use .githooks.',
      nextCommand: REPO_HOOKS_SETUP_COMMAND,
    });
  }
  if (!runtimeStatus.runtimeHook.exists) {
    alerts.push({
      severity: 'error',
      code: 'missing-runtime-hook',
      message: 'The tracked runtime hook is missing.',
    });
  } else if (!runtimeStatus.runtimeHook.executable) {
    alerts.push({
      severity: 'error',
      code: 'runtime-hook-not-executable',
      message: 'The tracked runtime hook exists but is not executable.',
    });
  }
  if (!runtimeStatus.codexArtifact.exists) {
    alerts.push({
      severity: 'error',
      code: 'missing-codex-artifact',
      message: 'The tracked Codex hook artifact is missing.',
    });
  } else if (!runtimeStatus.codexTarget.checked && !isCi) {
    alerts.push({
      severity: 'warning',
      code: 'codex-target-not-checked',
      message: 'No Codex home or hooks target was checked for installation status.',
    });
  } else if (runtimeStatus.codexTarget.checked && !runtimeStatus.codexTarget.integrationInstalled) {
    alerts.push({
      severity: 'warning',
      code: 'codex-runtime-integration-not-installed',
      message: 'A Codex target was checked, but the Veritas runtime integration is not installed there.',
    });
  }

  return alerts;
}

export function summarizeHealth(alerts) {
  if (alerts.some((alert) => alert.severity === 'error')) {
    return 'red';
  }
  if (alerts.some((alert) => alert.severity === 'warning')) {
    return 'yellow';
  }
  return 'green';
}

export function healthLabel(healthStatus) {
  if (healthStatus === 'green') return 'Green';
  if (healthStatus === 'yellow') return 'Yellow';
  return 'Red';
}

export function summarizeAlertCounts(alerts) {
  return {
    errors: alerts.filter((alert) => alert.severity === 'error').length,
    warnings: alerts.filter((alert) => alert.severity === 'warning').length,
  };
}

export function selectedEvidenceCheckLabels(record) {
  if (Array.isArray(record.selected_evidence_check_labels)) {
    return record.selected_evidence_check_labels;
  }
  if (Array.isArray(record.selected_evidence_check_commands)) {
    return record.selected_evidence_check_commands;
  }
  return (record.selected_evidence_checks ?? []).map(
    (evidenceCheck) => evidenceCheck.label ?? evidenceCheck.command ?? evidenceCheck.id,
  ).filter(Boolean);
}

export function affectedNodeIds(record) {
  if (Array.isArray(record.affected_nodes)) {
    return record.affected_nodes;
  }
  if (Array.isArray(record.file_nodes)) {
    return record.file_nodes;
  }
  if (record.file_nodes && typeof record.file_nodes === 'object') {
    return Object.keys(record.file_nodes).sort();
  }
  return [];
}

export function affectedEvidenceCheckLabels(record) {
  if (Array.isArray(record.affected_evidence_checks)) {
    return record.affected_evidence_checks;
  }
  return record.triggered_evidence_checks ?? [];
}

function git(rootDir, args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isGovernancePath(filePath) {
  return (
    filePath === '.veritas/repo-map.json' ||
    (filePath.startsWith('.veritas/repo-standards/') && filePath.endsWith('.json')) ||
    (filePath.startsWith('.veritas/authority/') && filePath.endsWith('.json'))
  );
}

function readGovernanceJsonAtRef(rootDir, ref, filePath) {
  try {
    return {
      exists: true,
      value: JSON.parse(git(rootDir, ['show', `${ref}:${filePath}`])),
    };
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
    if (
      detail.includes('exists on disk, but not in') ||
      detail.includes('does not exist in') ||
      detail.includes('Path \'.') ||
      detail.includes('Path ".')
    ) {
      return {
        exists: false,
        value: null,
      };
    }
    throw error;
  }
}

function listGovernancePathsAtRef(rootDir, ref) {
  try {
    return git(rootDir, ['ls-tree', '-r', '--name-only', ref, '--', ...governanceRoots])
      .split(/\r?\n/u)
      .map((filePath) => filePath.trim())
      .filter(Boolean)
      .filter(isGovernancePath)
      .sort();
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
    if (
      detail.includes('Not a valid object name') ||
      detail.includes('fatal: Not a valid object name')
    ) {
      return [];
    }
    throw error;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAdditiveJsonChange(baseValue, headValue) {
  if (Array.isArray(baseValue) || Array.isArray(headValue)) {
    if (!Array.isArray(baseValue) || !Array.isArray(headValue)) {
      return false;
    }
    if (headValue.length < baseValue.length) {
      return false;
    }
    for (let index = 0; index < baseValue.length; index += 1) {
      if (!isAdditiveJsonChange(baseValue[index], headValue[index])) {
        return false;
      }
    }
    return true;
  }

  if (isPlainObject(baseValue) || isPlainObject(headValue)) {
    if (!isPlainObject(baseValue) || !isPlainObject(headValue)) {
      return false;
    }
    for (const key of Object.keys(baseValue)) {
      if (!(key in headValue)) {
        return false;
      }
      if (!isAdditiveJsonChange(baseValue[key], headValue[key])) {
        return false;
      }
    }
    return true;
  }

  return isDeepStrictEqual(baseValue, headValue);
}

function describeGovernanceAssessment(assessment) {
  if (assessment.status === 'added') {
    return `${assessment.path} added`;
  }
  if (assessment.status === 'removed') {
    return `${assessment.path} removed`;
  }
  if (assessment.status === 'modified-additive') {
    return `${assessment.path} extended`;
  }
  if (assessment.status === 'equivalent') {
    return `${assessment.path} reformatted`;
  }
  return `${assessment.path} modified`;
}

function formatGovernanceSummary(classification, semanticAssessments, changedFiles, evaluated) {
  if (!evaluated) {
    return 'clean (no PR base/head diff)';
  }
  if (classification === 'clean') {
    return changedFiles.length > 0
      ? 'clean (no semantic governance changes)'
      : 'clean (no governance files changed)';
  }

  const descriptions = semanticAssessments.map(describeGovernanceAssessment);
  const preview = descriptions.slice(0, 2).join('; ');
  const remaining = descriptions.length - 2;
  const suffix = remaining > 0 ? `; +${remaining} more` : '';
  return `${classification} (${preview}${suffix})`;
}

function buildGovernanceTrendSummary(entries) {
  if (entries.length === 0) {
    return {
      available_runs: 0,
      sampled_runs: 0,
      clean: 0,
      additive_only: 0,
      protected_standards_modification: 0,
      latest_non_clean_run_id: null,
      latest_non_clean_classification: null,
      summary: 'no prior governance history',
    };
  }

  const counts = {
    clean: entries.filter((entry) => entry.classification === 'clean').length,
    additive_only: entries.filter((entry) => entry.classification === 'additive-only').length,
    protected_standards_modification: entries.filter(
      (entry) => entry.classification === 'protected-standards-modification',
    ).length,
  };
  const latestNonClean = [...entries]
    .reverse()
    .find((entry) => entry.classification !== 'clean');

  const summary = `last ${entries.length} governance run(s): ${counts.clean} clean, ${counts.additive_only} additive-only, ${counts.protected_standards_modification} protected-standards-modification`;

  return {
    available_runs: entries.length,
    sampled_runs: entries.length,
    ...counts,
    latest_non_clean_run_id: latestNonClean?.run_id ?? null,
    latest_non_clean_classification: latestNonClean?.classification ?? null,
    summary,
  };
}

export function summarizeGovernanceTrend({
  rootDir,
  currentRunId,
  currentGovernanceSurface,
}) {
  const conformanceDir = resolve(rootDir, '.veritas/repo-conformance');
  if (!existsSync(conformanceDir) || !readdirSync(conformanceDir, { withFileTypes: false }).length) {
    return buildGovernanceTrendSummary([
      {
        run_id: currentRunId,
        classification: currentGovernanceSurface.classification,
      },
    ]);
  }

  const historical = [];
  for (const entry of readdirSync(conformanceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'latest.json') {
      continue;
    }
    const filePath = resolve(conformanceDir, entry.name);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed?.governance_surface?.classification) {
      continue;
    }
    if (parsed.run_id === currentRunId) {
      continue;
    }
    historical.push({
      run_id: parsed.run_id,
      classification: parsed.governance_surface.classification,
      generated_at: parsed.generated_at ?? parsed.timestamp ?? null,
    });
  }

  historical.sort((left, right) =>
    String(left.generated_at ?? left.run_id).localeCompare(String(right.generated_at ?? right.run_id)),
  );
  const sampled = historical.slice(-9);
  sampled.push({
    run_id: currentRunId,
    classification: currentGovernanceSurface.classification,
    generated_at: null,
  });
  return buildGovernanceTrendSummary(sampled);
}

export function classifyGovernanceSurface({
  rootDir = process.cwd(),
  changedFrom,
  changedTo,
} = {}) {
  const evaluated = Boolean(changedFrom && changedTo);
  if (!evaluated) {
    return {
      classification: 'clean',
      summary: 'clean (no PR base/head diff)',
      evaluated: false,
      compared_refs: {
        base: changedFrom ?? null,
        head: changedTo ?? null,
      },
      files: [],
      changed_paths: [],
      semantic_changed_paths: [],
    };
  }

  const diffPaths = git(rootDir, [
    'diff',
    '--name-only',
    changedFrom,
    changedTo,
    '--',
    ...governanceRoots,
  ])
    .split(/\r?\n/u)
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .filter(isGovernancePath);
  const changedPathSet = new Set(diffPaths);
  const basePaths = listGovernancePathsAtRef(rootDir, changedFrom);
  const headPaths = listGovernancePathsAtRef(rootDir, changedTo);
  const candidatePaths = Array.from(new Set([...basePaths, ...headPaths, ...diffPaths])).sort();

  const fileAssessments = candidatePaths.map((filePath) => {
    const baseSnapshot = readGovernanceJsonAtRef(rootDir, changedFrom, filePath);
    const headSnapshot = readGovernanceJsonAtRef(rootDir, changedTo, filePath);

    if (!baseSnapshot.exists && headSnapshot.exists) {
      return {
        path: filePath,
        status: 'added',
        additive: true,
        semantic_change: true,
      };
    }

    if (baseSnapshot.exists && !headSnapshot.exists) {
      return {
        path: filePath,
        status: 'removed',
        additive: false,
        semantic_change: true,
      };
    }

    if (isDeepStrictEqual(baseSnapshot.value, headSnapshot.value)) {
      return {
        path: filePath,
        status: 'equivalent',
        additive: true,
        semantic_change: false,
      };
    }

    const additive = isAdditiveJsonChange(baseSnapshot.value, headSnapshot.value);
    return {
      path: filePath,
      status: additive ? 'modified-additive' : 'modified-protected-standards',
      additive,
      semantic_change: true,
    };
  });
  const relevantAssessments = fileAssessments.filter(
    (assessment) => assessment.semantic_change || changedPathSet.has(assessment.path),
  );

  const semanticAssessments = relevantAssessments.filter((assessment) => assessment.semantic_change);
  const classification =
    semanticAssessments.length === 0
      ? 'clean'
      : semanticAssessments.every((assessment) => assessment.additive)
        ? 'additive-only'
        : 'protected-standards-modification';

  return {
    classification,
    summary: formatGovernanceSummary(
      classification,
      semanticAssessments,
      diffPaths,
      true,
    ),
    evaluated: true,
    compared_refs: {
      base: changedFrom,
      head: changedTo,
    },
    files: relevantAssessments,
    changed_paths: Array.from(changedPathSet).sort(),
    semantic_changed_paths: semanticAssessments.map((assessment) => assessment.path),
  };
}

export function renderGovernanceSurfaceLine(governanceSurface) {
  return `- **Governance surface:** ${governanceSurface.summary}`;
}

export async function buildRepoConformanceSnapshot({
  rootDir,
  timestamp = new Date().toISOString(),
  runId = `veritas-conformance-${timestamp.replace(/[:.]/g, '-')}`,
  changedFrom = process.env.VERITAS_CHANGED_FROM,
  changedTo = process.env.VERITAS_CHANGED_TO,
  isCi = process.env.CI === 'true',
} = {}) {
  const readinessRun = await runMergeReadiness(
    {
      rootDir,
      workingTree: !changedFrom && !changedTo,
      changedFrom,
      changedTo,
      runId,
      baselineCiFastStatus: 'success',
      skipEvidenceCheck: true,
      force: true,
    },
    { rootDir },
    [],
    {
      appendHistory: false,
      runEvidenceChecks: false,
      draftOptions: {
        reviewerConfidence: 'unknown',
        exceptionCount: 0,
        notes: [
          'Automated Veritas repo conformance generated by scripts/repo-conformance-status.mjs.',
          'Use this draft when you want to convert the automated snapshot into completed standards feedback.',
        ],
      },
    },
  );
  const report = readinessRun.reportResult;
  const draft = readinessRun.draftResult;
  const runtimeStatus = inspectRuntimeIntegrationStatus(rootDir);
  const policySummary = summarizePolicyResults(report.record.policy_results);
  const alerts = buildConformanceAlerts(report, runtimeStatus, isCi);
  const healthStatus = summarizeHealth(alerts);
  const governanceSurface = classifyGovernanceSurface({
    rootDir,
    changedFrom,
    changedTo,
  });
  const governanceTrend = summarizeGovernanceTrend({
    rootDir,
    currentRunId: runId,
    currentGovernanceSurface: governanceSurface,
  });
  const feedbackTrend = generateStandardsFeedbackSummary({ rootDir }, { rootDir });

  const conformance = {
    version: 1,
    generated_at: timestamp,
    run_id: runId,
    report_artifact_path: report.artifactPath,
    standards_feedback_draft_artifact_path: draft.artifactPath,
    suggested_standards_feedback_command: draft.suggestedRecordCommand,
    source_kind: report.record.source_kind,
    source_scope: report.record.source_scope,
    unresolved_files_count: report.record.unresolved_files.length,
    affected_nodes: affectedNodeIds(report.record),
    affected_evidence_checks: affectedEvidenceCheckLabels(report.record),
    selected_evidence_check_commands: selectedEvidenceCheckLabels(report.record),
    uncovered_path_result: report.record.uncovered_path_result,
    policy_results_summary: policySummary,
    governance_surface: governanceSurface,
    governance_trend: governanceTrend,
    standards_feedback_trend: feedbackTrend,
    health_status: healthStatus,
    alerts,
    runtime_status: runtimeStatus,
  };

  return {
    timestamp,
    runId,
    readinessRun,
    report,
    draft,
    runtimeStatus,
    policySummary,
    governanceSurface,
    governanceTrend,
    feedbackTrend,
    alerts,
    healthStatus,
    conformance,
  };
}
