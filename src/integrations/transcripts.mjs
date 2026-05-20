import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { relativeRepoPath } from '../paths.mjs';
import { defineTranscriptReader } from './contract.mjs';

const REASON_CODES = {
  transcriptSchemaUnrecognized: 'transcript_schema_unrecognized',
  noFailingRunObserved: 'no_failing_run_observed',
  noPassingRunObserved: 'no_passing_run_observed',
  churnThresholdNotApplicable: 'churn_threshold_not_applicable',
};

function heuristicMissing(reason) {
  return { value: null, reason };
}

function parseJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text') return item.text ?? '';
      if (item?.type === 'tool_result') return textFromContent(item.content);
      if (item?.type === 'tool_use') return `${item.name ?? ''} ${JSON.stringify(item.input ?? {})}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractFiles(value) {
  const files = new Set();
  const visit = (item) => {
    if (!item || typeof item !== 'object') return;
    for (const key of ['file_path', 'path']) {
      if (typeof item[key] === 'string') files.add(item[key]);
    }
    for (const key of ['files', 'paths', 'touched_files', 'touchedFiles']) {
      if (Array.isArray(item[key])) {
        for (const file of item[key]) {
          if (typeof file === 'string') files.add(file);
        }
      }
    }
  };
  visit(value);
  if (Array.isArray(value?.content)) {
    for (const item of value.content) visit(item?.input);
  }
  return [...files].sort();
}

function commandFromClaudeToolUse(item) {
  if (item?.name === 'Bash' && typeof item?.input?.command === 'string') return item.input.command;
  return `${item?.name ?? 'tool'} ${JSON.stringify(item?.input ?? {})}`;
}

function classifyCommand(commandText, files = [], raw = {}) {
  if (/\bveritas\s+(?:shadow\s+run|run)\b/.test(commandText) || /\bPASS\b|\bFAIL\b/.test(commandText)) return 'shadow-run';
  if (/VERITAS_OVERRIDE_RULE=|VERITAS_HOOK_SKIP=1/.test(commandText)) return 'override';
  const toolName = raw?.name ?? raw?.tool_name;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(toolName) || files.length > 0 && /edit|write|multiedit/i.test(commandText)) return 'edit';
  return 'tool-call';
}

function exitCodeFromText(commandText) {
  if (/\bFAIL\b/.test(commandText)) return 1;
  if (/\bPASS\b/.test(commandText)) return 0;
  return null;
}

export const ClaudeCodeTranscriptReader = defineTranscriptReader({
  name: 'claude-code',
  canRead(transcriptPath) {
    return extname(transcriptPath) === '.jsonl';
  },
  *readEvents(transcriptPath) {
    for (const entry of parseJsonl(transcriptPath)) {
      const timestamp = entry.timestamp ?? null;
      const content = entry.message?.content;
      if (entry.type === 'assistant' && Array.isArray(content)) {
        for (const item of content.filter((part) => part?.type === 'tool_use')) {
          const commandText = commandFromClaudeToolUse(item);
          const files = extractFiles(item.input);
          yield {
            kind: classifyCommand(commandText, files, item),
            timestamp,
            files,
            commandText,
            exitCode: null,
            raw: entry,
          };
        }
        if (entry.message?.stop_reason === 'end_turn') {
          yield { kind: 'completion', timestamp, files: [], commandText: textFromContent(content), exitCode: null, raw: entry };
        }
        continue;
      }
      if (entry.type === 'user') {
        const commandText = textFromContent(content);
        const files = extractFiles(entry.message ?? {});
        yield {
          kind: classifyCommand(commandText, files, entry),
          timestamp,
          files,
          commandText,
          exitCode: exitCodeFromText(commandText),
          raw: entry,
        };
      }
    }
  },
});

export const CodexTranscriptReader = defineTranscriptReader({
  name: 'codex',
  canRead(transcriptPath) {
    return extname(transcriptPath) === '.json';
  },
  *readEvents(transcriptPath) {
    const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
    const events = Array.isArray(transcript) ? transcript : transcript.events ?? transcript.messages ?? transcript.turns ?? [];
    for (const event of events) {
      const commandText = [event.command, event.cmd, event.content, event.text, event.output, event.message]
        .filter((part) => typeof part === 'string')
        .join('\n');
      const files = [event.files, event.paths, event.touched_files, event.touchedFiles]
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter((file) => typeof file === 'string');
      yield {
        kind: classifyCommand(commandText, files, event),
        timestamp: event.timestamp ?? event.time ?? event.created_at ?? event.createdAt ?? null,
        files,
        commandText,
        exitCode: typeof event.exit_code === 'number' ? event.exit_code : typeof event.exitCode === 'number' ? event.exitCode : exitCodeFromText(commandText),
        raw: { ...event, transcript_run_id: transcript.run_id ?? transcript.session_id ?? null },
      };
    }
  },
});

export const TRANSCRIPT_READERS = [
  ClaudeCodeTranscriptReader,
  CodexTranscriptReader,
];

export function resolveTranscriptReader({ tool = 'auto', transcriptPath }) {
  if (tool !== 'auto') {
    const reader = TRANSCRIPT_READERS.find((candidate) => candidate.name === tool);
    if (!reader) throw new Error(`No transcript reader registered for tool: ${tool}`);
    return reader;
  }
  const reader = TRANSCRIPT_READERS.find((candidate) => candidate.canRead(transcriptPath));
  if (!reader) throw new Error(`No transcript reader could read transcript: ${transcriptPath}`);
  return reader;
}

function eventTime(event) {
  const millis = Date.parse(event.timestamp);
  return Number.isFinite(millis) ? millis : null;
}

function isPassing(event) {
  return event.exitCode === 0 || /\bPASS\b/.test(event.commandText ?? '') && !/\bFAIL\b/.test(event.commandText ?? '');
}

function isFailing(event) {
  return (typeof event.exitCode === 'number' && event.exitCode !== 0) || /\bFAIL\b/.test(event.commandText ?? '');
}

function deriveTimeToGreen(events) {
  if (events.length === 0) return heuristicMissing(REASON_CODES.transcriptSchemaUnrecognized);
  const firstFailure = events.find((event) => event.kind === 'shadow-run' && isFailing(event) && eventTime(event) !== null);
  if (!firstFailure) return heuristicMissing(REASON_CODES.noFailingRunObserved);
  const failedAt = eventTime(firstFailure);
  const firstPass = events.find((event) => event.kind === 'shadow-run' && isPassing(event) && eventTime(event) !== null && eventTime(event) >= failedAt);
  if (!firstPass) return heuristicMissing(REASON_CODES.noPassingRunObserved);
  return Math.round(((eventTime(firstPass) - failedAt) / 60000) * 100) / 100;
}

function deriveAcceptedWithoutMajorRewrite(events, files, threshold) {
  if (events.length === 0) return heuristicMissing(REASON_CODES.transcriptSchemaUnrecognized);
  if (files.length === 0) return heuristicMissing(REASON_CODES.churnThresholdNotApplicable);
  const finishIndex = events.findLastIndex((event) => event.kind === 'shadow-run');
  const postRunEdits = events.slice(finishIndex + 1).filter((event) => event.kind === 'edit' && event.files.some((file) => files.includes(file)));
  const changedLines = postRunEdits.reduce((total, event) => total + Number(event.raw?.line_churn ?? event.raw?.lineChurn ?? event.raw?.changed_lines ?? event.raw?.changedLines ?? 0), 0);
  const baseline = Math.max(1, Number(events.find((event) => event.kind === 'shadow-run')?.raw?.reported_lines ?? 100));
  return changedLines / baseline <= threshold;
}

export function buildEvalDraftFromNormalizedEvents({
  events,
  transcriptPath,
  evidenceRecord = null,
  rootDir,
  source,
  churnThreshold = 0.3,
}) {
  const files = [...new Set([...(evidenceRecord?.files ?? []), ...events.flatMap((event) => event.files)])].sort();
  const runId = evidenceRecord?.run_id ?? events.find((event) => event.raw?.transcript_run_id)?.raw?.transcript_run_id ?? `${source}-${Date.now()}`;
  const transcriptRelativePath = relativeRepoPath(rootDir, transcriptPath);
  const timestamp = evidenceRecord?.timestamp ?? new Date().toISOString();
  const timeToGreenMinutes = deriveTimeToGreen(events);
  const acceptedWithoutMajorRewrite = deriveAcceptedWithoutMajorRewrite(events, files, churnThreshold);
  return {
    version: 1,
    run_id: runId,
    team_profile_id: `${source}-observed`,
    mode: 'shadow',
    source: `${source}-transcript`,
    transcript_path: transcriptRelativePath,
    evidence: evidenceRecord
      ? {
          artifact_path: evidenceRecord.artifact_path ?? null,
          artifact_digest: evidenceRecord.artifact_digest ?? createHash('sha256').update(JSON.stringify(evidenceRecord)).digest('hex'),
          timestamp: evidenceRecord.timestamp ?? null,
          source_ref: evidenceRecord.source_ref ?? `${source}-transcript`,
          source_kind: evidenceRecord.source_kind ?? 'explicit-files',
          source_scope: evidenceRecord.source_scope ?? ['transcript'],
          components: evidenceRecord.components ?? [],
          triggered_proofs: evidenceRecord.triggered_proofs ?? [],
        }
      : {
          artifact_path: transcriptRelativePath,
          artifact_digest: createHash('sha256').update(JSON.stringify(events)).digest('hex'),
          timestamp,
          source_ref: transcriptRelativePath,
          source_kind: 'explicit-files',
          source_scope: ['transcript'],
          components: [],
          triggered_proofs: [],
        },
    governance: {
      surface_touched: false,
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
      override_count: events.filter((event) => event.kind === 'override' || /VERITAS_[A-Z0-9_]+|--skip-proof/.test(event.commandText ?? '')).length,
      false_positive_rules: [],
      missed_issues: [],
    },
    files,
    normalized_event_count: events.length,
    notes: [],
    missing_confirmation_fields: [
      ...(typeof acceptedWithoutMajorRewrite === 'object' ? ['accepted_without_major_rewrite'] : []),
      'required_followup',
      ...(typeof timeToGreenMinutes === 'object' ? ['time_to_green_minutes'] : []),
    ],
  };
}

export function observeTranscriptEval({ transcriptPath, evidencePath, rootDir, outputPath, tool = 'auto', churnThreshold = 0.3, verbose = false }) {
  const resolvedTranscriptPath = resolve(rootDir, transcriptPath);
  const reader = resolveTranscriptReader({ tool, transcriptPath: resolvedTranscriptPath });
  const events = [...reader.readEvents(resolvedTranscriptPath)];
  const evidenceRecord = evidencePath && existsSync(resolve(rootDir, evidencePath))
    ? JSON.parse(readFileSync(resolve(rootDir, evidencePath), 'utf8'))
    : null;
  const draft = buildEvalDraftFromNormalizedEvents({
    events,
    transcriptPath: resolvedTranscriptPath,
    evidenceRecord,
    rootDir,
    source: reader.name,
    churnThreshold,
  });
  const artifactPath = resolve(rootDir, outputPath ?? `.veritas/eval-drafts/${draft.run_id}.json`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return {
    draft,
    artifactPath: relativeRepoPath(rootDir, artifactPath),
    reader: reader.name,
    ...(verbose ? { heuristics: { events: events.length, time_to_green_minutes: draft.prefilled_measurements.time_to_green_minutes, accepted_without_major_rewrite: draft.prefilled_outcome.accepted_without_major_rewrite } } : {}),
  };
}
