import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { loadEvidenceArtifact } from '../load.mjs';
import { shellQuote } from '../shell.mjs';

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function buildEvalRecord({
  evidenceRecord,
  evidenceRaw,
  evidencePath,
  teamProfile,
  options = {},
  rootDir,
}) {
  const reviewerConfidenceScale =
    teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high'];
  if (!evidenceRecord?.run_id) {
    throw new Error('buildEvalRecord requires an evidence record with run_id');
  }
  if (!teamProfile?.id) {
    throw new Error('buildEvalRecord requires a team profile with id');
  }
  if (typeof options.timeToGreenMinutes !== 'number' || Number.isNaN(options.timeToGreenMinutes)) {
    throw new Error('buildEvalRecord requires timeToGreenMinutes');
  }
  if (typeof options.overrideCount !== 'number' || Number.isNaN(options.overrideCount)) {
    throw new Error('buildEvalRecord requires overrideCount');
  }
  if (typeof options.acceptedWithoutMajorRewrite !== 'boolean') {
    throw new Error('buildEvalRecord requires acceptedWithoutMajorRewrite');
  }
  if (typeof options.requiredFollowup !== 'boolean') {
    throw new Error('buildEvalRecord requires requiredFollowup');
  }
  if (options.timeToGreenMinutes < 0) {
    throw new Error('timeToGreenMinutes must be zero or greater');
  }
  if (!Number.isInteger(options.overrideCount) || options.overrideCount < 0) {
    throw new Error('overrideCount must be a non-negative integer');
  }
  if (
    options.reviewerConfidence &&
    options.reviewerConfidence !== 'unknown' &&
    !reviewerConfidenceScale.includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the team profile scale or be unknown',
    );
  }
  const evidence = buildEvalEvidenceContext({
    evidenceRecord,
    evidenceRaw,
    evidencePath,
    rootDir,
  });

  return {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: teamProfile.id,
    mode: teamProfile.defaults?.mode ?? 'shadow',
    evidence,
    governance: buildEvalGovernanceContext(evidenceRecord),
    outcome: {
      accepted_without_major_rewrite: options.acceptedWithoutMajorRewrite,
      required_followup: options.requiredFollowup,
      reviewer_confidence: options.reviewerConfidence ?? 'unknown',
    },
    measurements: {
      time_to_green_minutes: options.timeToGreenMinutes,
      override_count: options.overrideCount,
      false_positive_rules: options.falsePositiveRules ?? [],
      missed_issues: options.missedIssues ?? [],
    },
    notes: options.notes ?? [],
  };
}

function buildEvalEvidenceContext({ evidenceRecord, evidenceRaw, evidencePath, rootDir }) {
  assertWithinDir(
    evidencePath,
    resolve(rootDir, '.veritas/evidence'),
    'eval record requires a repo-local evidence artifact inside .veritas/evidence/',
  );
  const evidenceRelativePath = relativeRepoPath(rootDir, evidencePath);
  const requiredEvidenceKeys = [
    'framework_version',
    'run_id',
    'timestamp',
    'source_ref',
    'source_kind',
    'source_scope',
    'affected_nodes',
    'affected_lanes',
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
    affected_nodes: evidenceRecord.affected_nodes ?? [],
    affected_lanes: evidenceRecord.affected_lanes ?? [],
    policy_results: evidenceRecord.policy_results ?? [],
  };
}

function isGovernanceAffectedNode(nodeId) {
  return typeof nodeId === 'string' && nodeId.startsWith('governance.');
}

function isGovernancePath(filePath) {
  return (
    filePath === '.veritas/repo.adapter.json' ||
    filePath === '.veritas/GOVERNANCE.md' ||
    (typeof filePath === 'string' && filePath.startsWith('.veritas/policy-packs/')) ||
    (typeof filePath === 'string' && filePath.startsWith('.veritas/team/'))
  );
}

function buildEvalGovernanceContext(evidenceRecord) {
  const changedPaths = (evidenceRecord.files ?? []).filter(isGovernancePath);
  const surfaceTouched =
    (evidenceRecord.affected_nodes ?? []).some(isGovernanceAffectedNode) ||
    changedPaths.length > 0;
  const classification =
    evidenceRecord.governance_surface?.classification ??
    (surfaceTouched ? 'unknown' : 'clean');

  return {
    surface_touched: surfaceTouched,
    classification,
    human_review_required: classification === 'constitutional-modification',
    changed_paths: changedPaths,
  };
}

export function buildEvalDraft({
  evidenceRecord,
  evidencePath,
  teamProfile,
  options = {},
  rootDir,
}) {
  if (!evidenceRecord?.run_id) {
    throw new Error('buildEvalDraft requires an evidence record with run_id');
  }
  if (!teamProfile?.id) {
    throw new Error('buildEvalDraft requires a team profile with id');
  }
  if (
    options.reviewerConfidence &&
    options.reviewerConfidence !== 'unknown' &&
    !(
      teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']
    ).includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the team profile scale or be unknown',
    );
  }
  if (
    options.timeToGreenMinutes !== undefined &&
    (Number.isNaN(options.timeToGreenMinutes) || options.timeToGreenMinutes < 0)
  ) {
    throw new Error('timeToGreenMinutes must be zero or greater when provided');
  }
  if (
    options.overrideCount !== undefined &&
    (!Number.isInteger(options.overrideCount) || options.overrideCount < 0)
  ) {
    throw new Error('overrideCount must be a non-negative integer when provided');
  }

  const prefilledMeasurements = {
    time_to_green_minutes: options.timeToGreenMinutes ?? null,
    override_count: options.overrideCount ?? 0,
    false_positive_rules: options.falsePositiveRules ?? [],
    missed_issues: options.missedIssues ?? [],
  };
  const draft = {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: teamProfile.id,
    mode: teamProfile.defaults?.mode ?? 'shadow',
    evidence: buildEvalEvidenceContext({ evidenceRecord, evidencePath, rootDir }),
    governance: buildEvalGovernanceContext(evidenceRecord),
    reviewer_confidence_scale: [
      ...(teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
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


export function buildEvalRecordCommand(draftPath, draft) {
  const args = [
    'npm',
    'exec',
    '--',
    'veritas',
    'eval',
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
    '--override-count',
    String(draft.prefilled_measurements.override_count),
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

export function validateEvalDraftContext({ draftPath, draftRecord, rootDir, teamProfile }) {
  assertWithinDir(
    draftPath,
    resolve(rootDir, '.veritas/eval-drafts'),
    'eval record requires a repo-local draft artifact inside .veritas/eval-drafts/',
  );
  const requiredDraftKeys = [
    'version',
    'run_id',
    'team_profile_id',
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
      throw new Error(`eval draft is missing required key: ${key}`);
    }
  }
  if (teamProfile.id !== draftRecord.team_profile_id) {
    throw new Error(
      'eval record draft must be completed with the same team profile that created it',
    );
  }
  const expectedScale = [
    ...(teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
    'unknown',
  ];
  if (JSON.stringify(expectedScale) !== JSON.stringify(draftRecord.reviewer_confidence_scale)) {
    throw new Error(
      'eval record draft reviewer confidence scale must match the team profile scale',
    );
  }
}


export function writeEvalArtifact(
  record,
  rootDir,
  outputPath = `.veritas/evals/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    resolve(rootDir, '.veritas/evals'),
    'eval artifacts may only be written inside .veritas/evals/',
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

export function appendEvalHistory(record, rootDir) {
  const historyPath = resolve(rootDir, '.veritas/evals/history.jsonl');
  mkdirSync(dirname(historyPath), { recursive: true });
  const historyRecord = {
    timestamp: record.timestamp,
    run_id: record.run_id,
    accepted: record.outcome.accepted_without_major_rewrite,
    time_to_green_min: record.measurements.time_to_green_minutes,
    override_count: record.measurements.override_count,
    confidence: record.outcome.reviewer_confidence,
    false_positive_rules: record.measurements.false_positive_rules,
    required_followup: record.outcome.required_followup,
    policy_results: (record.evidence.policy_results ?? []).map((result) => ({
      rule_id: result.rule_id,
      passed: result.passed,
      stage: result.stage,
    })),
  };
  appendFileSync(historyPath, `${JSON.stringify(historyRecord)}\n`, 'utf8');
  return historyPath;
}

export function writeEvalDraftArtifact(
  record,
  rootDir,
  outputPath = `.veritas/eval-drafts/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    resolve(rootDir, '.veritas/eval-drafts'),
    'eval drafts may only be written inside .veritas/eval-drafts/',
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
