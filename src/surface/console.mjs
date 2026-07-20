import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relativeRepoPath, veritasArtifactRepoPath } from '../paths.mjs';
import { resolveRunArtifactPath } from '../util/run-id.mjs';
import { buildSurfaceConsoleReadModel } from './console-read-model.mjs';

const CONSOLE_DIR = veritasArtifactRepoPath('surface');

export { buildSurfaceConsoleReadModel } from './console-read-model.mjs';

export function writeSurfaceConsoleReadModel(record, rootDir, options = {}) {
  const readModel = buildSurfaceConsoleReadModel(record, options);
  const consoleDir = resolve(rootDir, CONSOLE_DIR);
  mkdirSync(consoleDir, { recursive: true });
  const path = resolveRunArtifactPath({
    dir: consoleDir,
    runId: record.run_id,
    suffix: '.console.json',
    label: 'Surface console run id',
  });
  writeFileSync(path, `${JSON.stringify(readModel, null, 2)}\n`, 'utf8');
  const indexPath = resolve(consoleDir, 'latest.json');
  writeFileSync(indexPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: 'surface-console-index',
    latestRunId: record.run_id,
    readModelPath: relativeRepoPath(rootDir, path),
    evidenceArtifactPath: options.evidenceArtifactPath ?? null,
    updatedAt: record.timestamp,
  }, null, 2)}\n`, 'utf8');
  return relativeRepoPath(rootDir, path);
}

/**
 * Patches the standardsFeedbackSummary field in an existing run snapshot.
 * Called by generateStandardsFeedbackRecord after the standards feedback record is written.
 */
export function updateRunStandardsFeedbackSummary(rootDir, runId, standardsFeedbackSummary) {
  const runPath = resolveRunArtifactPath({
    dir: resolve(rootDir, CONSOLE_DIR),
    runId,
    suffix: '.console.json',
    label: 'Surface console run id',
  });
  if (!existsSync(runPath)) return false;
  try {
    const data = JSON.parse(readFileSync(runPath, 'utf8'));
    data.standardsFeedbackSummary = standardsFeedbackSummary;
    writeFileSync(runPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
