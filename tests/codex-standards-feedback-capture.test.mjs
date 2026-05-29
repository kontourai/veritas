import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildCodexStandardsFeedbackDraft } from '../src/index.mjs';
import { repoRootDir, readJson } from './helpers.mjs';

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'veritas-codex-feedback-'));
}

test('Codex standards feedback capture derives time to green and accepted result', () => {
  const rootDir = tempRoot();
  const sessionLogPath = join(rootDir, 'session.json');
  const sessionLog = {
    session_id: 'codex-green',
    events: [
      {
        timestamp: '2026-05-09T10:00:00.000Z',
        command: 'npm exec -- veritas readiness',
        exit_code: 1,
        files: ['src/index.mjs'],
        reported_lines: 100,
      },
      {
        timestamp: '2026-05-09T10:06:00.000Z',
        command: 'npm exec -- veritas readiness',
        exit_code: 0,
        files: ['src/index.mjs'],
        reported_lines: 100,
      },
      {
        timestamp: '2026-05-09T10:07:00.000Z',
        command: 'edit',
        files: ['src/index.mjs'],
        line_churn: 10,
      },
    ],
  };
  writeFileSync(sessionLogPath, `${JSON.stringify(sessionLog, null, 2)}\n`, 'utf8');

  const draft = buildCodexStandardsFeedbackDraft({
    sessionLog,
    sessionLogPath,
    rootDir,
  });

  assert.equal(draft.run_id, 'codex-green');
  assert.equal(draft.prefilled_measurements.time_to_green_minutes, 6);
  assert.equal(draft.prefilled_outcome.accepted_without_major_rewrite, true);
  assert.equal(draft.prefilled_measurements.exception_count, 0);
});

test('Codex standards feedback capture marks major rewrites and CLI writes a draft', () => {
  const rootDir = tempRoot();
  const sessionLogPath = join(rootDir, 'session.json');
  const sessionLog = {
    session_id: 'codex-rewrite',
    events: [
      {
        timestamp: '2026-05-09T10:00:00.000Z',
        command: 'veritas readiness',
        exit_code: 1,
        files: ['src/index.mjs'],
        reported_lines: 100,
      },
      {
        timestamp: '2026-05-09T10:03:00.000Z',
        command: 'VERITAS_SKIP_SURFACE_VALIDATION=1 veritas readiness --skip-evidence-check',
        exit_code: 0,
        files: ['src/index.mjs'],
        reported_lines: 100,
      },
      {
        timestamp: '2026-05-09T10:05:00.000Z',
        command: 'edit',
        files: ['src/index.mjs'],
        line_churn: 45,
      },
    ],
  };
  writeFileSync(sessionLogPath, `${JSON.stringify(sessionLog, null, 2)}\n`, 'utf8');

  const output = execFileSync(
    process.execPath,
    [
      'bin/veritas.mjs',
      'feedback',
      'observe',
      '--root',
      rootDir,
      '--session-log',
      sessionLogPath,
    ],
    {
      cwd: repoRootDir,
      encoding: 'utf8',
    },
  );
  const result = JSON.parse(output);
  const artifactPath = join(rootDir, result.artifactPath);

  assert.equal(result.prefilled_outcome.accepted_without_major_rewrite, false);
  assert.equal(result.prefilled_measurements.time_to_green_minutes, 3);
  assert.equal(result.prefilled_measurements.exception_count, 1);
  assert.equal(existsSync(artifactPath), true);
  assert.equal(readJson(artifactPath).run_id, 'codex-rewrite');
});

test('Codex standards feedback capture records reason when session log schema is unrecognized', () => {
  const rootDir = tempRoot();
  const sessionLogPath = join(rootDir, 'session.json');
  const sessionLog = { session_id: 'codex-empty', unexpected: true };

  const draft = buildCodexStandardsFeedbackDraft({ sessionLog, sessionLogPath, rootDir });

  assert.deepEqual(draft.prefilled_measurements.time_to_green_minutes, {
    value: null,
    reason: 'session_log_schema_unrecognized',
  });
  assert.deepEqual(draft.prefilled_outcome.accepted_without_major_rewrite, {
    value: null,
    reason: 'session_log_schema_unrecognized',
  });
});

test('Codex standards feedback capture records reason when no failing run is observed', () => {
  const rootDir = tempRoot();
  const sessionLogPath = join(rootDir, 'session.json');
  const sessionLog = {
    session_id: 'codex-no-fail',
    events: [
      {
        timestamp: '2026-05-09T10:00:00.000Z',
        command: 'veritas readiness',
        exit_code: 0,
        files: ['src/index.mjs'],
      },
    ],
  };

  const draft = buildCodexStandardsFeedbackDraft({ sessionLog, sessionLogPath, rootDir });

  assert.deepEqual(draft.prefilled_measurements.time_to_green_minutes, {
    value: null,
    reason: 'no_failing_run_observed',
  });
});

test('Codex standards feedback capture records reason when no passing run is observed', () => {
  const rootDir = tempRoot();
  const sessionLogPath = join(rootDir, 'session.json');
  const sessionLog = {
    session_id: 'codex-no-pass',
    events: [
      {
        timestamp: '2026-05-09T10:00:00.000Z',
        command: 'veritas readiness',
        exit_code: 1,
        files: ['src/index.mjs'],
      },
    ],
  };

  const draft = buildCodexStandardsFeedbackDraft({ sessionLog, sessionLogPath, rootDir });

  assert.deepEqual(draft.prefilled_measurements.time_to_green_minutes, {
    value: null,
    reason: 'no_passing_run_observed',
  });
});

test('Codex standards feedback capture records reason when churn threshold cannot apply', () => {
  const rootDir = tempRoot();
  const sessionLogPath = join(rootDir, 'session.json');
  const sessionLog = {
    session_id: 'codex-no-files',
    events: [
      {
        timestamp: '2026-05-09T10:00:00.000Z',
        command: 'veritas readiness',
        exit_code: 1,
      },
      {
        timestamp: '2026-05-09T10:01:00.000Z',
        command: 'veritas readiness',
        exit_code: 0,
      },
    ],
  };

  const draft = buildCodexStandardsFeedbackDraft({ sessionLog, sessionLogPath, rootDir });

  assert.deepEqual(draft.prefilled_outcome.accepted_without_major_rewrite, {
    value: null,
    reason: 'churn_threshold_not_applicable',
  });
});
