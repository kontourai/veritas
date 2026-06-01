import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadRepoMap, loadRepoStandards } from './load.mjs';
import { resolveVeritasPaths } from './report.mjs';
import { createAttestation } from './attestations.mjs';

export const RECOMMENDATION_STATUS = {
  proposed: 'proposed',
  accepted: 'accepted',
  rejected: 'rejected',
};

function recommendationsDir(rootDir) {
  return resolve(rootDir, '.veritas/recommendations');
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function readHistory(rootDir) {
  const path = resolve(rootDir, '.veritas/standards-feedback/history.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function recommendationPath(rootDir, id) {
  return resolve(recommendationsDir(rootDir), `${safeId(id)}.recommendation.json`);
}

export function listRecommendations({ rootDir, status = 'proposed' } = {}) {
  const dir = recommendationsDir(rootDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.recommendation.json'))
    .map((file) => JSON.parse(readFileSync(resolve(dir, file), 'utf8')))
    .filter((recommendation) => status === 'all' || recommendation.status === status)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function loadRecommendation(rootDir, id) {
  const path = recommendationPath(rootDir, id);
  if (!existsSync(path)) throw new Error(`Recommendation not found: ${id}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildRecommendation({ type, target, rationale, evidenceRunIds, diff, now }) {
  const id = `recommendation.${safeId(type)}.${safeId(target)}.${digest({ type, target, diff })}`;
  return {
    schemaVersion: 1,
    id,
    type,
    status: RECOMMENDATION_STATUS.proposed,
    target,
    createdAt: now,
    updatedAt: now,
    rationale,
    evidenceRunIds,
    surface: {
      claimId: `veritas.recommendation.${id}`,
      status: 'proposed',
    },
    diff,
  };
}

function uniqueById(recommendations) {
  const seen = new Set();
  return recommendations.filter((recommendation) => {
    if (seen.has(recommendation.id)) return false;
    seen.add(recommendation.id);
    return true;
  });
}

function recommendationCooldownKey(recommendation) {
  return `${recommendation.type}:${recommendation.target}`;
}

function recentRejectedRecommendationKeys(rootDir, now, cooldownDays) {
  const nowMs = Date.parse(now);
  const cooldownMs = cooldownDays * 86_400_000;
  return new Set(
    listRecommendations({ rootDir, status: RECOMMENDATION_STATUS.rejected })
      .filter((recommendation) => {
        const updatedMs = Date.parse(recommendation.updatedAt ?? recommendation.createdAt ?? '');
        return Number.isFinite(updatedMs) && Number.isFinite(nowMs) && nowMs - updatedMs <= cooldownMs;
      })
      .map(recommendationCooldownKey),
  );
}

export function generateRuleRecommendations({
  rootDir,
  repoStandardsPath,
  repoMapPath,
  now = new Date().toISOString(),
  inactiveRunThreshold = 5,
  rejectionCooldownDays = 14,
} = {}) {
  const { repoStandardsPath: resolvedRepoStandardsPath, repoMapPath: resolvedRepoMapPath } =
    resolveVeritasPaths({ rootDir, repoStandardsPath, repoMapPath }, { rootDir });
  const repoStandards = loadRepoStandards(resolvedRepoStandardsPath);
  const repoMap = loadRepoMap(resolvedRepoMapPath);
  const history = readHistory(rootDir);
  const recommendations = [];

  for (const rule of repoStandards.rules ?? []) {
    const ruleRecords = history.filter((record) =>
      (record.policy_results ?? []).some((result) => result.rule_id === rule.id),
    );
    const failedRecords = ruleRecords.filter((record) =>
      (record.policy_results ?? []).some((result) => result.rule_id === rule.id && result.passed === false),
    );
    const exceptionRecords = failedRecords.filter((record) =>
      (record.exceptions ?? []).some((exception) => exception.ruleId === rule.id),
    );
    if (failedRecords.length > 0 && exceptionRecords.length / failedRecords.length > 0.4) {
      recommendations.push(buildRecommendation({
        type: 'rule-enforcement-relaxation',
        target: rule.id,
        now,
        evidenceRunIds: exceptionRecords.map((record) => record.run_id),
        rationale: `Rule ${rule.id} failed ${failedRecords.length} time(s) and was accepted by exception ${exceptionRecords.length} time(s).`,
        diff: {
          repoStandardsPath: relative(rootDir, resolvedRepoStandardsPath).replaceAll('\\', '/'),
          ruleId: rule.id,
          changes: {
            enforcement: 'lint',
            stage: rule.stage === 'block' ? 'warn' : rule.stage,
          },
        },
      }));
    }

    const warnFailures = failedRecords.filter((record) =>
      (record.policy_results ?? []).some((result) => result.rule_id === rule.id && result.stage === 'warn') &&
      record.required_followup === false,
    );
    if (warnFailures.length > 0) {
      recommendations.push(buildRecommendation({
        type: 'rule-stage-downgrade',
        target: rule.id,
        now,
        evidenceRunIds: warnFailures.map((record) => record.run_id),
        rationale: `Warn rule ${rule.id} failed without follow-up edits in ${warnFailures.length} standards feedback run(s).`,
        diff: {
          repoStandardsPath: relative(rootDir, resolvedRepoStandardsPath).replaceAll('\\', '/'),
          ruleId: rule.id,
          changes: { stage: 'advise' },
        },
      }));
    }

    if (history.length >= inactiveRunThreshold && failedRecords.length === 0) {
      recommendations.push(buildRecommendation({
        type: 'rule-retirement',
        target: rule.id,
        now,
        evidenceRunIds: history.slice(-inactiveRunThreshold).map((record) => record.run_id),
        rationale: `Rule ${rule.id} did not fail in the last ${inactiveRunThreshold} standards feedback run(s).`,
        diff: {
          repoStandardsPath: relative(rootDir, resolvedRepoStandardsPath).replaceAll('\\', '/'),
          ruleId: rule.id,
          changes: { x_status: 'deprecated' },
        },
      }));
    }
  }

  const unmatchedCounts = new Map();
  for (const record of history) {
    for (const file of record.unresolved_files ?? []) {
      unmatchedCounts.set(file, (unmatchedCounts.get(file) ?? 0) + 1);
    }
  }
  for (const [file, count] of unmatchedCounts.entries()) {
    if (count < 2) continue;
    recommendations.push(buildRecommendation({
      type: 'surface-node-addition',
      target: file,
      now,
      evidenceRunIds: history.filter((record) => (record.unresolved_files ?? []).includes(file)).map((record) => record.run_id),
      rationale: `Path ${file} matched no work area in ${count} feedback record(s).`,
      diff: {
        repoMapPath: relative(rootDir, resolvedRepoMapPath).replaceAll('\\', '/'),
        node: {
          id: `proposed.${safeId(file)}`,
          label: file,
          kind: 'product-area',
          patterns: [file],
          owners: ['shared'],
          boundary: 'advisory',
        },
      },
    }));
  }

  const rejectedKeys = recentRejectedRecommendationKeys(rootDir, now, rejectionCooldownDays);
  return uniqueById(recommendations).filter((recommendation) => !rejectedKeys.has(recommendationCooldownKey(recommendation)));
}

export function writeGeneratedRecommendations({ rootDir, recommendations, force = false } = {}) {
  const dir = recommendationsDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const recommendation of recommendations) {
    const path = recommendationPath(rootDir, recommendation.id);
    if (existsSync(path) && !force) continue;
    writeFileSync(path, `${JSON.stringify(recommendation, null, 2)}\n`, 'utf8');
    written.push(relative(rootDir, path).replaceAll('\\', '/'));
  }
  return written;
}

export function generateAndWriteRecommendations(options = {}, defaults = {}) {
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const recommendations = generateRuleRecommendations({ ...options, rootDir });
  const written = options.write === false
    ? []
    : writeGeneratedRecommendations({ rootDir, recommendations, force: options.force ?? false });
  return { rootDir, recommendations, written };
}

export function applyRecommendation({ rootDir, id, actor, accept, reject, message = '' } = {}) {
  const recommendation = loadRecommendation(rootDir, id);
  if (recommendation.status !== RECOMMENDATION_STATUS.proposed) {
    throw new Error(`Recommendation ${id} is already ${recommendation.status}`);
  }
  if (accept === reject) throw new Error('Choose exactly one of --accept or --reject');

  const updated = {
    ...recommendation,
    status: accept ? RECOMMENDATION_STATUS.accepted : RECOMMENDATION_STATUS.rejected,
    updatedAt: new Date().toISOString(),
    decision: {
      actor,
      message,
    },
  };

  if (accept && recommendation.diff?.ruleId && recommendation.diff?.repoStandardsPath) {
    const repoStandardsPath = resolve(rootDir, recommendation.diff.repoStandardsPath);
    const repoStandards = JSON.parse(readFileSync(repoStandardsPath, 'utf8'));
    const rule = (repoStandards.rules ?? []).find((item) => item.id === recommendation.diff.ruleId);
    if (!rule) throw new Error(`Requirement not found for recommendation ${id}: ${recommendation.diff.ruleId}`);
    Object.assign(rule, recommendation.diff.changes ?? {});
    writeFileSync(repoStandardsPath, `${JSON.stringify(repoStandards, null, 2)}\n`, 'utf8');
    updated.attestation = createAttestation({
      rootDir,
      kind: 'recommendation-acceptance',
      actor,
      notes: message || `Accepted recommendation ${id}`,
    }).attestation;
  }

  const path = recommendationPath(rootDir, id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}
