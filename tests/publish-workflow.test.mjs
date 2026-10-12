import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/publish-npm.yml', import.meta.url), 'utf8');

function ancestryStepScript() {
  const block = workflow.match(/- name: Verify Tagged Commit Is On Main\n {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1];
  assert.ok(block, 'the publish workflow must keep its main-ancestry step');
  return block.split('\n').map((line) => line.slice(10)).join('\n');
}

// Git hooks export GIT_DIR, GIT_INDEX_FILE and friends; inherited, they would point
// these commands at the repository under test instead of the scratch repos.
const scratchEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

function git(cwd, ...args) {
  const result = spawnSync('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
    '-c', 'init.defaultBranch=main', '-c', 'core.hooksPath=/dev/null', ...args,
  ], { cwd, encoding: 'utf8', env: scratchEnv });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

// A dispatch checks out the tag with full history; main has usually moved on
// since. The step must accept a tagged commit behind main's tip and still
// refuse one that is not on main at all.
test('publish main-ancestry check accepts a tag behind main and refuses one off main', { skip: process.platform === 'win32' }, () => {
  const script = ancestryStepScript();
  const directory = mkdtempSync(join(tmpdir(), 'veritas-ancestry-'));
  try {
    const origin = join(directory, 'origin.git');
    const seed = join(directory, 'seed');
    git(directory, 'init', '-q', '--bare', origin);
    git(directory, 'init', '-q', seed);
    for (const n of ['1', '2']) {
      writeFileSync(join(seed, 'f'), n);
      git(seed, 'add', 'f');
      git(seed, 'commit', '-qm', n);
    }
    git(seed, 'tag', 'v1.0.0');
    git(seed, 'checkout', '-q', '-b', 'side');
    writeFileSync(join(seed, 'f'), 'side');
    git(seed, 'commit', '-qam', 'side');
    git(seed, 'tag', 'v9.9.9');
    git(seed, 'checkout', '-q', 'main');
    for (const n of ['3', '4']) {
      writeFileSync(join(seed, 'f'), n);
      git(seed, 'commit', '-qam', n);
    }
    git(seed, 'push', '-q', origin, 'main', 'v1.0.0', 'v9.9.9');

    const runAt = (tag) => {
      const workspace = join(directory, `ws-${tag}`);
      git(directory, 'clone', '-q', `file://${origin}`, workspace);
      git(workspace, 'checkout', '-q', tag);
      return spawnSync('bash', ['-e', '-c', script], {
        cwd: workspace,
        encoding: 'utf8',
        env: { ...scratchEnv, GITHUB_SHA: git(workspace, 'rev-parse', 'HEAD') },
      });
    };

    const behindTip = runAt('v1.0.0');
    assert.equal(behindTip.status, 0, behindTip.stderr);
    const offMain = runAt('v9.9.9');
    assert.equal(offMain.status, 1);
    assert.match(offMain.stderr, /is not reachable/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
