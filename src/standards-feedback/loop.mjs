import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { loadEvidenceArtifact } from '../load.mjs';
import { shellQuote } from '../shell.mjs';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildStandardsFeedbackRecord({
  evidenceRecord,
  evidenceRaw,
  evidencePath,
  authoritySettings,
  options = {},
  rootDir,
}) {
  const reviewerConfidenceScale =
    authoritySettings.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high'];
  if (!evidenceRecord?.run_id) {
    throw new Error('buildStandardsFeedbackRecord requires an evidence record with run_id');
  }
  if (!authoritySettings?.id) {
    throw new Error('buildStandardsFeedbackRecord requires a authority settings with id');
  }
  if (typeof options.timeToGreenMinutes !== 'number' || Number.isNaN(options.timeToGreenMinutes)) {
    throw new Error('buildStandardsFeedbackRecord requires timeToGreenMinutes');
  }
  if (typeof options.exceptionCount !== 'number' || Number.isNaN(options.exceptionCount)) {
    throw new Error('buildStandardsFeedbackRecord requires exceptionCount');
  }
  if (typeof options.acceptedWithoutMajorRewrite !== 'boolean') {
    throw new Error('buildStandardsFeedbackRecord requires acceptedWithoutMajorRewrite');
  }
  if (typeof options.requiredFollowup !== 'boolean') {
    throw new Error('buildStandardsFeedbackRecord requires requiredFollowup');
  }
  if (options.timeToGreenMinutes < 0) {
    throw new Error('timeToGreenMinutes must be zero or greater');
  }
  if (!Number.isInteger(options.exceptionCount) || options.exceptionCount < 0) {
    throw new Error('exceptionCount must be a non-negative integer');
  }
  if (
    options.reviewerConfidence &&
    options.reviewerConfidence !== 'unknown' &&
    !reviewerConfidenceScale.includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the authority settings scale or be unknown',
    );
  }
  const evidence = buildStandardsFeedbackEvidenceContext({
    evidenceRecord,
    evidenceRaw,
    evidencePath,
    rootDir,
  });

  return {
    version: 1,
    run_id: evidenceRecord.run_id,
    authority_settings_id: authoritySettings.id,
    mode: authoritySettings.defaults?.mode ?? 'observe',
    evidence,
    governance: buildStandardsFeedbackGovernanceContext(evidenceRecord),
    outcome: {
      accepted_without_major_rewrite: options.acceptedWithoutMajorRewrite,
      required_followup: options.requiredFollowup,
      reviewer_confidence: options.reviewerConfidence ?? 'unknown',
    },
    measurements: {
      time_to_green_minutes: options.timeToGreenMinutes,
      exception_count: options.exceptionCount,
      false_positive_rules: options.falsePositiveRules ?? [],
      missed_issues: options.missedIssues ?? [],
    },
    exceptions: evidenceRecord.exceptions ?? options.exceptions ?? [],
    notes: options.notes ?? [],
  };
}

function buildStandardsFeedbackEvidenceContext({ evidenceRecord, evidenceRaw, evidencePath, rootDir }) {
  assertWithinDir(
    evidencePath,
    resolve(rootDir, '.veritas/evidence'),
    'standards feedback record requires a repo-local evidence artifact inside .veritas/evidence/',
  );
  const evidenceRelativePath = relativeRepoPath(rootDir, evidencePath);
  const requiredEvidenceKeys = [
    'record_schema_version',
    'run_id',
    'timestamp',
    'source_ref',
    'source_kind',
    'source_scope',
    'components',
    'triggered_evidence_checks',
  ];
  for (const key of requiredEvidenceKeys) {
    if (!(key in evidenceRecord)) {
      throw new Error(`evidence artifact is missing required key: ${key}`);
    }
  }
  const evidenceDigest = sha256Hex(
    evidenceRaw ?? loadEvidenceArtifact(evidencePath, { includeRaw: true }).raw,
  );

  return {
    artifact_path: evidenceRelativePath,
    artifact_digest: evidenceDigest,
    timestamp: evidenceRecord.timestamp,
    source_ref: evidenceRecord.source_ref,
    source_kind: evidenceRecord.source_kind,
    source_scope: evidenceRecord.source_scope ?? [],
    components: evidenceRecord.components ?? [],
    triggered_evidence_checks: evidenceRecord.triggered_evidence_checks ?? [],
    unresolved_files: evidenceRecord.unresolved_files ?? [],
    policy_results: evidenceRecord.policy_results ?? [],
  };
}

function isGovernanceAffectedNode(nodeId) {
  return typeof nodeId === 'string' && nodeId.startsWith('governance.');
}

function isGovernancePath(filePath) {
  return (
    filePath === '.veritas/repo-map.json' ||
    filePath === '.veritas/GOVERNANCE.md' ||
    (typeof filePath === 'string' && filePath.startsWith('.veritas/repo-standards/')) ||
    (typeof filePath === 'string' && filePath.startsWith('.veritas/authority/'))
  );
}

function buildStandardsFeedbackGovernanceContext(evidenceRecord) {
  const changedPaths = (evidenceRecord.files ?? []).filter(isGovernancePath);
  const protectedStandardsTouched =
    (evidenceRecord.components ?? []).some(isGovernanceAffectedNode) ||
    changedPaths.length > 0;
  const classification =
    evidenceRecord.governance_surface?.classification ??
    (protectedStandardsTouched ? 'unknown' : 'clean');

  return {
    protected_standards_touched: protectedStandardsTouched,
    classification,
    human_review_required: classification === 'protected-standards-modification',
    changed_paths: changedPaths,
  };
}

export function buildStandardsFeedbackDraft({
  evidenceRecord,
  evidencePath,
  authoritySettings,
  options = {},
  rootDir,
}) {
  if (!evidenceRecord?.run_id) {
    throw new Error('buildStandardsFeedbackDraft requires an evidence record with run_id');
  }
  if (!authoritySettings?.id) {
    throw new Error('buildStandardsFeedbackDraft requires a authority settings with id');
  }
  if (
    options.reviewerConfidence &&
    options.reviewerConfidence !== 'unknown' &&
    !(
      authoritySettings.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']
    ).includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the authority settings scale or be unknown',
    );
  }
  if (
    options.timeToGreenMinutes !== undefined &&
    (Number.isNaN(options.timeToGreenMinutes) || options.timeToGreenMinutes < 0)
  ) {
    throw new Error('timeToGreenMinutes must be zero or greater when provided');
  }
  if (
    options.exceptionCount !== undefined &&
    (!Number.isInteger(options.exceptionCount) || options.exceptionCount < 0)
  ) {
    throw new Error('exceptionCount must be a non-negative integer when provided');
  }

  const prefilledMeasurements = {
    time_to_green_minutes: options.timeToGreenMinutes ?? null,
    exception_count: options.exceptionCount ?? 0,
    false_positive_rules: options.falsePositiveRules ?? [],
    missed_issues: options.missedIssues ?? [],
  };
  const draft = {
    version: 1,
    run_id: evidenceRecord.run_id,
    authority_settings_id: authoritySettings.id,
    mode: authoritySettings.defaults?.mode ?? 'observe',
    evidence: buildStandardsFeedbackEvidenceContext({ evidenceRecord, evidencePath, rootDir }),
    governance: buildStandardsFeedbackGovernanceContext(evidenceRecord),
    reviewer_confidence_scale: [
      ...(authoritySettings.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
      'unknown',
    ],
    prefilled_outcome: {
      reviewer_confidence: options.reviewerConfidence ?? 'unknown',
    },
    prefilled_measurements: prefilledMeasurements,
    notes: options.notes ?? [],
    missing_confirmation_fields: [
      'accepted_without_major_rewrite',
      'required_followup',
      ...(prefilledMeasurements.time_to_green_minutes === null
        ? ['time_to_green_minutes']
        : []),
    ],
  };

  return draft;
}


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
    resolve(rootDir, '.veritas/standards-feedback-drafts'),
    'standards feedback record requires a repo-local draft artifact inside .veritas/standards-feedback-drafts/',
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
  outputPath = `.veritas/standards-feedback/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    resolve(rootDir, '.veritas/standards-feedback'),
    'standards feedback artifacts may only be written inside .veritas/standards-feedback/',
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
  const historyPath = resolve(rootDir, '.veritas/standards-feedback/history.jsonl');
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
      stage: result.stage,
    })),
  };
  appendFileSync(historyPath, `${JSON.stringify(historyRecord)}\n`, 'utf8');
  return historyPath;
}

export function writeStandardsFeedbackDraftArtifact(
  record,
  rootDir,
  outputPath = `.veritas/standards-feedback-drafts/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    resolve(rootDir, '.veritas/standards-feedback-drafts'),
    'standards feedback drafts may only be written inside .veritas/standards-feedback-drafts/',
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
