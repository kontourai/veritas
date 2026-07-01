import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath, veritasArtifactPath, veritasArtifactRepoPath } from '../paths.mjs';
import { shellQuote } from '../shell.mjs';

export function buildStandardsFeedbackRecordCommand(draftPath, draft) {
  const args = [
    'npm',
    'exec',
    '--',
    'veritas',
    'feedback',
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
    typeof draft.prefilled_measurements.time_to_green_minutes !== 'number'
      ? '<minutes>'
      : String(draft.prefilled_measurements.time_to_green_minutes),
    '--exception-count',
    String(draft.prefilled_measurements.exception_count),
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

export function validateStandardsFeedbackDraftContext({ draftPath, draftRecord, rootDir, authoritySettings }) {
  assertWithinDir(
    draftPath,
    veritasArtifactPath(rootDir, 'standards-feedback-drafts'),
    `standards feedback record requires a repo-local draft artifact inside ${veritasArtifactRepoPath('standards-feedback-drafts')}/`,
  );
  const requiredDraftKeys = [
    'version',
    'run_id',
    'authority_settings_id',
    'mode',
    'evidence',
    'governance',
    'reviewer_confidence_scale',
    'prefilled_outcome',
    'prefilled_measurements',
    'notes',
    'missing_confirmation_fields',
  ];
  for (const key of requiredDraftKeys) {
    if (!(key in draftRecord)) {
      throw new Error(`standards feedback draft is missing required key: ${key}`);
    }
  }
  if (authoritySettings.id !== draftRecord.authority_settings_id) {
    throw new Error(
      'standards feedback record draft must be completed with the same authority settings that created it',
    );
  }
  const expectedScale = [
    ...(authoritySettings.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
    'unknown',
  ];
  if (JSON.stringify(expectedScale) !== JSON.stringify(draftRecord.reviewer_confidence_scale)) {
    throw new Error(
      'standards feedback record draft reviewer confidence scale must match the authority settings scale',
    );
  }
}

export function writeStandardsFeedbackArtifact(
  record,
  rootDir,
  outputPath = veritasArtifactRepoPath('standards-feedback', `${record.run_id}.json`),
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    veritasArtifactPath(rootDir, 'standards-feedback'),
    `standards feedback artifacts may only be written inside ${veritasArtifactRepoPath('standards-feedback')}/`,
  );
  const relativeArtifactPath = relativeRepoPath(rootDir, artifactPath);
  if (existsSync(artifactPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeArtifactPath} (use --force to replace it)`,
    );
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export function appendStandardsFeedbackHistory(record, rootDir) {
  const historyPath = veritasArtifactPath(rootDir, 'standards-feedback', 'history.jsonl');
  mkdirSync(dirname(historyPath), { recursive: true });
  const historyRecord = {
    timestamp: record.timestamp,
    run_id: record.run_id,
    accepted: record.outcome.accepted_without_major_rewrite,
    time_to_green_min: record.measurements.time_to_green_minutes,
    exception_count: record.measurements.exception_count,
    confidence: record.outcome.reviewer_confidence,
    false_positive_rules: record.measurements.false_positive_rules,
    exceptions: record.exceptions ?? [],
    required_followup: record.outcome.required_followup,
    unresolved_files: record.evidence.unresolved_files ?? [],
    policy_results: (record.evidence.policy_results ?? []).map((result) => ({
      rule_id: result.rule_id,
      passed: result.passed,
      enforcementLevel: result.enforcementLevel,
    })),
  };
  appendFileSync(historyPath, `${JSON.stringify(historyRecord)}\n`, 'utf8');
  return historyPath;
}

export function writeStandardsFeedbackDraftArtifact(
  record,
  rootDir,
  outputPath = veritasArtifactRepoPath('standards-feedback-drafts', `${record.run_id}.json`),
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    veritasArtifactPath(rootDir, 'standards-feedback-drafts'),
    `standards feedback drafts may only be written inside ${veritasArtifactRepoPath('standards-feedback-drafts')}/`,
  );
  const relativeArtifactPath = relativeRepoPath(rootDir, artifactPath);
  if (existsSync(artifactPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeArtifactPath} (use --force to replace it)`,
    );
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}
