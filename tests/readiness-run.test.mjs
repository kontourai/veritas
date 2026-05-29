import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBootstrapStarterKit } from '../src/bootstrap.mjs';
import { runMergeReadiness } from '../src/readiness/run.mjs';
import { commitAll, initCommittedRepo } from './helpers.mjs';

test('Merge Readiness run coordinates evidence, report, and draft behind one interface', async () => {
  const rootDir = initCommittedRepo('veritas-readiness-run-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  writeBootstrapStarterKit({
    rootDir,
    projectName: 'readiness-run-fixture',
    evidenceCheck: 'npm test',
    force: true,
  });
  commitAll(rootDir, 'Bootstrap Veritas');

  const result = await runMergeReadiness(
    {
      rootDir,
      runId: 'readiness-run-test',
      workingTree: true,
      force: true,
    },
    { rootDir },
    [],
    { appendHistory: false },
  );

  assert.equal(result.currentStatus, 'pass');
  assert.deepEqual(result.evidenceCheckLabels, ['npm test']);
  assert.equal(result.evidenceCheckResults[0].passed, true);
  assert.equal(result.reportResult.record.run_id, 'readiness-run-test');
  assert.equal(result.draftResult.record.run_id, 'readiness-run-test');
  assert.equal(existsSync(join(rootDir, '.veritas/runs/history.jsonl')), false);
});
