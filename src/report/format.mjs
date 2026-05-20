function formatTriState(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
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
    `- **Components:** ${
      record.components.length ? record.components.join(', ') : 'none'
    }`,
    `- **Triggered proofs:** ${
      record.triggered_proofs.length ? record.triggered_proofs.join(', ') : 'none'
    }`,
    `- **Selected proof labels:** \`${record.selected_proof_labels.join(', ') || 'none'}\``,
    `- **Proof resolution source:** ${record.proof_resolution_source}`,
    `- **Proof suites:** ${record.verification_budget?.proof_suite_count ?? 0} total, ${record.verification_budget?.required_family_count ?? 0} required, ${record.verification_budget?.candidate_family_count ?? 0} candidate, ${record.verification_budget?.move_to_test_family_count ?? 0} move-to-test, ${record.verification_budget?.retire_family_count ?? 0} retiring`,
    `- **External tool results:** ${record.external_tool_results?.length ?? 0}`,
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

  if (record.proof_suite_results?.length > 0) {
    lines.push('', '### Proof Suites');
    for (const family of record.proof_suite_results) {
      const selected = family.selected ? 'selected' : 'not selected';
      lines.push(
        `- ${family.id}: ${family.disposition} / ${family.verification_weight} (${selected}) — ${family.rationale || 'No rationale recorded.'}`,
      );
      if (family.review_trigger) {
        lines.push(`  - Review trigger: ${family.review_trigger}`);
      }
    }
  }

  if (record.external_tool_results?.length > 0) {
    lines.push('', '### External Tool Results');
    for (const result of record.external_tool_results) {
      const weight = result.blocking ? 'blocking' : 'advisory';
      lines.push(
        `- ${result.tool}:${result.proof_id}: ${result.verdict} / ${weight} — ${result.artifact_path}`,
      );
    }
  }

  if (record.verification_budget) {
    lines.push('', '### Verification Budget');
    lines.push(`- ${record.verification_budget.recommendation}`);
    if (record.verification_budget.stale_or_unknown_family_ids.length > 0) {
      lines.push(
        `- Review candidates: ${record.verification_budget.stale_or_unknown_family_ids.join(', ')}`,
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
  if (result.passed === false && result.stage === 'block') return 'FAIL';
  if (result.passed === false) return 'WARN';
  return 'INFO';
}

function summarizeFeedbackCounts(record, proofFailure = null) {
  let failures = proofFailure ? 1 : 0;
  let warnings = 0;
  let passes = 0;

  for (const result of record?.policy_results ?? []) {
    const status = feedbackStatusForPolicyResult(result);
    if (status === 'FAIL') failures += 1;
    if (status === 'WARN') warnings += 1;
    if (status === 'PASS') passes += 1;
  }

  for (const family of record?.proof_suite_results ?? []) {
    if (family.verification_weight === 'blocking' && family.blocking_status === 'failed') {
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

  for (const claim of record?.surface?.report?.claims ?? []) {
    if (claim.status === 'stale' || claim.status === 'disputed') warnings += 1;
  }

  return { failures, warnings, passes };
}

export function buildFeedbackSummary({
  record,
  reportArtifactPath = null,
  draftArtifactPath = null,
  evalArtifactPath = null,
  proofLabels = [],
  proofCommands = [],
  proofRan = false,
  proofFailure = null,
} = {}) {
  const resolvedProofLabels = proofLabels.length > 0 ? proofLabels : proofCommands;
  const affectedNodes = record?.components?.length
    ? record.components.join(', ')
    : 'no matched nodes';
  const files = record?.files ?? [];
  const lines = [
    `veritas: ${files.length} ${files.length === 1 ? 'file' : 'files'} changed -> ${affectedNodes}`,
  ];

  if (proofRan) {
    if (proofFailure) {
      lines.push(`FAIL  proof-command: ${proofFailure.label}`);
      lines.push(`      -> ${proofFailure.message}`);
    } else {
      for (const label of resolvedProofLabels) {
        lines.push(`PASS  proof-command: ${label}`);
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

  for (const family of record?.proof_suite_results ?? []) {
    if (!family.selected) continue;
    const status = family.verification_weight === 'blocking' ? 'PASS' : 'INFO';
    lines.push(
      `${status.padEnd(5)} proof-suite:${family.id}: ${family.disposition} / ${family.verification_weight}`,
    );
    if (family.review_trigger) {
      lines.push(`      -> review: ${family.review_trigger}`);
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

  for (const claim of record?.surface?.report?.claims ?? []) {
    if (claim.status !== 'stale' && claim.status !== 'disputed') continue;
    const faultLines = record.surface.report.faultLinesByClaimId?.[claim.id] ?? [];
    const reason = faultLines[0]?.message ?? `Surface derived status is ${claim.status}.`;
    lines.push(
      `WARN  surface-status: claim "${claim.id}" is ${claim.status.toUpperCase()} (${reason})`,
    );
  }

  const counts = summarizeFeedbackCounts(record, proofFailure);
  const nouns = [
    `${counts.failures} ${counts.failures === 1 ? 'failure' : 'failures'}`,
    `${counts.warnings} ${counts.warnings === 1 ? 'warning' : 'warnings'}`,
  ];
  lines.push('', `${nouns.join(' · ')} · run \`veritas run --check shadow\` for full evidence`);
  const openProposalCount = (record?.surface?.report?.claims ?? [])
    .filter((claim) => claim.claimType === 'veritas-proposal' && claim.status === 'proposed')
    .length;
  if (openProposalCount > 0) {
    lines.push(`proposals: ${openProposalCount} open · run \`veritas proposal list\` to review`);
  }

  const footer = [];
  if (reportArtifactPath) footer.push(`report: ${reportArtifactPath}`);
  if (draftArtifactPath) footer.push(`eval draft: ${draftArtifactPath}`);
  if (evalArtifactPath) footer.push(`eval: ${evalArtifactPath}`);
  if (record?.run_id) footer.push(`run: ${record.run_id}`);
  if (footer.length > 0) {
    lines.push(footer.join(' · '));
  }

  return `${lines.join('\n')}\n`;
}

export function feedbackHasFailures(record, proofFailure = null) {
  return summarizeFeedbackCounts(record, proofFailure).failures > 0;
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
    `- **Governance surface touched:** ${record.governance.surface_touched ? 'yes' : 'no'}`,
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
    `- **Governance surface touched:** ${record.governance.surface_touched ? 'yes' : 'no'}`,
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
