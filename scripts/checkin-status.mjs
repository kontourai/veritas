import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  generateEvalDraft,
  generateVeritasReport,
  inspectRuntimeAdapterStatus,
} from '../src/index.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const governanceRoots = ['.veritas/repo.adapter.json', '.veritas/policy-packs', '.veritas/team'];

function summarizePolicyResults(policyResults) {
  return {
    passed: policyResults.filter((result) => result.passed === true).length,
    failed: policyResults.filter((result) => result.passed === false).length,
    metadata_only: policyResults.filter((result) => result.passed === null).length,
  };
}

function buildAlerts(report, runtimeStatus, isCi) {
  const alerts = [];

  if (report.record.policy_results.some((result) => result.passed === false)) {
    alerts.push({
      severity: 'error',
      code: 'policy-failed',
      message: 'One or more evaluated policy rules failed.',
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
    });
  } else if (!runtimeStatus.gitHook.executable) {
    alerts.push({
      severity: 'error',
      code: 'git-hook-not-executable',
      message: 'The tracked post-commit hook exists but is not executable.',
    });
  } else if (!runtimeStatus.gitHook.configured && !isCi) {
    alerts.push({
      severity: 'warning',
      code: 'git-hook-not-configured',
      message: 'The tracked post-commit hook is present, but git is not configured to use .githooks.',
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
  } else if (runtimeStatus.codexTarget.checked && !runtimeStatus.codexTarget.adapterInstalled) {
    alerts.push({
      severity: 'warning',
      code: 'codex-adapter-not-installed',
      message: 'A Codex target was checked, but the Veritas adapter is not installed there.',
    });
  }

  return alerts;
}

function summarizeHealth(alerts) {
  if (alerts.some((alert) => alert.severity === 'error')) {
    return 'red';
  }
  if (alerts.some((alert) => alert.severity === 'warning')) {
    return 'yellow';
  }
  return 'green';
}

function healthLabel(healthStatus) {
  if (healthStatus === 'green') return 'Green';
  if (healthStatus === 'yellow') return 'Yellow';
  return 'Red';
}

function summarizeAlertCounts(alerts) {
  return {
    errors: alerts.filter((alert) => alert.severity === 'error').length,
    warnings: alerts.filter((alert) => alert.severity === 'warning').length,
  };
}

function writeArtifact(rootDirOverride, relativePath, content) {
  const outputPath = resolve(rootDirOverride, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');
}

function git(rootDirOverride, args) {
  return execFileSync('git', args, {
    cwd: rootDirOverride,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isGovernancePath(filePath) {
  return (
    filePath === '.veritas/repo.adapter.json' ||
    (filePath.startsWith('.veritas/policy-packs/') && filePath.endsWith('.json')) ||
    (filePath.startsWith('.veritas/team/') && filePath.endsWith('.json'))
  );
}

function readGovernanceJsonAtRef(rootDirOverride, ref, filePath) {
  try {
    return {
      exists: true,
      value: JSON.parse(git(rootDirOverride, ['show', `${ref}:${filePath}`])),
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

export function classifyGovernanceSurface({
  rootDir: rootDirOverride = rootDir,
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

  const changedFiles = git(rootDirOverride, [
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
    .filter(isGovernancePath)
    .sort();

  const fileAssessments = changedFiles.map((filePath) => {
    const baseSnapshot = readGovernanceJsonAtRef(rootDirOverride, changedFrom, filePath);
    const headSnapshot = readGovernanceJsonAtRef(rootDirOverride, changedTo, filePath);

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
      status: additive ? 'modified-additive' : 'modified-constitutional',
      additive,
      semantic_change: true,
    };
  });

  const semanticAssessments = fileAssessments.filter((assessment) => assessment.semantic_change);
  const classification =
    semanticAssessments.length === 0
      ? 'clean'
      : semanticAssessments.every((assessment) => assessment.additive)
        ? 'additive-only'
        : 'constitutional-modification';

  return {
    classification,
    summary: formatGovernanceSummary(
      classification,
      semanticAssessments,
      changedFiles,
      true,
    ),
    evaluated: true,
    compared_refs: {
      base: changedFrom,
      head: changedTo,
    },
    files: fileAssessments,
    changed_paths: changedFiles,
    semantic_changed_paths: semanticAssessments.map((assessment) => assessment.path),
  };
}

export function renderGovernanceSurfaceLine(governanceSurface) {
  return `- **Governance surface:** ${governanceSurface.summary}`;
}

function buildMarkdown({
  runId,
  timestamp,
  report,
  draft,
  alerts,
  runtimeStatus,
  healthStatus,
  policySummary,
  governanceSurface,
}) {
  const alertSummary = summarizeAlertCounts(alerts);
  const markdown = [
    '## Veritas Check-in',
    '',
    `- **Health:** ${healthLabel(healthStatus)}`,
    `- **Alerts:** ${alertSummary.errors} error(s), ${alertSummary.warnings} warning(s)`,
    `- **Unresolved files:** ${report.record.unresolved_files.length}`,
    `- **Policy results:** ${policySummary.passed} passed, ${policySummary.failed} failed, ${policySummary.metadata_only} metadata-only`,
    renderGovernanceSurfaceLine(governanceSurface),
    `- **Proof command:** \`${report.record.selected_proof_commands.join(', ') || 'none'}\``,
    `- **Run ID:** ${runId}`,
    '',
  ];

  if (alerts.length > 0) {
    markdown.push('### Alerts', '');
    for (const alert of alerts) {
      markdown.push(`- **${alert.severity}:** ${alert.message}`);
    }
    markdown.push('');
  }

  markdown.push(
    '<details>',
    '<summary>Scope and Verification</summary>',
    '',
    `- **Generated at:** ${timestamp}`,
    `- **Source:** ${report.record.source_kind} (${report.record.source_scope.join(', ')})`,
    `- **Phase:** ${report.record.resolved_phase}`,
    `- **Workstream:** ${report.record.resolved_workstream}`,
    `- **Affected nodes:** ${report.record.affected_nodes.length > 0 ? report.record.affected_nodes.join(', ') : 'none'}`,
    `- **Affected lanes:** ${report.record.affected_lanes.length > 0 ? report.record.affected_lanes.join(', ') : 'none'}`,
    `- **Proof resolution source:** ${report.record.proof_resolution_source}`,
    `- **Uncovered path result:** ${report.record.uncovered_path_result}`,
    `- **Report artifact:** \`${report.artifactPath}\``,
    `- **Eval draft artifact:** \`${draft.artifactPath}\``,
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Policy Results</summary>',
    '',
  );

  for (const result of report.record.policy_results) {
    const status =
      result.passed === true ? 'pass' : result.passed === false ? 'fail' : 'metadata-only';
    markdown.push(`- **${result.rule_id}**: ${status} — ${result.summary}`);
  }

  markdown.push(
    '',
    '</details>',
    '',
    '<details>',
    '<summary>Operational Follow-up</summary>',
    '',
    `- **Next commands:** ${runtimeStatus.nextCommands.length > 0 ? runtimeStatus.nextCommands.join(' | ') : 'none'}`,
    '',
    '#### Suggested Eval Command',
    '',
    `\`${draft.suggestedRecordCommand}\``,
    '',
    '</details>',
  );

  return `${markdown.join('\n')}\n`;
}

export function buildCheckinStatus({
  rootDir: rootDirOverride = rootDir,
  timestamp = new Date().toISOString(),
  runId = process.env.VERITAS_RUN_ID ??
    `veritas-checkin-${timestamp.replace(/[:.]/g, '-')}`,
  changedFrom = process.env.VERITAS_CHANGED_FROM,
  changedTo = process.env.VERITAS_CHANGED_TO,
  isCi = process.env.CI === 'true',
} = {}) {
  const report = generateVeritasReport(
    {
      rootDir: rootDirOverride,
      workingTree: !changedFrom && !changedTo,
      changedFrom,
      changedTo,
      runId,
      baselineCiFastStatus: 'success',
    },
    { rootDir: rootDirOverride },
  );

  const draft = generateEvalDraft(
    {
      rootDir: rootDirOverride,
      evidencePath: report.artifactPath,
      force: true,
      reviewerConfidence: 'unknown',
      overrideCount: 0,
      notes: [
        'Automated Veritas check-in generated by scripts/checkin-status.mjs.',
        'Use this draft when you want to convert the automated snapshot into a human-scored eval record.',
      ],
    },
    { rootDir: rootDirOverride },
  );

  const runtimeStatus = inspectRuntimeAdapterStatus(rootDirOverride);
  const policySummary = summarizePolicyResults(report.record.policy_results);
  const alerts = buildAlerts(report, runtimeStatus, isCi);
  const healthStatus = summarizeHealth(alerts);
  const governanceSurface = classifyGovernanceSurface({
    rootDir: rootDirOverride,
    changedFrom,
    changedTo,
  });

  const checkin = {
    version: 1,
    generated_at: timestamp,
    run_id: runId,
    report_artifact_path: report.artifactPath,
    eval_draft_artifact_path: draft.artifactPath,
    suggested_eval_command: draft.suggestedRecordCommand,
    source_kind: report.record.source_kind,
    source_scope: report.record.source_scope,
    unresolved_files_count: report.record.unresolved_files.length,
    affected_nodes: report.record.affected_nodes,
    affected_lanes: report.record.affected_lanes,
    selected_proof_commands: report.record.selected_proof_commands,
    uncovered_path_result: report.record.uncovered_path_result,
    policy_results_summary: policySummary,
    governance_surface: governanceSurface,
    health_status: healthStatus,
    alerts,
    runtime_status: runtimeStatus,
  };

  return {
    runId,
    report,
    draft,
    runtimeStatus,
    policySummary,
    governanceSurface,
    alerts,
    healthStatus,
    checkin,
    markdownText: buildMarkdown({
      runId,
      timestamp,
      report,
      draft,
      alerts,
      runtimeStatus,
      healthStatus,
      policySummary,
      governanceSurface,
    }),
  };
}

export function runCheckinStatus({
  rootDir: rootDirOverride = rootDir,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
  failOnAlerts = process.env.VERITAS_FAIL_ON_ALERTS === '1',
  ...options
} = {}) {
  const result = buildCheckinStatus({
    rootDir: rootDirOverride,
    ...options,
  });

  writeArtifact(
    rootDirOverride,
    `.veritas/checkins/${result.runId}.json`,
    `${JSON.stringify(result.checkin, null, 2)}\n`,
  );
  writeArtifact(rootDirOverride, `.veritas/checkins/${result.runId}.md`, result.markdownText);
  writeArtifact(
    rootDirOverride,
    '.veritas/checkins/latest.json',
    `${JSON.stringify(result.checkin, null, 2)}\n`,
  );
  writeArtifact(rootDirOverride, '.veritas/checkins/latest.md', result.markdownText);

  if (summaryPath) {
    appendFileSync(summaryPath, result.markdownText, 'utf8');
  }

  if (failOnAlerts && result.healthStatus === 'red') {
    process.exitCode = 1;
  }

  return result;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const result = runCheckinStatus();
  process.stdout.write(
    `${JSON.stringify(
      {
        runId: result.runId,
        healthStatus: result.healthStatus,
        alerts: result.alerts,
        reportArtifactPath: result.report.artifactPath,
        evalDraftArtifactPath: result.draft.artifactPath,
        checkinJsonPath: `.veritas/checkins/${result.runId}.json`,
        checkinMarkdownPath: `.veritas/checkins/${result.runId}.md`,
        latestCheckinJsonPath: '.veritas/checkins/latest.json',
        latestCheckinMarkdownPath: '.veritas/checkins/latest.md',
        policyResultsSummary: result.policySummary,
        governanceSurface: result.governanceSurface,
        runtimeStatus: result.runtimeStatus,
        suggestedEvalCommand: result.draft.suggestedRecordCommand,
      },
      null,
      2,
    )}\n`,
  );
}
