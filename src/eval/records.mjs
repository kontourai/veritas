import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadTeamProfile, loadEvidenceArtifact, loadEvalDraftArtifact } from '../load.mjs';
import { relativeRepoPath } from '../paths.mjs';
import {
  buildEvalRecord,
  buildEvalDraft,
  buildEvalRecordCommand,
  validateEvalDraftContext,
  writeEvalArtifact,
  appendEvalHistory,
  writeEvalDraftArtifact,
} from './loop.mjs';
import { updateRunEvalSummary } from '../surface/dashboard.mjs';
import {
  buildEvalMarkdownSummary,
  buildEvalDraftMarkdownSummary,
  mergeEvalRecordOptions,
  resolveVeritasPaths,
} from '../report.mjs';

export function generateEvalDraft(options = {}, defaults = {}) {
  const { rootDir, teamProfilePath } = resolveVeritasPaths(options, defaults);
  const evidencePath = options.evidencePath
    ? resolve(rootDir, options.evidencePath)
    : undefined;

  if (!rootDir || !teamProfilePath) {
    throw new Error('Veritas eval draft requires rootDir and teamProfilePath');
  }
  if (!evidencePath) {
    throw new Error('veritas eval draft requires --evidence <path>');
  }

  const evidenceRecord = loadEvidenceArtifact(evidencePath);
  const teamProfile = loadTeamProfile(teamProfilePath);
  const record = buildEvalDraft({
    evidenceRecord,
    evidencePath,
    teamProfile,
    options,
    rootDir,
  });
  const artifactPath = writeEvalDraftArtifact(
    record,
    rootDir,
    options.outputPath,
    options.force ?? false,
  );
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const suggestedRecordCommand = buildEvalRecordCommand(relativeArtifactPath, record);
  const markdownSummary = buildEvalDraftMarkdownSummary(
    record,
    relativeArtifactPath,
    suggestedRecordCommand,
  );

  return {
    rootDir,
    teamProfile,
    record,
    artifactPath: relativeArtifactPath,
    suggestedRecordCommand,
    markdownSummary,
  };
}

export function generateEvalRecord(options = {}, defaults = {}) {
  const { rootDir, teamProfilePath } = resolveVeritasPaths(options, defaults);
  if (!rootDir || !teamProfilePath) {
    throw new Error('Veritas eval record requires rootDir and teamProfilePath');
  }
  if (options.evidencePath && options.draftPath) {
    throw new Error('veritas eval record accepts either --evidence or --draft, not both');
  }
  if (!options.evidencePath && !options.draftPath) {
    throw new Error('veritas eval record requires --evidence <path> or --draft <path>');
  }

  const teamProfile = loadTeamProfile(teamProfilePath);
  const draft = options.draftPath
    ? loadEvalDraftArtifact(resolve(rootDir, options.draftPath))
    : null;
  if (draft) {
    validateEvalDraftContext({
      draftPath: resolve(rootDir, options.draftPath),
      draftRecord: draft,
      rootDir,
      teamProfile,
    });
  }
  const evidencePath = options.evidencePath
    ? resolve(rootDir, options.evidencePath)
    : resolve(rootDir, draft.evidence.artifact_path);
  const { data: evidenceRecord, raw: evidenceRaw } = loadEvidenceArtifact(evidencePath, {
    includeRaw: true,
  });
  const record = buildEvalRecord({
    evidenceRecord,
    evidenceRaw,
    evidencePath,
    teamProfile,
    options: mergeEvalRecordOptions(options, draft),
    rootDir,
  });
  const artifactPath = writeEvalArtifact(
    record,
    rootDir,
    options.outputPath,
    options.force ?? false,
  );
  const historyPath = appendEvalHistory(record, rootDir);

  // Patch the run snapshot with a generic eval summary so Surface can display it
  updateRunEvalSummary(rootDir, record.run_id, buildEvalSummary(record));

  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const relativeHistoryPath = relative(rootDir, historyPath).replaceAll('\\', '/');
  const markdownSummary = buildEvalMarkdownSummary(record, relativeArtifactPath);

  return {
    rootDir,
    teamProfile,
    record,
    artifactPath: relativeArtifactPath,
    historyPath: relativeHistoryPath,
    markdownSummary,
  };
}

/**
 * Maps a Veritas eval record to the generic Surface EvalSummary schema.
 * Veritas-specific fields that don't fit the standard shape go into metadata.
 */
function buildEvalSummary(record) {
  const outcome = record.outcome ?? {};
  const measurements = record.measurements ?? {};
  const confidence = outcome.reviewer_confidence === 'unknown'
    ? undefined
    : outcome.reviewer_confidence;
  const genericOutcome = outcome.accepted_without_major_rewrite === true
    ? 'accepted'
    : (outcome.required_followup === true ? 'rejected' : 'accepted-with-changes');
  const falsePositiveCount = (measurements.false_positive_rules ?? []).length || undefined;
  const missedIssueCount = (measurements.missed_issues ?? []).length || undefined;
  const timeToResolutionMinutes = typeof measurements.time_to_green_minutes === 'number'
    ? measurements.time_to_green_minutes
    : undefined;
  return {
    reviewed: true,
    reviewedAt: record.reviewed_at ?? record.created_at ?? new Date().toISOString(),
    ...(confidence !== undefined ? { confidence } : {}),
    outcome: genericOutcome,
    ...(falsePositiveCount !== undefined ? { falsePositiveCount } : {}),
    ...(missedIssueCount !== undefined ? { missedIssueCount } : {}),
    ...(timeToResolutionMinutes !== undefined ? { timeToResolutionMinutes } : {}),
    ...(record.notes?.length ? { notes: record.notes } : {}),
    metadata: {
      requiredFollowup: outcome.required_followup,
      overrideCount: measurements.override_count,
    },
  };
}

function averageNumber(values) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function incrementCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function formatAverage(value, suffix = '') {
  return value === null ? 'n/a' : `${Number(value.toFixed(1))}${suffix}`;
}

function sparkline(values) {
  const ticks = '._:-=+*#';
  if (values.length === 0) return '';
  return values
    .map((value) => ticks[Math.max(0, Math.min(ticks.length - 1, Math.round(value * (ticks.length - 1))))])
    .join('');
}

function buildRuleTrend(records) {
  const lastThirty = records.slice(-30);
  const byRule = new Map();
  for (let index = 0; index < lastThirty.length; index += 1) {
    for (const result of lastThirty[index].policy_results ?? []) {
      const entry = byRule.get(result.rule_id) ?? {
        rule_id: result.rule_id,
        runs: 0,
        passes: 0,
        failures: 0,
        openFailureAt: null,
        mttr_runs: null,
        series: [],
      };
      entry.runs += 1;
      if (result.passed === true) {
        entry.passes += 1;
        entry.series.push(1);
        if (entry.openFailureAt !== null) {
          const mttr = index - entry.openFailureAt;
          entry.mttr_runs = entry.mttr_runs === null ? mttr : Math.round((entry.mttr_runs + mttr) / 2);
          entry.openFailureAt = null;
        }
      } else if (result.passed === false) {
        entry.failures += 1;
        entry.series.push(0);
        if (entry.openFailureAt === null) entry.openFailureAt = index;
      } else {
        entry.series.push(0.5);
      }
      byRule.set(result.rule_id, entry);
    }
  }
  return [...byRule.values()]
    .map((entry) => ({
      ...entry,
      pass_rate: entry.runs === 0 ? null : entry.passes / entry.runs,
      sparkline: sparkline(entry.series),
    }))
    .sort((left, right) => (left.pass_rate ?? 1) - (right.pass_rate ?? 1) || right.failures - left.failures);
}

export function generateEvalSummary(options = {}, defaults = {}) {
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const historyPath = resolve(rootDir, '.veritas/evals/history.jsonl');
  if (!existsSync(historyPath)) {
    return {
      rootDir,
      historyPath: relativeRepoPath(rootDir, historyPath),
      total: 0,
      accepted: 0,
      requiredRewrite: 0,
      averageTimeToGreenMinutes: null,
      averageOverrideCount: null,
      confidenceCounts: {},
      mostFlaggedRule: null,
      markdownSummary: 'No Veritas eval history found.\n',
    };
  }

  const records = readFileSync(historyPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const lastRecords = records.slice(-10);
  const accepted = lastRecords.filter((record) => record.accepted === true).length;
  const requiredRewrite = lastRecords.length - accepted;
  const confidenceCounts = new Map();
  const flaggedRuleCounts = new Map();
  const overrideRuleCounts = new Map();

  for (const record of lastRecords) {
    incrementCount(confidenceCounts, record.confidence ?? 'unknown');
    for (const ruleId of record.false_positive_rules ?? []) {
      incrementCount(flaggedRuleCounts, ruleId);
    }
    for (const override of record.overrides ?? []) {
      incrementCount(overrideRuleCounts, override.ruleId);
    }
  }

  const sortedRules = [...flaggedRuleCounts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const averageTimeToGreenMinutes = averageNumber(
    lastRecords
      .map((record) => record.time_to_green_min)
      .filter((value) => typeof value === 'number' && !Number.isNaN(value)),
  );
  const averageOverrideCount = averageNumber(
    lastRecords
      .map((record) => record.override_count)
      .filter((value) => typeof value === 'number' && !Number.isNaN(value)),
  );
  const confidenceSummary = [...confidenceCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([confidence, count]) => `${confidence} (${count})`)
    .join(', ');
  const mostFlaggedRule = sortedRules.length > 0
    ? { rule_id: sortedRules[0][0], count: sortedRules[0][1] }
    : null;
  const overrideFrequency = [...overrideRuleCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([rule_id, count]) => ({ rule_id, count }));
  const lines = [
    `Last ${lastRecords.length} evals: ${accepted} accepted, ${requiredRewrite} required rewrite`,
    `Avg time to green: ${formatAverage(averageTimeToGreenMinutes, ' min')} | Avg overrides: ${formatAverage(averageOverrideCount)} | Confidence: ${confidenceSummary || 'n/a'}`,
    `Most flagged rule: ${mostFlaggedRule ? `${mostFlaggedRule.rule_id} (${mostFlaggedRule.count})` : 'n/a'}`,
    `Override frequency: ${overrideFrequency.length > 0 ? overrideFrequency.map((entry) => `${entry.rule_id} (${entry.count})`).join(', ') : 'n/a'}`,
  ];
  const ruleTrend = buildRuleTrend(records);
  if (ruleTrend.length > 0) {
    lines.push(
      `Worst rule trend: ${ruleTrend
        .slice(0, 3)
        .map((rule) => `${rule.rule_id} ${Math.round((rule.pass_rate ?? 0) * 100)}% ${rule.sparkline}`)
        .join(' | ')}`,
    );
  }

  return {
    rootDir,
    historyPath: relativeRepoPath(rootDir, historyPath),
    total: lastRecords.length,
    accepted,
    requiredRewrite,
    averageTimeToGreenMinutes,
    averageOverrideCount,
    confidenceCounts: Object.fromEntries(confidenceCounts),
    mostFlaggedRule,
    overrideFrequency,
    ruleTrend,
    markdownSummary: `${lines.join('\n')}\n`,
  };
}
