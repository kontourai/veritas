import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { repoRootDir } from './helpers.mjs';
import { tempDir } from './temp-dir.mjs';

// Every test directory must come from tempDir(), which removes it when the test ends. A direct
// call leaves the directory (and any installed fixture packages in it) behind on every run, and a
// development machine that runs the suite repeatedly eventually fills its disk (#288).
//
// The identifier is assembled so this file never contains the token it forbids; it therefore needs
// no exemption of its own, and the helper is the only allowed file.
const FORBIDDEN_STEM = 'mkd' + 'temp';
const FORBIDDEN = new RegExp(`\\b${FORBIDDEN_STEM}\\w*`);
const HELPER = 'tests/temp-dir.mjs';
const SCANNED_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts']);

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile() && SCANNED_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) files.push(path);
  }
  return files;
}

const posix = (rootDir, path) => relative(rootDir, path).split(sep).join('/');

// Returns { scanned, offences } for every source file under <rootDir>/tests. Matches anywhere in the
// text, so aliasing (`import { <name> as x }`), `fs.promises.` and comments are all caught; a stray
// mention is cheap to reword, and a missed alias is the failure this guard exists to prevent.
function scanTests(rootDir, { allowed = [HELPER] } = {}) {
  const scanned = listFiles(join(rootDir, 'tests')).map((path) => posix(rootDir, path)).sort();
  const offences = [];
  for (const file of scanned) {
    if (allowed.includes(file)) continue;
    readFileSync(join(rootDir, file), 'utf8').split('\n').forEach((text, index) => {
      if (FORBIDDEN.test(text)) offences.push({ file, line: index + 1, text: text.trim() });
    });
  }
  return { scanned, offences };
}

function describeOffences(offences) {
  return [
    `${offences.length} direct temp-directory call(s) under tests/ would leak a directory on every run:`,
    ...offences.map(({ file, line, text }) => `  ${file}:${line}  ${text}`),
    "Use tempDir(t, prefix) from tests/temp-dir.mjs instead; it removes the directory when the test ends.",
    "At module scope, pass { after } from 'node:test' in place of t.",
  ].join('\n');
}

test('no test file creates a temp directory except through tests/temp-dir.mjs', () => {
  const { scanned, offences } = scanTests(repoRootDir);

  // The walk must see the suite, or an empty or misrooted scan would pass vacuously.
  for (const expected of [
    'tests/helpers.mjs',
    HELPER,
    'tests/temp-dir-guard.test.mjs',
    'tests/veritas.test.mjs',
    'tests/nested-package-hooks.test.mjs',
    'tests/runner.test.mjs',
    'tests/surface/trust-report-consumption.test.mjs',
    'tests/standards-feedback/recommendation-generator.test.mjs',
  ]) {
    assert.ok(scanned.includes(expected), `the scan did not reach ${expected}`);
  }
  // Everything `npm test` runs (tests/*.test.mjs and one directory level below) is scanned.
  const globbed = readdirSync(join(repoRootDir, 'tests'), { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? readdirSync(join(repoRootDir, 'tests', entry.name)).filter((name) => name !== 'fixtures' && name.endsWith('.test.mjs')).map((name) => `tests/${entry.name}/${name}`)
      : entry.name.endsWith('.test.mjs') ? [`tests/${entry.name}`] : []);
  assert.ok(globbed.length >= 30, `expected at least 30 test files, found ${globbed.length}`);
  assert.deepEqual(globbed.filter((file) => !scanned.includes(file)), []);

  assert.equal(offences.length, 0, describeOffences(offences));
});

test('the helper is the single place that creates a temp directory', () => {
  // The exemption covers a whole file, so pin what the helper contains: its import and its one call.
  const { offences } = scanTests(repoRootDir, { allowed: [] });
  assert.deepEqual(
    offences.map(({ file, text }) => `${file}: ${text}`),
    [
      `${HELPER}: import { ${FORBIDDEN_STEM}Sync, rmSync } from 'node:fs';`,
      `${HELPER}: const dir = ${FORBIDDEN_STEM}Sync(join(tmpdir(), prefix));`,
    ],
  );
});

test('the guard reports a direct call, an alias and a promise form, and ignores tempDir usage', (t) => {
  const fixtureRoot = tempDir(t, 'veritas-temp-dir-guard-');
  mkdirSync(join(fixtureRoot, 'tests/nested'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'tests/uses-helper.test.mjs'), "const dir = tempDir(t, 'veritas-x-');\n");
  writeFileSync(join(fixtureRoot, 'tests/direct.test.mjs'), `const dir = ${FORBIDDEN_STEM}Sync(join(tmpdir(), 'veritas-x-'));\n`);
  writeFileSync(join(fixtureRoot, 'tests/nested/alias.test.mjs'), `import { ${FORBIDDEN_STEM}Sync as makeDir } from 'node:fs';\n`);
  writeFileSync(join(fixtureRoot, 'tests/nested/promise.test.mjs'), `\nconst dir = await fs.promises.${FORBIDDEN_STEM}(prefix);\n`);
  writeFileSync(join(fixtureRoot, HELPER), `export const make = () => ${FORBIDDEN_STEM}Sync(prefix);\n`);

  const { scanned, offences } = scanTests(fixtureRoot);
  assert.deepEqual(scanned, [
    'tests/direct.test.mjs',
    'tests/nested/alias.test.mjs',
    'tests/nested/promise.test.mjs',
    'tests/temp-dir.mjs',
    'tests/uses-helper.test.mjs',
  ]);
  assert.deepEqual(
    offences.map(({ file, line }) => `${file}:${line}`),
    ['tests/direct.test.mjs:1', 'tests/nested/alias.test.mjs:1', 'tests/nested/promise.test.mjs:2'],
  );

  const message = describeOffences(offences);
  assert.match(message, /3 direct temp-directory call\(s\)/);
  assert.match(message, /tests\/direct\.test\.mjs:1 /);
  assert.match(message, /Use tempDir\(t, prefix\) from tests\/temp-dir\.mjs/);
});

test('tempDir removes the directory when the test that owns it finishes', async (t) => {
  let dir;
  await t.test('a subtest creates and uses the directory', (subtest) => {
    dir = tempDir(subtest, 'veritas-temp-dir-owner-');
    writeFileSync(join(dir, 'file.txt'), 'x');
    assert.ok(existsSync(dir));
  });
  assert.equal(existsSync(dir), false, 'the directory must be gone once its test has finished');
});

test('tempDir accepts a bare { after } owner for module scope and tolerates a directory removed early', () => {
  const hooks = [];
  const dir = tempDir({ after: (fn) => hooks.push(fn) }, 'veritas-temp-dir-suite-');
  assert.ok(existsSync(dir));
  assert.equal(hooks.length, 1);
  hooks[0]();
  assert.equal(existsSync(dir), false);
  assert.doesNotThrow(() => hooks[0](), 'cleanup after the test already removed the directory must not fail');
});

test('tempDir refuses an owner that cannot run cleanup, rather than creating a directory nothing removes', () => {
  assert.throws(() => tempDir(undefined, 'veritas-x-'), TypeError);
  assert.throws(() => tempDir('veritas-x-', 'veritas-y-'), /needs an after\(\) hook/);
});
