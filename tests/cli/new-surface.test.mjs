import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRootDir } from '../helpers.mjs';

function veritas(args, options = {}) {
  return execFileSync(process.execPath, ['bin/veritas.mjs', ...args], {
    cwd: repoRootDir,
    encoding: 'utf8',
    ...options,
  });
}

test('top-level help centers the primary verb-noun surface', () => {
  const output = veritas(['--help']);
  assert.match(output, /veritas readiness \[--check evidence\|boundaries\|coverage\]/);
  assert.match(output, /veritas recommendation list\|show <id>\|decide <id>/);
  assert.doesNotMatch(output, /Deprecated shims/);
  assert.doesNotMatch(output, /veritas readiness check/);
  assert.ok(output.split('\n').length <= 24);
});

test('top-level version reports the package version', () => {
  const packageVersion = JSON.parse(readFileSync(join(repoRootDir, 'package.json'), 'utf8')).version;
  assert.equal(veritas(['--version']), `${packageVersion}\n`);
  assert.equal(veritas(['-V']), `${packageVersion}\n`);
});

test('readiness front door supports boundaries check', () => {
  const output = veritas(['readiness', '--check', 'boundaries', '--actor', 'repo-core']);
  assert.match(output, /^PASS work-area-boundary:/);
});

test('removed legacy shim exits with primary help', () => {
  assert.throws(
    () => veritas(['legacy', 'help'], { stdio: 'pipe' }),
    (error) => {
      assert.match(error.stderr.toString(), /veritas readiness \[--check evidence\|boundaries\|coverage\]/);
      return true;
    },
  );
});
