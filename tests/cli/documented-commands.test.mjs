import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { initCommittedRepo, mkdirp, repoRootDir } from '../helpers.mjs';
import { tempDir } from '../temp-dir.mjs';

// The CLI reference documented `print` and most `apply` targets for releases after the bin stopped
// routing them (#284, #206, #190). These tests compare what the shipped docs tell people to run
// with what the published bin actually routes, in both directions, so the two cannot drift apart
// silently again.

// The published bin mapping, not a hard-coded path: what `npx @kontourai/veritas` runs.
const veritasBin = join(repoRootDir, JSON.parse(readFileSync(join(repoRootDir, 'package.json'), 'utf8')).bin.veritas);

function veritas(cwd, args) {
  return spawnSync(process.execPath, [veritasBin, ...args], { cwd, encoding: 'utf8' });
}

function veritasAsync(cwd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [veritasBin, ...args], { cwd });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (status) => resolvePromise({ status, stdout }));
  });
}

async function mapWithConcurrency(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Shipped prose that tells people what to run. CHANGELOG.md is history, not instructions.
function shippedDocFiles() {
  const files = [join(repoRootDir, 'README.md')];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(md|json)$/.test(name)) files.push(path);
    }
  };
  for (const dir of ['docs', 'examples', 'skills']) walk(join(repoRootDir, dir));
  return files;
}

// A command is the run of bare words after the program name: `npx --no @kontourai/veritas apply
// git-hook --force` gives ["apply", "git-hook"]. A flag, placeholder, or punctuation ends it.
const COMMAND_PREFIXES = ['npx --no @kontourai/veritas ', '`veritas '];
const MAX_COMMAND_WORDS = 3;

function extractDocumentedCommands(text) {
  const commands = [];
  for (const prefix of COMMAND_PREFIXES) {
    let index = text.indexOf(prefix);
    while (index >= 0) {
      const words = [];
      for (const token of text.slice(index + prefix.length, index + prefix.length + 200).split(/[ \t]+/)) {
        const word = token.match(/^[a-z][a-z0-9-]*/)?.[0];
        if (!word) break;
        words.push(word);
        if (word !== token || words.length === MAX_COMMAND_WORDS) break;
      }
      if (words.length > 0) commands.push(words);
      index = text.indexOf(prefix, index + prefix.length);
    }
  }
  return commands;
}

function documentedCommands() {
  const byCommand = new Map();
  for (const file of shippedDocFiles()) {
    for (const words of extractDocumentedCommands(readFileSync(file, 'utf8'))) {
      const key = words.join(' ');
      if (!byCommand.has(key)) byCommand.set(key, { words, files: new Set() });
      byCommand.get(key).files.add(relative(repoRootDir, file));
    }
  }
  return [...byCommand.values()];
}

// A usage line covers a command when each command word matches the usage word in the same
// position: one of its `a|b` alternatives, or any value for a `<placeholder>`.
function usageCovers(usageText, words) {
  return usageText.split('\n').some((line) => {
    const usageWords = line.trim().split(/\s+/);
    if (usageWords[0] !== 'veritas') return false;
    return words.every((word, position) => {
      const usageWord = usageWords[position + 1];
      if (!usageWord) return false;
      if (usageWord.startsWith('<')) return true;
      return usageWord.split('|').includes(word);
    });
  });
}

test('the extractor reads command words and stops at flags, placeholders and punctuation', () => {
  assert.deepEqual(
    extractDocumentedCommands([
      '```bash',
      'npx --no @kontourai/veritas apply git-hook --configure-git --force',
      'npx --no @kontourai/veritas recommendation show <id> [--root <path>]',
      '```',
      'Run `npx --no @kontourai/veritas readiness` and fix FAIL lines.',
      'The hook invokes `veritas hooks codex pre-tool-use`.',
      'npx --no @kontourai/veritas -- --version',
    ].join('\n')),
    [
      ['apply', 'git-hook'],
      ['recommendation', 'show'],
      ['readiness'],
      ['hooks', 'codex', 'pre-tool-use'],
    ],
  );
});

test('every command the shipped docs name is routed by the bin', async (t) => {
  // `--help` keeps every probe side-effect free; a cwd outside the repo would expose a write.
  const cwd = tempDir(t, 'veritas-documented-commands-');
  const commands = documentedCommands();
  // Pin the documented `print` and `apply` targets independently of the extractor.
  for (const pinned of ['apply package-scripts', 'apply stop-hook', 'apply codex-hook', 'print codex-hook', 'print governance-block']) {
    assert.ok(commands.some(({ words }) => words.join(' ') === pinned), `docs no longer name ${pinned}`);
  }

  const results = await mapWithConcurrency(commands, 8, ({ words }) => veritasAsync(cwd, [...words, '--help']));
  const unrouted = commands
    .filter((_, index) => results[index].status !== 0 || !usageCovers(results[index].stdout, commands[index].words))
    .map(({ words, files }) => `veritas ${words.join(' ')} (documented in ${[...files].join(', ')})`);
  assert.deepEqual(unrouted, []);
  assert.deepEqual(readdirSync(cwd), [], 'a --help probe wrote files');
});

// Routed verbs the top-level help leaves out to stay short; their own help lists their commands.
const VERBS_ONLY_IN_SCOPED_HELP = ['print', 'hooks'];

// Usage lines from the top-level help and from each verb's own help, where `print` and `apply`
// list their targets.
function routedUsageLines() {
  const mainUsage = veritas(repoRootDir, ['--help']).stdout;
  const verbs = new Set(VERBS_ONLY_IN_SCOPED_HELP);
  for (const line of mainUsage.split('\n')) {
    const [program, verb] = line.trim().split(/\s+/);
    if (program !== 'veritas' || !/^[a-z]/.test(verb ?? '')) continue;
    for (const word of verb.split('|')) verbs.add(word);
  }
  const scopedUsage = [...verbs].map((verb) => veritas(repoRootDir, [verb, '--help']).stdout);
  return [mainUsage, ...scopedUsage].join('\n').split('\n');
}

test('every command the bin routes is documented', () => {
  const documented = new Set(documentedCommands().map(({ words }) => words.join(' ')));
  const usageLines = routedUsageLines();
  // Pin the scoped targets independently, so a help change cannot silently shrink the check.
  for (const pinned of ['veritas apply package-scripts', 'veritas print codex-hook', 'veritas hooks codex pre-tool-use']) {
    assert.ok(usageLines.some((line) => line.trim().startsWith(pinned)), `help no longer lists ${pinned}`);
  }
  const mainUsage = veritas(repoRootDir, ['--help']).stdout;
  for (const target of ['governance-blocks', 'package-scripts', 'codex-hook', 'claude-code-pre-tool-use-hook']) {
    assert.ok(usageCovers(mainUsage, ['apply', target]), `top-level help lists apply ${target}`);
  }
  const undocumented = [];
  for (const line of usageLines) {
    const [program, verb, sub] = line.trim().split(/\s+/);
    if (program !== 'veritas' || !/^[a-z]/.test(verb ?? '')) continue;
    const subs = sub && /^[a-z]/.test(sub) ? sub.split('|').filter((word) => /^[a-z]/.test(word)) : [null];
    for (const [verbWord, subWord] of verb.split('|').flatMap((each) => subs.map((subWord) => [each, subWord]))) {
      const command = subWord ? `${verbWord} ${subWord}` : verbWord;
      if (![...documented].some((entry) => entry === command || entry.startsWith(`${command} `))) {
        undocumented.push(command);
      }
    }
  }
  assert.deepEqual([...new Set(undocumented)], []);
});

const APPLY_WRITES = [
  [['apply', 'package-scripts'], 'package.json'],
  [['apply', 'ci-snippet'], '.veritas/snippets/ci-snippet.yml'],
  [['apply', 'git-hook'], '.githooks/post-commit'],
  [['apply', 'git-hook', '--hook', 'pre-push'], '.githooks/pre-push'],
  [['apply', 'runtime-hook'], '.veritas/hooks/agent-runtime.sh'],
  [['apply', 'stop-hook', '--tool', 'claude-code'], '.veritas/hooks/stop.sh'],
  [['apply', 'codex-hook'], '.veritas/runtime/codex-hooks.json'],
  [['apply', 'claude-code-pre-tool-use-hook'], '.veritas/hooks/pre-tool-use.sh'],
];

test('each documented apply target dispatches to its writer through the bin', (t) => {
  for (const [args, writtenPath] of APPLY_WRITES) {
    const rootDir = initCommittedRepo(t, 'veritas-apply-route-');
    writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify({ name: 'fixture', scripts: {} }, null, 2)}\n`);
    const before = readFileSync(join(rootDir, 'package.json'), 'utf8');

    const result = veritas(rootDir, args);

    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    assert.ok(existsSync(join(rootDir, writtenPath)), `${args.join(' ')} wrote ${writtenPath}`);
    if (writtenPath === 'package.json') {
      assert.notEqual(readFileSync(join(rootDir, 'package.json'), 'utf8'), before);
    }
  }
});

test('each documented print target prints without writing', (t) => {
  const rootDir = tempDir(t, 'veritas-print-route-');
  for (const target of [
    'package-scripts',
    'ci-snippet',
    'git-hook',
    'runtime-hook',
    'stop-hook',
    'codex-hook',
    'claude-code-pre-tool-use-hook',
  ]) {
    const result = veritas(rootDir, ['print', target]);
    assert.equal(result.status, 0, `print ${target}: ${result.stderr}`);
    assert.equal(typeof JSON.parse(result.stdout), 'object', `print ${target} prints JSON`);
  }
  const block = veritas(rootDir, ['print', 'governance-block']);
  assert.equal(block.status, 0);
  assert.match(block.stdout, /^<!-- veritas:governance-block:start -->/);
  assert.deepEqual(readdirSync(rootDir), []);
});

test('print codex-hook suggests an apply command the bin routes', (t) => {
  const rootDir = tempDir(t, 'veritas-print-codex-suggestion-');
  const codexHome = join(rootDir, 'codex-home');
  mkdirp(codexHome);

  const printed = JSON.parse(veritas(rootDir, ['print', 'codex-hook', '--codex-home', codexHome]).stdout);
  const [npx, no, pkg, ...args] = printed.suggestedApplyCommand.split(' ');
  assert.deepEqual([npx, no, pkg], ['npx', '--no', '@kontourai/veritas']);

  const applied = veritas(rootDir, args.map((arg) => arg.replace(/^'(.*)'$/, '$1')));
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(existsSync(join(rootDir, '.veritas/runtime/codex-hooks.json')));
  assert.ok(existsSync(join(codexHome, 'hooks.json')));
});

test('apply rejects unknown flags, missing or disallowed values, and positionals before writing', (t) => {
  const rootDir = tempDir(t, 'veritas-apply-invalid-');
  for (const args of [
    ['apply', 'runtime-hook', '--bogus'],
    ['apply', 'runtime-hook', 'extra'],
    ['apply', 'runtime-hook', '--output'],
    ['apply', 'runtime-hook', '--output', '--force'],
    ['apply', 'git-hook', '--hook', 'pre-rebase'],
    ['apply', 'stop-hook', '--tool', 'vim'],
    ['apply', 'package-scripts', '--configure-git'],
    ['print', 'governance-block', '--root', rootDir],
  ]) {
    const result = veritas(rootDir, args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, new RegExp(`veritas ${args[0]} ${args[1]}`), args.join(' '));
  }
  assert.deepEqual(readdirSync(rootDir), []);
});

test('integrations codex install accepts the repo hooks setup repo-hooks wrote', (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-codex-after-setup-');

  assert.equal(veritas(rootDir, ['setup', 'repo-hooks']).status, 0);
  const install = veritas(rootDir, ['integrations', 'codex', 'install']);

  assert.equal(install.status, 0, install.stderr);
  const result = JSON.parse(install.stdout);
  assert.equal(result.stop.gitHook.outputPath, '.githooks/post-commit');
  assert.ok(existsSync(join(rootDir, '.veritas/hooks/agent-runtime.sh')));
});

test('integrations codex install still refuses a repo hook that differs', (t) => {
  const rootDir = initCommittedRepo(t, 'veritas-codex-custom-hook-');
  mkdirp(join(rootDir, '.githooks'));
  writeFileSync(join(rootDir, '.githooks/post-commit'), '#!/bin/sh\necho custom\n');

  const install = veritas(rootDir, ['integrations', 'codex', 'install']);

  assert.equal(install.status, 2);
  assert.match(install.stderr, /Refusing to overwrite existing file: \.githooks\/post-commit/);
  assert.equal(readFileSync(join(rootDir, '.githooks/post-commit'), 'utf8'), '#!/bin/sh\necho custom\n');
  assert.equal(existsSync(join(rootDir, '.veritas/hooks/agent-runtime.sh')), false);
});
