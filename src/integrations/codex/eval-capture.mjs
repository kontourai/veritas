import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { relativeRepoPath } from '../../paths.mjs';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.events)) return value.events;
  if (Array.isArray(value?.messages)) return value.messages;
  if (Array.isArray(value?.turns)) return value.turns;
  return [];
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

function isShadowRun(event) {
  return /\bveritas\s+shadow\s+run\b/.test(eventText(event));
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
  const firstFailure = events.find((event) => isShadowRun(event) && isFailing(event) && eventTime(event) !== null);
  if (!firstFailure) return null;
  const failedAt = eventTime(firstFailure);
  const firstPass = events.find((event) => isShadowRun(event) && isPassing(event) && eventTime(event) !== null && eventTime(event) >= failedAt);
  if (!firstPass) return null;
  return Math.round(((eventTime(firstPass) - failedAt) / 60000) * 100) / 100;
}

function deriveAcceptedWithoutMajorRewrite(events, files, threshold) {
  if (files.length === 0) return null;
  const finishIndex = events.findLastIndex?.((event) => isShadowRun(event)) ?? [...events].reverse().findIndex((event) => isShadowRun(event));
  const start = finishIndex >= 0 ? finishIndex + 1 : 0;
  let changedLines = 0;
  for (const event of events.slice(start)) {
    const touchesTrackedFile = eventFiles(event).some((file) => files.includes(file));
    if (!touchesTrackedFile) continue;
    changedLines += Number(event.line_churn ?? event.lineChurn ?? event.changed_lines ?? event.changedLines ?? 0);
  }
  const baseline = Math.max(1, Number(events.find((event) => isShadowRun(event))?.reported_lines ?? 100));
  return changedLines / baseline <= threshold;
}

function countOverrides(events) {
  return events.filter((event) => /VERITAS_[A-Z0-9_]+|--skip-proof/.test(eventText(event))).length;
}

export function buildCodexEvalDraft({ transcript, transcriptPath, evidenceRecord = null, rootDir, churnThreshold = 0.3 }) {
  const events = asArray(transcript);
  const runId = evidenceRecord?.run_id ?? transcript.run_id ?? transcript.session_id ?? `codex-${Date.now()}`;
  const files = observedFiles(events, evidenceRecord);
  const timeToGreenMinutes = deriveTimeToGreen(events);
  const acceptedWithoutMajorRewrite = deriveAcceptedWithoutMajorRewrite(events, files, churnThreshold);
  return {
    version: 1,
    run_id: runId,
    mode: 'shadow',
    source: 'codex-transcript',
    transcript_path: relativeRepoPath(rootDir, transcriptPath),
    evidence: evidenceRecord
      ? {
          artifact_path: evidenceRecord.artifact_path ?? null,
          timestamp: evidenceRecord.timestamp ?? null,
          affected_nodes: evidenceRecord.affected_nodes ?? [],
          affected_lanes: evidenceRecord.affected_lanes ?? [],
          policy_results: evidenceRecord.policy_results ?? [],
        }
      : null,
    prefilled_outcome: {
      accepted_without_major_rewrite: acceptedWithoutMajorRewrite,
      reviewer_confidence: 'unknown',
    },
    prefilled_measurements: {
      time_to_green_minutes: timeToGreenMinutes,
      override_count: countOverrides(events),
      false_positive_rules: [],
      missed_issues: [],
    },
    files,
    notes: [],
    missing_confirmation_fields: [
      ...(acceptedWithoutMajorRewrite === null ? ['accepted_without_major_rewrite'] : []),
      'required_followup',
      ...(timeToGreenMinutes === null ? ['time_to_green_minutes'] : []),
    ],
  };
}

export function observeCodexEval({ transcriptPath, evidencePath, rootDir, outputPath, churnThreshold = 0.3 }) {
  const resolvedTranscriptPath = resolve(rootDir, transcriptPath);
  const transcript = JSON.parse(readFileSync(resolvedTranscriptPath, 'utf8'));
  const evidenceRecord = evidencePath && existsSync(resolve(rootDir, evidencePath))
    ? JSON.parse(readFileSync(resolve(rootDir, evidencePath), 'utf8'))
    : null;
  const draft = buildCodexEvalDraft({
    transcript,
    transcriptPath: resolvedTranscriptPath,
    evidenceRecord,
    rootDir,
    churnThreshold,
  });
  const artifactPath = resolve(rootDir, outputPath ?? `.veritas/eval-drafts/${draft.run_id}.json`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return { draft, artifactPath: relativeRepoPath(rootDir, artifactPath) };
}
