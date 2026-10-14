import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitMaintenanceChildren } from './helpers.mjs';
import { tempDir } from './temp-dir.mjs';

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

// `git commit`, `git push` (receive-pack in the receiving repository) and `git fetch` each start
// `git maintenance run --auto --detach`, which repacks after the command returns and can race the
// removal of these directories. `-c` reaches the child processes git starts; the repositories that
// receive pushes also carry the setting themselves.
// scratchEnv drops every GIT_ variable; the trace2 log of gitMaintenanceChildren is the exception.
const gitEnv = (extra = {}) => ({
  ...scratchEnv,
  ...(process.env.GIT_TRACE2_EVENT ? { GIT_TRACE2_EVENT: process.env.GIT_TRACE2_EVENT } : {}),
  ...extra,
});

function git(cwd, ...args) {
  const result = spawnSync('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
    '-c', 'init.defaultBranch=main', '-c', 'core.hooksPath=/dev/null',
    '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args,
  ], {
    cwd,
    encoding: 'utf8',
    env: gitEnv(),
  });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

// A dispatch checks out the tag with full history; main has usually moved on
// since. The step must accept a tagged commit behind main's tip and still
// refuse one that is not on main at all.
test('publish main-ancestry check accepts a tag behind main and refuses one off main', { skip: process.platform === 'win32' }, (t) => {
  const script = ancestryStepScript();
  const directory = tempDir(t, 'veritas-ancestry-');
  const started = gitMaintenanceChildren(t, () => {
    const origin = join(directory, 'origin.git');
    const seed = join(directory, 'seed');
    git(directory, 'init', '-q', '--bare', origin);
    git(origin, 'config', 'maintenance.auto', 'false');
    git(origin, 'config', 'gc.auto', '0');
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
      // The step below runs a bare `git fetch`, which has no -c; the clone carries the setting.
      git(workspace, 'config', 'maintenance.auto', 'false');
      git(workspace, 'config', 'gc.auto', '0');
      git(workspace, 'checkout', '-q', tag);
      return spawnSync('bash', ['-e', '-c', script], {
        cwd: workspace,
        encoding: 'utf8',
        env: gitEnv({ GITHUB_SHA: git(workspace, 'rev-parse', 'HEAD') }),
      });
    };

    const behindTip = runAt('v1.0.0');
    assert.equal(behindTip.status, 0, behindTip.stderr);
    const offMain = runAt('v9.9.9');
    assert.equal(offMain.status, 1);
    assert.match(offMain.stderr, /is not reachable/);
  });
  assert.deepEqual(started, [], 'a commit, push or fetch started git maintenance, which can outlive the test and race its cleanup');
});
