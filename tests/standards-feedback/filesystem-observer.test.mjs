import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendRunHistory,
  observeFilesystemStandardsFeedback,
  writeBootstrapStarterKit,
} from '../../src/index.mjs';
import { commitAll, initCommittedRepo } from '../helpers.mjs';

function bootstrapRepo() {
  const rootDir = initCommittedRepo('veritas-fs-observer-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  writeBootstrapStarterKit({ rootDir, projectName: 'fs-observer-fixture', evidenceCheck: 'npm test', force: true });
  commitAll(rootDir, 'Bootstrap Veritas');
  return rootDir;
}

test('filesystem observer infers standards feedback fields without session log', () => {
  const rootDir = bootstrapRepo();
  appendRunHistory(rootDir, {
    run_id: 'fail-run',
    started_at: '2026-05-10T00:00:00.000Z',
    finished_at: '2026-05-10T00:00:00.000Z',
    status: 'fail',
    actor: 'unknown',
  });
  appendRunHistory(rootDir, {
    run_id: 'pass-run',
    started_at: '2026-05-10T00:05:00.000Z',
    finished_at: '2026-05-10T00:05:00.000Z',
    status: 'pass',
    actor: 'unknown',
  });
  mkdirSync(join(rootDir, '.kontourai/veritas/evidence'), { recursive: true });
  mkdirSync(join(rootDir, '.kontourai/veritas/standards-feedback'), { recursive: true });
  writeFileSync(join(rootDir, '.kontourai/veritas/standards-feedback/exceptions.jsonl'), `${JSON.stringify({
    ruleId: 'rule-a',
    reason: 'test',
    actor: 'brian',
    timestamp: '2026-05-10T00:01:00.000Z',
  })}\n`);
  const evidence = {
    record_schema_version: 1,
    run_id: 'pass-run',
    timestamp: '2026-05-10T00:05:00.000Z',
    source_ref: 'working-tree:test',
    source_kind: 'working-tree',
    source_scope: ['staged'],
    components: ['app.src'],
    triggered_evidence_checks: ['src/**'],
    files: ['src/app.mjs'],
  };
  writeFileSync(join(rootDir, '.kontourai/veritas/evidence/pass-run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  execFileSync('git', ['add', '.'], { cwd: rootDir });
  execFileSync('git', ['commit', '-m', 'Evidence'], { cwd: rootDir });

  const result = observeFilesystemStandardsFeedback({
    rootDir,
    evidencePath: '.kontourai/veritas/evidence/pass-run.json',
  });

  assert.equal(result.draft.source, 'filesystem-inferred');
  assert.equal(result.draft.prefilled_measurements.time_to_green_minutes, 5);
  assert.equal(result.draft.prefilled_sources.time_to_green_minutes, 'filesystem-inferred');
  assert.equal(result.draft.prefilled_measurements.exception_count, 1);
  assert.equal(typeof result.draft.prefilled_outcome.accepted_without_major_rewrite, 'boolean');
});

test('filesystem observer scopes time to green to the active run transition', () => {
  const rootDir = bootstrapRepo();
  appendRunHistory(rootDir, {
    run_id: 'old-fail',
    started_at: '2026-05-09T00:00:00.000Z',
    finished_at: '2026-05-09T00:00:00.000Z',
    status: 'fail',
    actor: 'unknown',
  });
  appendRunHistory(rootDir, {
    run_id: 'old-pass',
    started_at: '2026-05-09T00:30:00.000Z',
    finished_at: '2026-05-09T00:30:00.000Z',
    status: 'pass',
    actor: 'unknown',
  });
  appendRunHistory(rootDir, {
    run_id: 'current-fail',
    started_at: '2026-05-10T00:00:00.000Z',
    finished_at: '2026-05-10T00:00:00.000Z',
    status: 'fail',
    actor: 'unknown',
  });
  appendRunHistory(rootDir, {
    run_id: 'current-pass',
    started_at: '2026-05-10T00:04:00.000Z',
    finished_at: '2026-05-10T00:04:00.000Z',
    status: 'pass',
    actor: 'unknown',
  });
  mkdirSync(join(rootDir, '.kontourai/veritas/evidence'), { recursive: true });
  const evidence = {
    record_schema_version: 1,
    run_id: 'current-pass',
    timestamp: '2026-05-10T00:04:00.000Z',
    source_ref: 'working-tree:test',
    source_kind: 'working-tree',
    source_scope: ['staged'],
    components: ['app.src'],
    triggered_evidence_checks: ['src/**'],
    files: ['src/app.mjs'],
  };
  writeFileSync(join(rootDir, '.kontourai/veritas/evidence/current-pass.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const result = observeFilesystemStandardsFeedback({
    rootDir,
    evidencePath: '.kontourai/veritas/evidence/current-pass.json',
  });
  assert.equal(result.draft.prefilled_measurements.time_to_green_minutes, 4);
});

test('filesystem observer rejects draft run ids that would escape output directories', () => {
  const rootDir = bootstrapRepo();
  mkdirSync(join(rootDir, '.kontourai/veritas/evidence'), { recursive: true });
  const evidence = {
    record_schema_version: 1,
    run_id: '../../outside',
    timestamp: '2026-05-10T00:04:00.000Z',
    source_ref: 'working-tree:test',
    source_kind: 'working-tree',
    source_scope: ['staged'],
    components: ['app.src'],
    triggered_evidence_checks: ['src/**'],
    files: ['src/app.mjs'],
  };
  writeFileSync(join(rootDir, '.kontourai/veritas/evidence/unsafe.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  assert.throws(
    () => observeFilesystemStandardsFeedback({
      rootDir,
      evidencePath: '.kontourai/veritas/evidence/unsafe.json',
    }),
    /Standards feedback draft run id may only contain letters, numbers, dot, underscore, and hyphen/,
  );
  assert.equal(existsSync(join(rootDir, 'outside.json')), false);
});
