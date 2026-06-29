function formatTriState(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

export function buildMarkdownSummary(record, artifactPath) {
  const triggeredEvidenceChecks = record.triggered_evidence_checks ?? [];
  const selectedEvidenceCheckLabels = record.selected_evidence_check_labels ?? [];
  const policyPassCount = record.policy_results.filter((result) => result.passed === true).length;
  const policyFailCount = record.policy_results.filter((result) => result.passed === false).length;
  const policyMetadataOnlyCount = record.policy_results.filter(
    (result) => result.passed === null,
  ).length;
  const lines = [
    '## Veritas Report',
    '',
    `- **Repo map:** ${record.repo_map.name} (${record.repo_map.kind})`,
    `- **Source:** ${record.source_kind} (${record.source_scope.join(', ')})`,
    `- **Phase:** ${record.resolved_phase}`,
    `- **Workstream:** ${record.resolved_workstream}`,
    `- **Components:** ${
      record.components.length ? record.components.join(', ') : 'none'
    }`,
    `- **Triggered evidenceChecks:** ${
      triggeredEvidenceChecks.length ? triggeredEvidenceChecks.join(', ') : 'none'
    }`,
    `- **Selected evidenceCheck labels:** \`${selectedEvidenceCheckLabels.join(', ') || 'none'}\``,
    `- **Evidence Check selection:** ${record.evidence_check_resolution_source}`,
    `- **Evidence inventories:** ${record.readiness_coverage?.evidence_inventory_count ?? 0} total, ${record.readiness_coverage?.required_inventory_count ?? 0} required, ${record.readiness_coverage?.candidate_inventory_count ?? 0} candidate, ${record.readiness_coverage?.move_to_test_inventory_count ?? 0} move-to-test, ${record.readiness_coverage?.retire_inventory_count ?? 0} retiring`,
    `- **External tool results:** ${record.external_tool_results?.length ?? 0}`,
    `- **Uncovered path result:** ${record.uncovered_path_result}`,
    `- **Baseline \`ci:fast\` passed:** ${formatTriState(record.baseline_ci_fast_passed)}`,
    `- **Report transport:** ${record.repo_map.report_transport}`,
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

  if (record.evidence_inventory_results?.length > 0) {
    lines.push('', '### Evidence Inventorys');
    for (const item of record.evidence_inventory_results) {
      const selected = item.selected ? 'selected' : 'not selected';
      lines.push(
        `- ${item.id}: ${item.disposition} / ${item.verification_weight} (${selected}) — ${item.rationale || 'No rationale recorded.'}`,
      );
      if (item.review_trigger) {
        lines.push(`  - Review trigger: ${item.review_trigger}`);
      }
    }
  }

  if (record.external_tool_results?.length > 0) {
    lines.push('', '### External Tool Results');
    for (const result of record.external_tool_results) {
      const weight = result.blocking ? 'blocking' : 'advisory';
      lines.push(
        `- ${result.tool}:${result.evidence_check_id}: ${result.verdict} / ${weight} — ${result.artifact_path}`,
      );
    }
  }

  if (record.readiness_coverage) {
    lines.push('', '### Readiness Coverage');
    lines.push(`- ${record.readiness_coverage.recommendation}`);
    if (record.readiness_coverage.stale_or_unknown_inventory_ids.length > 0) {
      lines.push(
        `- Review candidates: ${record.readiness_coverage.stale_or_unknown_inventory_ids.join(', ')}`,
      );
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

export function feedbackStatusForPolicyResult(result) {
  if (result.status === 'error') return 'FAIL';
  if (result.passed === true) return 'PASS';
  if (result.passed === false && result.enforcementLevel === 'Require') return 'FAIL';
  if (result.passed === false) return 'WARN';
  return 'INFO';
}

function summarizeFeedbackCounts(record, evidenceCheckFailure = null) {
  let failures = evidenceCheckFailure ? 1 : 0;
  let warnings = 0;
  let passes = 0;

  for (const result of record?.policy_results ?? []) {
    const status = feedbackStatusForPolicyResult(result);
    if (status === 'FAIL') failures += 1;
    if (status === 'WARN') warnings += 1;
    if (status === 'PASS') passes += 1;
  }

  for (const item of record?.evidence_inventory_results ?? []) {
    if (item.verification_weight === 'blocking' && item.blocking_status === 'failed') {
      failures += 1;
    }
  }

  for (const result of record?.external_tool_results ?? []) {
    if (result.verdict === 'pass') {
      passes += 1;
    } else if (result.blocking) {
      failures += 1;
    } else {
      warnings += 1;
    }
  }

  for (const claim of record?.trust?.report?.claims ?? []) {
    if (claim.status === 'stale' || claim.status === 'disputed') warnings += 1;
  }

  return { failures, warnings, passes };
}

export function buildFeedbackSummary({
  record,
  reportArtifactPath = null,
  draftArtifactPath = null,
  standardsFeedbackArtifactPath = null,
  evidenceCheckLabels = [],
  evidenceCheckCommands = [],
  evidenceCheckRan = false,
  evidenceCheckFailure = null,
} = {}) {
  const resolvedEvidenceCheckLabels = evidenceCheckLabels.length > 0 ? evidenceCheckLabels : evidenceCheckCommands;
  const affectedNodes = record?.components?.length
    ? record.components.join(', ')
    : 'no matched nodes';
  const files = record?.files ?? [];
  const lines = [
    `veritas: ${files.length} ${files.length === 1 ? 'file' : 'files'} changed -> ${affectedNodes}`,
  ];

  if (evidenceCheckRan) {
    if (evidenceCheckFailure) {
      lines.push(`FAIL  evidence-check: ${evidenceCheckFailure.label}`);
      lines.push(`      -> ${evidenceCheckFailure.message}`);
    } else {
      for (const label of resolvedEvidenceCheckLabels) {
        lines.push(`PASS  evidence-check: ${label}`);
      }
    }
  }

  for (const result of record?.policy_results ?? []) {
    const status = feedbackStatusForPolicyResult(result);
    if (status === 'INFO') continue;
    lines.push(`${status.padEnd(5)} ${result.rule_id}: ${result.summary}`);
    for (const finding of result.findings ?? []) {
      const target = finding.artifact ?? finding.path ?? finding.required;
      if (target) {
        lines.push(`      -> ${target}`);
      }
    }
  }

  for (const item of record?.evidence_inventory_results ?? []) {
    if (!item.selected) continue;
    const status = item.verification_weight === 'blocking' ? 'PASS' : 'INFO';
    lines.push(
      `${status.padEnd(5)} evidence-inventory:${item.id}: ${item.disposition} / ${item.verification_weight}`,
    );
    if (item.review_trigger) {
      lines.push(`      -> review: ${item.review_trigger}`);
    }
  }

  for (const result of record?.external_tool_results ?? []) {
    const status =
      result.verdict === 'pass' ? 'PASS' : result.blocking ? 'FAIL' : 'WARN';
    lines.push(
      `${status.padEnd(5)} external-tool:${result.tool}: ${result.verdict} / ${result.blocking ? 'blocking' : 'advisory'}`,
    );
    lines.push(`      -> ${result.artifact_path}`);
  }

  for (const claim of record?.trust?.report?.claims ?? []) {
    if (claim.status !== 'stale' && claim.status !== 'disputed') continue;
    const transparencyGaps = record.trust.report.transparencyGapsByClaimId?.[claim.id] ?? [];
    const reason = transparencyGaps[0]?.message ?? `Surface derived status is ${claim.status}.`;
    lines.push(
      `WARN  surface-status: claim "${claim.id}" is ${claim.status.toUpperCase()} (${reason})`,
    );
  }

  const counts = summarizeFeedbackCounts(record, evidenceCheckFailure);
  const nouns = [
    `${counts.failures} ${counts.failures === 1 ? 'failure' : 'failures'}`,
    `${counts.warnings} ${counts.warnings === 1 ? 'warning' : 'warnings'}`,
  ];
  lines.push('', `${nouns.join(' · ')} · run \`veritas readiness --check evidence\` for full generated evidence`);
  const openRecommendationCount = (record?.trust?.report?.claims ?? [])
    .filter((claim) => claim.claimType === 'veritas-recommendation' && claim.status === 'proposed')
    .length;
  if (openRecommendationCount > 0) {
    lines.push(`recommendations: ${openRecommendationCount} open · run \`veritas recommendation list\` to review`);
  }

  const footer = [];
  if (reportArtifactPath) footer.push(`report: ${reportArtifactPath}`);
  if (draftArtifactPath) footer.push(`standards feedback draft: ${draftArtifactPath}`);
  if (standardsFeedbackArtifactPath) footer.push(`standards feedback: ${standardsFeedbackArtifactPath}`);
  if (record?.run_id) footer.push(`run: ${record.run_id}`);
  if (footer.length > 0) {
    lines.push(footer.join(' · '));
  }

  return `${lines.join('\n')}\n`;
}

export function feedbackHasFailures(record, evidenceCheckFailure = null) {
  return summarizeFeedbackCounts(record, evidenceCheckFailure).failures > 0;
}

export function buildStandardsFeedbackMarkdownSummary(record, artifactPath) {
  const lines = [
    '## Veritas Standards Feedback',
    '',
    `- **Run ID:** ${record.run_id}`,
    `- **Mode:** ${record.mode}`,
    `- **Authority settings:** ${record.authority_settings_id}`,
    `- **Evidence artifact:** \`${record.evidence.artifact_path}\``,
    `- **Standards feedback artifact:** \`${artifactPath}\``,
    `- **Accepted without major rewrite:** ${record.outcome.accepted_without_major_rewrite ? 'yes' : 'no'}`,
    `- **Required follow-up:** ${record.outcome.required_followup ? 'yes' : 'no'}`,
    `- **Reviewer confidence:** ${record.outcome.reviewer_confidence}`,
    `- **Time to green:** ${record.measurements.time_to_green_minutes} minutes`,
    `- **Exception count:** ${record.measurements.exception_count}`,
    `- **Protected standards touched:** ${record.governance.protected_standards_touched ? 'yes' : 'no'}`,
    `- **Governance classification:** ${record.governance.classification}`,
    `- **Human governance review required:** ${record.governance.human_review_required ? 'yes' : 'no'}`,
  ];

  if (record.governance.changed_paths.length > 0) {
    lines.push(`- **Governance paths:** ${record.governance.changed_paths.join(', ')}`);
  }

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

export function buildStandardsFeedbackDraftMarkdownSummary(record, artifactPath, suggestedRecordCommand) {
  const lines = [
    '## Veritas Standards Feedback Draft',
    '',
    `- **Run ID:** ${record.run_id}`,
    `- **Mode:** ${record.mode}`,
    `- **Authority settings:** ${record.authority_settings_id}`,
    `- **Evidence artifact:** \`${record.evidence.artifact_path}\``,
    `- **Draft artifact:** \`${artifactPath}\``,
    `- **Missing confirmation fields:** ${record.missing_confirmation_fields.join(', ')}`,
    `- **Protected standards touched:** ${record.governance.protected_standards_touched ? 'yes' : 'no'}`,
    `- **Governance classification:** ${record.governance.classification}`,
    `- **Human governance review required:** ${record.governance.human_review_required ? 'yes' : 'no'}`,
    '',
    '### Next Step',
    '',
    `\`${suggestedRecordCommand}\``,
  ];

  if (record.governance.changed_paths.length > 0) {
    lines.splice(8, 0, `- **Governance paths:** ${record.governance.changed_paths.join(', ')}`);
  }

  return `${lines.join('\n')}\n`;
}
