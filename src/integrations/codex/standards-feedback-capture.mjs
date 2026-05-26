import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { relativeRepoPath } from '../../paths.mjs';

const REASON_CODES = {
  sessionLogSchemaUnrecognized: 'session_log_schema_unrecognized',
  noFailingRunObserved: 'no_failing_run_observed',
  noPassingRunObserved: 'no_passing_run_observed',
  churnThresholdNotApplicable: 'churn_threshold_not_applicable',
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.events)) return value.events;
  if (Array.isArray(value?.messages)) return value.messages;
  if (Array.isArray(value?.turns)) return value.turns;
  return [];
}

function heuristicMissing(reason) {
  return { value: null, reason };
}

function eventTime(event) {
  const raw = event.timestamp ?? event.time ?? event.created_at ?? event.createdAt;
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? millis : null;
}

function eventText(event) {
  return [event.command, event.cmd, event.content, event.text, event.output, event.message]
    .filter((part) => typeof part === 'string')
    .join('\n');
}

function eventFiles(event) {
  const candidates = [event.files, event.paths, event.touched_files, event.touchedFiles];
  return candidates.flatMap((value) => (Array.isArray(value) ? value : [])).filter((item) => typeof item === 'string');
}

function isReadinessCheck(event) {
  return /\bveritas\s+readiness\b/.test(eventText(event));
}

function isPassing(event) {
  if (event.status === 'pass' || event.status === 'passed') return true;
  if (event.exit_code === 0 || event.exitCode === 0) return true;
  return /\bPASS\b/.test(eventText(event)) && !/\bFAIL\b/.test(eventText(event));
}

function isFailing(event) {
  if (event.status === 'fail' || event.status === 'failed') return true;
  if (typeof event.exit_code === 'number' && event.exit_code !== 0) return true;
  if (typeof event.exitCode === 'number' && event.exitCode !== 0) return true;
  return /\bFAIL\b/.test(eventText(event));
}

function observedFiles(events, evidenceRecord) {
  const files = new Set(evidenceRecord?.files ?? []);
  for (const event of events) {
    for (const file of eventFiles(event)) files.add(file);
  }
  return [...files].sort();
}

function deriveTimeToGreen(events) {
  if (events.length === 0) return heuristicMissing(REASON_CODES.sessionLogSchemaUnrecognized);
  const firstFailure = events.find((event) => isReadinessCheck(event) && isFailing(event) && eventTime(event) !== null);
  if (!firstFailure) return heuristicMissing(REASON_CODES.noFailingRunObserved);
  const failedAt = eventTime(firstFailure);
  const firstPass = events.find((event) => isReadinessCheck(event) && isPassing(event) && eventTime(event) !== null && eventTime(event) >= failedAt);
  if (!firstPass) return heuristicMissing(REASON_CODES.noPassingRunObserved);
  return Math.round(((eventTime(firstPass) - failedAt) / 60000) * 100) / 100;
}

function deriveAcceptedWithoutMajorRewrite(events, files, threshold) {
  if (events.length === 0) return heuristicMissing(REASON_CODES.sessionLogSchemaUnrecognized);
  if (files.length === 0) return heuristicMissing(REASON_CODES.churnThresholdNotApplicable);
  const finishIndex = events.findLastIndex?.((event) => isReadinessCheck(event)) ?? [...events].reverse().findIndex((event) => isReadinessCheck(event));
  const start = finishIndex >= 0 ? finishIndex + 1 : 0;
  let changedLines = 0;
  for (const event of events.slice(start)) {
    const touchesTrackedFile = eventFiles(event).some((file) => files.includes(file));
    if (!touchesTrackedFile) continue;
    changedLines += Number(event.line_churn ?? event.lineChurn ?? event.changed_lines ?? event.changedLines ?? 0);
  }
  const baseline = Math.max(1, Number(events.find((event) => isReadinessCheck(event))?.reported_lines ?? 100));
  return changedLines / baseline <= threshold;
}

function countExceptions(events) {
  return events.filter((event) => /VERITAS_EXCEPTION_RULE=|VERITAS_HOOK_SKIP=1|--skip-evidence-check/.test(eventText(event))).length;
}

export function buildCodexStandardsFeedbackDraft({ sessionLog, sessionLogPath, evidenceRecord = null, rootDir, churnThreshold = 0.3 }) {
  const events = asArray(sessionLog);
  const runId = evidenceRecord?.run_id ?? sessionLog.run_id ?? sessionLog.session_id ?? `codex-${Date.now()}`;
  const files = observedFiles(events, evidenceRecord);
  const timeToGreenMinutes = deriveTimeToGreen(events);
  const acceptedWithoutMajorRewrite = deriveAcceptedWithoutMajorRewrite(events, files, churnThreshold);
  const sessionLogRelativePath = relativeRepoPath(rootDir, sessionLogPath);
  const timestamp = evidenceRecord?.timestamp ?? new Date().toISOString();
  return {
    version: 1,
    run_id: runId,
    authority_settings_id: 'codex-observed',
    mode: 'observe',
    source: 'codex-session-log',
    session_log_path: sessionLogRelativePath,
    evidence: evidenceRecord
      ? {
          artifact_path: evidenceRecord.artifact_path ?? null,
          artifact_digest: evidenceRecord.artifact_digest ?? createHash('sha256').update(JSON.stringify(evidenceRecord)).digest('hex'),
          timestamp: evidenceRecord.timestamp ?? null,
          source_ref: evidenceRecord.source_ref ?? 'codex-session-log',
          source_kind: evidenceRecord.source_kind ?? 'explicit-files',
          source_scope: evidenceRecord.source_scope ?? ['session-log'],
          components: evidenceRecord.components ?? [],
          triggered_evidence_checks: evidenceRecord.triggered_evidence_checks ?? [],
        }
      : {
          artifact_path: sessionLogRelativePath,
          artifact_digest: createHash('sha256').update(JSON.stringify(sessionLog)).digest('hex'),
          timestamp,
          source_ref: sessionLogRelativePath,
          source_kind: 'explicit-files',
          source_scope: ['session-log'],
          components: [],
          triggered_evidence_checks: [],
        },
    governance: {
      protected_standards_touched: false,
      classification: 'unknown',
      human_review_required: false,
      changed_paths: [],
    },
    reviewer_confidence_scale: ['low', 'medium', 'high', 'unknown'],
    prefilled_outcome: {
      accepted_without_major_rewrite: acceptedWithoutMajorRewrite,
      reviewer_confidence: 'unknown',
    },
    prefilled_measurements: {
      time_to_green_minutes: timeToGreenMinutes,
      exception_count: countExceptions(events),
      false_positive_rules: [],
      missed_issues: [],
    },
    files,
    notes: [],
    missing_confirmation_fields: [
      ...(typeof acceptedWithoutMajorRewrite === 'object' ? ['accepted_without_major_rewrite'] : []),
      'required_followup',
      ...(typeof timeToGreenMinutes === 'object' ? ['time_to_green_minutes'] : []),
    ],
  };
}

function feedbackDraftValidationError(draft) {
  const required = [
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
  const missing = required.filter((field) => draft[field] === undefined);
  if (missing.length > 0) return `missing required field(s): ${missing.join(', ')}`;
  if (!draft.evidence?.artifact_path || !draft.evidence?.artifact_digest) return 'invalid evidence context';
  if (!Array.isArray(draft.reviewer_confidence_scale)) return 'reviewer_confidence_scale must be an array';
  if (!Array.isArray(draft.notes) || !Array.isArray(draft.missing_confirmation_fields)) return 'notes and missing_confirmation_fields must be arrays';
  return null;
}

function writeValidationFailure({ rootDir, runId, draft, error }) {
  const failurePath = resolve(rootDir, `.veritas/external/standards-feedback-draft-validation-failures/${runId}.json`);
  mkdirSync(dirname(failurePath), { recursive: true });
  writeFileSync(failurePath, `${JSON.stringify({ error, draft }, null, 2)}\n`, 'utf8');
  return relativeRepoPath(rootDir, failurePath);
}

function warnStandardsFeedbackValidationSkipped() {
  process.stderr.write('WARN: VERITAS_SKIP_STANDARDS_FEEDBACK_VALIDATION=1 — this is intended as a short-lived escape hatch; remove once the underlying standards feedback draft is fixed.\n');
}

export function observeCodexStandardsFeedback({ sessionLogPath, evidencePath, rootDir, outputPath, churnThreshold = 0.3, verbose = false }) {
  const resolvedSessionLogPath = resolve(rootDir, sessionLogPath);
  const sessionLog = JSON.parse(readFileSync(resolvedSessionLogPath, 'utf8'));
  const evidenceRecord = evidencePath && existsSync(resolve(rootDir, evidencePath))
    ? JSON.parse(readFileSync(resolve(rootDir, evidencePath), 'utf8'))
    : null;
  const draft = buildCodexStandardsFeedbackDraft({
    sessionLog,
    sessionLogPath: resolvedSessionLogPath,
    evidenceRecord,
    rootDir,
    churnThreshold,
  });
  const validationError = feedbackDraftValidationError(draft);
  if (validationError && process.env.VERITAS_SKIP_STANDARDS_FEEDBACK_VALIDATION !== '1') {
    const failurePath = writeValidationFailure({ rootDir, runId: draft.run_id, draft, error: validationError });
    const error = new Error(`Standards feedback draft validation failed: ${validationError}. Failure artifact: ${failurePath}`);
    error.exitCode = 2;
    throw error;
  }
  if (process.env.VERITAS_SKIP_STANDARDS_FEEDBACK_VALIDATION === '1') warnStandardsFeedbackValidationSkipped();

  const artifactPath = resolve(rootDir, outputPath ?? `.veritas/standards-feedback-drafts/${draft.run_id}.json`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  const heuristics = {
    events: asArray(sessionLog).length,
    time_to_green_minutes: draft.prefilled_measurements.time_to_green_minutes,
    accepted_without_major_rewrite: draft.prefilled_outcome.accepted_without_major_rewrite,
  };
  return { draft, artifactPath: relativeRepoPath(rootDir, artifactPath), ...(verbose ? { heuristics } : {}) };
}
