import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function historyPath(rootDir) {
  return resolve(rootDir, '.veritas/runs/history.jsonl');
}

export function readRunHistory(rootDir) {
  const path = historyPath(rootDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function appendRunHistory(rootDir, entry) {
  const path = historyPath(rootDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  return path;
}

export function deriveTimeToGreenFromRunHistory(rootDir, { actor, currentStatus, finishedAt }) {
  if (currentStatus !== 'pass') return null;
  const currentFinishedAt = Date.parse(finishedAt);
  if (!Number.isFinite(currentFinishedAt)) return null;
  const history = readRunHistory(rootDir).filter((entry) => (entry.actor ?? 'unknown') === actor);
  const lastFailure = [...history].reverse().find((entry) => entry.status === 'fail');
  if (!lastFailure) return null;
  const failedAt = Date.parse(lastFailure.finished_at ?? lastFailure.started_at);
  if (!Number.isFinite(failedAt) || failedAt > currentFinishedAt) return null;
  return Math.round(((currentFinishedAt - failedAt) / 60000) * 100) / 100;
}
