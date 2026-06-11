import { generateStandardsFeedbackSummary } from '../standards-feedback/records.mjs';
import { inspectRuntimeIntegrationStatus } from '../integrations/runtime-integrations.mjs';
import { runMergeReadiness } from '../readiness/run.mjs';
import {
  classifyGovernanceSurface,
  renderGovernanceSurfaceLine,
  summarizeGovernanceTrend,
} from './governance-surface.mjs';

const REPO_HOOKS_SETUP_COMMAND = 'npm exec -- veritas setup repo-hooks';
const REPO_HOOKS_REPAIR_COMMAND = 'npm exec -- veritas setup repo-hooks --force';

export {
  classifyGovernanceSurface,
  renderGovernanceSurfaceLine,
  summarizeGovernanceTrend,
};

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
