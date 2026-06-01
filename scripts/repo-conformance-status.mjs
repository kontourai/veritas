import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  affectedEvidenceCheckLabels,
  affectedNodeIds,
  buildRepoConformanceSnapshot,
  healthLabel,
  renderGovernanceSurfaceLine,
  selectedEvidenceCheckLabels,
  summarizeAlertCounts,
} from '../src/index.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function writeArtifact(rootDirOverride, relativePath, content) {
  const outputPath = resolve(rootDirOverride, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');
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
  governanceTrend,
  feedbackTrend,
}) {
  const alertSummary = summarizeAlertCounts(alerts);
  const affectedNodes = affectedNodeIds(report.record);
  const affectedEvidenceChecks = affectedEvidenceCheckLabels(report.record);
  const selectedEvidenceChecks = selectedEvidenceCheckLabels(report.record);
  const markdown = [
    '## Veritas Repo Conformance',
    '',
    `- **Health:** ${healthLabel(healthStatus)}`,
    `- **Alerts:** ${alertSummary.errors} error(s), ${alertSummary.warnings} warning(s)`,
    `- **Unresolved files:** ${report.record.unresolved_files.length}`,
    `- **Policy results:** ${policySummary.passed} passed, ${policySummary.failed} failed, ${policySummary.metadata_only} metadata-only`,
    renderGovernanceSurfaceLine(governanceSurface),
    `- **Governance trend:** ${governanceTrend.summary}`,
    `- **Standards feedback trend:** ${feedbackTrend.markdownSummary.split('\n')[0]}`,
    `- **Evidence Checks:** \`${selectedEvidenceChecks.join(', ') || 'none'}\``,
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
    `- **Affected nodes:** ${affectedNodes.length > 0 ? affectedNodes.join(', ') : 'none'}`,
    `- **Affected evidenceChecks:** ${affectedEvidenceChecks.length > 0 ? affectedEvidenceChecks.join(', ') : 'none'}`,
    `- **Evidence Check selection:** ${report.record.evidence_check_resolution_source}`,
    `- **Uncovered path result:** ${report.record.uncovered_path_result}`,
    `- **Report artifact:** \`${report.artifactPath}\``,
    `- **Standards feedback draft:** \`${draft.artifactPath}\``,
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
    '#### Suggested Standards Feedback Command',
    '',
    `\`${draft.suggestedRecordCommand}\``,
    '',
    '</details>',
  );

  return `${markdown.join('\n')}\n`;
}

export async function buildRepoConformanceStatus({
  rootDir: rootDirOverride = rootDir,
  ...options
} = {}) {
  const result = await buildRepoConformanceSnapshot({
    rootDir: rootDirOverride,
    ...options,
  });

  return {
    ...result,
    markdownText: buildMarkdown(result),
  };
}

export async function runRepoConformanceStatus({
  rootDir: rootDirOverride = rootDir,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
  failOnAlerts = process.env.VERITAS_FAIL_ON_ALERTS === '1',
  ...options
} = {}) {
  const result = await buildRepoConformanceStatus({
    rootDir: rootDirOverride,
    ...options,
  });

  writeArtifact(
    rootDirOverride,
    `.veritas/repo-conformance/${result.runId}.json`,
    `${JSON.stringify(result.conformance, null, 2)}\n`,
  );
  writeArtifact(rootDirOverride, `.veritas/repo-conformance/${result.runId}.md`, result.markdownText);
  writeArtifact(
    rootDirOverride,
    '.veritas/repo-conformance/latest.json',
    `${JSON.stringify(result.conformance, null, 2)}\n`,
  );
  writeArtifact(rootDirOverride, '.veritas/repo-conformance/latest.md', result.markdownText);

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
  const result = await runRepoConformanceStatus();
  process.stdout.write(
    `${JSON.stringify(
      {
        runId: result.runId,
        healthStatus: result.healthStatus,
        alerts: result.alerts,
        reportArtifactPath: result.report.artifactPath,
        standardsFeedbackDraftArtifactPath: result.draft.artifactPath,
        conformanceJsonPath: `.veritas/repo-conformance/${result.runId}.json`,
        conformanceMarkdownPath: `.veritas/repo-conformance/${result.runId}.md`,
        latestConformanceJsonPath: '.veritas/repo-conformance/latest.json',
        latestConformanceMarkdownPath: '.veritas/repo-conformance/latest.md',
        policyResultsSummary: result.policySummary,
        governanceSurface: result.governanceSurface,
        runtimeStatus: result.runtimeStatus,
        suggestedStandardsFeedbackCommand: result.draft.suggestedRecordCommand,
      },
      null,
      2,
    )}\n`,
  );
}
