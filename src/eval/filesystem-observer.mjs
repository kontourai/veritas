import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { loadEvidenceArtifact } from '../load.mjs';
import { relativeRepoPath } from '../paths.mjs';
import { readRunHistory } from './run-history.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseTime(value) {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function deriveTimeToGreen(rootDir, evidenceRecord) {
  const history = readRunHistory(rootDir)
    .map((entry) => ({
      ...entry,
      finishedTime: parseTime(entry.finished_at ?? entry.started_at),
    }))
    .filter((entry) => entry.finishedTime !== null)
    .sort((left, right) => left.finishedTime - right.finishedTime);
  const runFinishedAt = parseTime(evidenceRecord.timestamp) ?? Date.now();
  let anchorIndex = history.findIndex((entry) => entry.run_id === evidenceRecord.run_id);
  if (anchorIndex < 0) {
    anchorIndex = history.findLastIndex((entry) => entry.finishedTime <= runFinishedAt);
  }
  if (anchorIndex < 0 || history[anchorIndex].status !== 'pass') return 0;

  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.status === 'pass') break;
    if (entry.status === 'fail') {
      return Math.round(((history[anchorIndex].finishedTime - entry.finishedTime) / 60000) * 100) / 100;
    }
  }
  return 0;
}

function readOverrideCount(rootDir, evidenceRecord) {
  const overridePath = resolve(rootDir, '.veritas/evals/overrides.jsonl');
  const fileCount = existsSync(overridePath)
    ? readFileSync(overridePath, 'utf8').split('\n').filter(Boolean).length
    : 0;
  return fileCount + (evidenceRecord.overrides?.length ?? 0);
}

function gitChurnSince(rootDir, sinceIso, files = []) {
  try {
    const args = ['log', `--since=${sinceIso}`, '--numstat', '--format='];
    if (files.length > 0) args.push('--', ...files);
    const output = execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 3)
      .reduce((total, [added, removed]) => total + Number(added || 0) + Number(removed || 0), 0);
  } catch {
    return 0;
  }
}

function acceptedWithoutMajorRewrite(rootDir, evidenceRecord, threshold) {
  const files = evidenceRecord.files ?? [];
  const churn = gitChurnSince(rootDir, evidenceRecord.timestamp, files);
  const baseline = Math.max(1, files.length * 100);
  return churn / baseline <= threshold;
}

export function buildFilesystemEvalDraft({ rootDir, evidenceRecord, evidencePath, churnThreshold = 0.3 }) {
  const relativeEvidencePath = relativeRepoPath(rootDir, evidencePath);
  const evidenceRaw = readFileSync(evidencePath, 'utf8');
  return {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: 'filesystem-observed',
    mode: 'shadow',
    source: 'filesystem-inferred',
    evidence: {
      artifact_path: relativeEvidencePath,
      artifact_digest: digest(evidenceRaw),
      timestamp: evidenceRecord.timestamp,
      source_ref: evidenceRecord.source_ref,
      source_kind: evidenceRecord.source_kind,
      source_scope: evidenceRecord.source_scope ?? [],
      affected_nodes: evidenceRecord.affected_nodes ?? [],
      affected_lanes: evidenceRecord.affected_lanes ?? [],
    },
    governance: {
      surface_touched: false,
      classification: 'unknown',
      human_review_required: false,
      changed_paths: [],
    },
    reviewer_confidence_scale: ['low', 'medium', 'high', 'unknown'],
    prefilled_outcome: {
      accepted_without_major_rewrite: acceptedWithoutMajorRewrite(rootDir, evidenceRecord, churnThreshold),
      reviewer_confidence: 'unknown',
    },
    prefilled_measurements: {
      time_to_green_minutes: deriveTimeToGreen(rootDir, evidenceRecord),
      override_count: readOverrideCount(rootDir, evidenceRecord),
      false_positive_rules: [],
      missed_issues: [],
    },
    prefilled_sources: {
      accepted_without_major_rewrite: 'filesystem-inferred',
      time_to_green_minutes: 'filesystem-inferred',
      override_count: 'filesystem-inferred',
    },
    files: evidenceRecord.files ?? [],
    notes: ['Derived from filesystem artifacts because no transcript reader was available.'],
    missing_confirmation_fields: ['required_followup'],
  };
}

export function observeFilesystemEval({ rootDir, evidencePath, outputPath, churnThreshold = 0.3 }) {
  if (!evidencePath) {
    throw new Error('veritas eval observe --tool none requires --evidence <path>');
  }
  const resolvedEvidencePath = resolve(rootDir, evidencePath);
  const evidenceRecord = loadEvidenceArtifact(resolvedEvidencePath);
  const draft = buildFilesystemEvalDraft({
    rootDir,
    evidenceRecord,
    evidencePath: resolvedEvidencePath,
    churnThreshold,
  });
  const artifactPath = resolve(rootDir, outputPath ?? `.veritas/eval-drafts/${draft.run_id}.json`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return {
    draft,
    artifactPath: relativeRepoPath(rootDir, artifactPath),
  };
}
