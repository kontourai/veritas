import { createHash } from 'node:crypto';
import { assertWithinDir, relativeRepoPath, veritasArtifactPath, veritasArtifactRepoPath } from '../paths.mjs';
import { loadEvidenceArtifact } from '../load.mjs';

export {
  appendStandardsFeedbackHistory,
  buildStandardsFeedbackRecordCommand,
  validateStandardsFeedbackDraftContext,
  writeStandardsFeedbackArtifact,
  writeStandardsFeedbackDraftArtifact,
} from './artifacts.mjs';

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
    veritasArtifactPath(rootDir, 'evidence'),
    `standards feedback record requires a repo-local evidence artifact inside ${veritasArtifactRepoPath('evidence')}/`,
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
