import test from 'node:test';
import hygiene from '@kontourai/veritas/hygiene/oxlint';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRootDir } from './helpers.mjs';
import { tempDir } from './temp-dir.mjs';

function lint(t, name, source, rules) {
  const root = tempDir(t, 'veritas-hygiene-');
  const file = join(root, name);
  writeFileSync(file, source);
  const config = join(root, 'oxlint.json');
  writeFileSync(config, JSON.stringify({
    jsPlugins: [{ name: hygiene.meta.name, specifier: join(repoRootDir, 'examples/code-hygiene/oxlint-plugin.mjs') }],
    categories: { correctness: 'off' }, rules,
  }));
  return spawnSync(join(repoRootDir, 'node_modules/.bin/oxlint'), ['--config', config, '--format', 'json', file], {
    encoding: 'utf8', windowsHide: true,
  });
}

test('real Oxlint catches unexplained lint/type suppressions and accepts reasons', (t) => {
  const rules = { 'repo-hygiene/require-suppression-reason': 'error' };
  const bad = lint(t, 'target.ts', '// @ts-expect-error\nconst value: string = 1;\n', rules);
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stdout, /Say why/);
  const good = lint(t, 'target.ts', '// @ts-expect-error -- Deliberate invalid-type fixture.\nconst value: string = 1;\n', rules);
  assert.equal(good.status, 0, good.stdout + good.stderr);
});

test('real Oxlint distinguishes timer/clock unit violations from fixed time and explicit event completion', (t) => {
  const rules = { 'repo-hygiene/deterministic-unit-tests': 'error' };
  for (const source of ['Date.now();', 'new Date();', 'globalThis.setTimeout(done, 100);', "import { setTimeout as delay } from 'node:timers/promises';"]) {
    const bad = lint(t, 'target.unit.test.ts', source, rules);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /controlled test clock/);
  }
  const good = lint(t, 'target.unit.test.ts', 'const time = new Date(0); await completion;', rules);
  assert.equal(good.status, 0, good.stdout + good.stderr);
});

test('comment hygiene detects untracked work and commented code while preserving rationale', (t) => {
  const rules = { 'repo-hygiene/no-low-value-comments': 'error' };
  const bad = lint(t, 'target.ts', '// TODO: finish later\nconst value = 1;\n', rules);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /Link the issue/);
  const good = lint(t, 'target.ts', '// TODO #123: remove after compatibility migration.\nconst value = 1;\n', rules);
  assert.equal(good.status, 0, good.stdout + good.stderr);
});
