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

// Everything shipped that tells people, or agents, what to run: root Markdown, the generated
// `.veritas/README.md`, `docs/`, `examples/`, `skills/`, the kit's `flows/` and `provisions/`, and
// the command strings in `src/`. CHANGELOG.md is history, not instructions.
const SCANNED_DIRS = [
  ['docs', /\.(md|json)$/],
  ['examples', /\.(md|json)$/],
  ['skills', /\.(md|json)$/],
  ['flows', /\.json$/],
  ['provisions', /\.json$/],
  ['src', /\.mjs$/],
];

function shippedDocFiles() {
  const files = readdirSync(repoRootDir)
    .filter((name) => name.endsWith('.md') && name !== 'CHANGELOG.md')
    .map((name) => join(repoRootDir, name));
  files.push(join(repoRootDir, '.veritas/README.md'));
  const walk = (dir, pattern) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, pattern);
      else if (pattern.test(name)) files.push(path);
    }
  };
  for (const [dir, pattern] of SCANNED_DIRS) walk(join(repoRootDir, dir), pattern);
  return files;
}

// Every spelling that runs the Veritas bin: npx with or without -y/--yes/--no, `npm exec [flags]
// -- veritas`, `pnpm exec`/`yarn exec`, `pnpm dlx`, and a `veritas` code span.
const COMMAND_PREFIX = new RegExp(
  [
    String.raw`\bnpx(?:\s+(?:-y|--yes|--no))*\s+@kontourai/veritas`,
    String.raw`\bnpm\s+exec(?:\s+-{1,2}[\w-]+(?:=\S+)?)*\s+--\s+veritas`,
    String.raw`\b(?:pnpm|yarn)\s+exec\s+(?:--\s+)?veritas`,
    String.raw`\bpnpm\s+dlx\s+@kontourai/veritas`,
    '`veritas',
  ].map((source) => `(?:${source})`).join('|').replace(/^/, '(?:') + String.raw`)[ \t]+`,
  'g',
);
// Inside a fenced block a line that starts with `veritas ` (optionally after a `$ ` prompt) is a
// command too.
const FENCED_COMMAND = /^\s*(?:\$\s+)?veritas[ \t]+/;

// A command is the run of bare words after the program name: `npx --no @kontourai/veritas apply
// git-hook --force` gives ["apply", "git-hook"]. A flag, placeholder, or punctuation ends it.
const MAX_COMMAND_WORDS = 3;

function commandWords(text) {
  const words = [];
  for (const token of text.slice(0, 200).split(/[ \t]+/)) {
    const word = token.match(/^[a-z][a-z0-9-]*/)?.[0];
    if (!word) break;
    words.push(word);
    if (word !== token || words.length === MAX_COMMAND_WORDS) break;
  }
  return words;
}

// In JavaScript source an unescaped backtick opens a template literal, so a `veritas` code span
// counts there only when written escaped, as \`veritas … \` inside a template.
function extractDocumentedCommands(text, { javascript = false } = {}) {
  const commands = [];
  for (const match of text.matchAll(COMMAND_PREFIX)) {
    if (javascript && match[0].startsWith('`') && text[match.index - 1] !== '\\') continue;
    const words = commandWords(text.slice(match.index + match[0].length));
    if (words.length > 0) commands.push(words);
  }
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const fenced = inFence && line.match(FENCED_COMMAND);
    if (fenced) {
      const words = commandWords(line.slice(fenced[0].length));
      if (words.length > 0) commands.push(words);
    }
  }
  return commands;
}

function documentedCommands() {
  const byCommand = new Map();
  for (const file of shippedDocFiles()) {
    for (const words of extractDocumentedCommands(readFileSync(file, 'utf8'), { javascript: file.endsWith('.mjs') })) {
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
      'Also `npx @kontourai/veritas apply alpha`, `npx -y @kontourai/veritas apply beta`,',
      '`npm exec --yes --package=@kontourai/veritas@1.5.2 -- veritas apply gamma`, `pnpm exec veritas apply delta`',
      'and `pnpm dlx @kontourai/veritas apply epsilon`.',
      '```sh',
      'veritas apply zeta --force',
      '$ veritas apply eta',
      '```',
      'veritas apply outside-a-fence',
    ].join('\n')),
    [
      ['apply', 'git-hook'],
      ['recommendation', 'show'],
      ['readiness'],
      ['hooks', 'codex', 'pre-tool-use'],
      ['apply', 'alpha'],
      ['apply', 'beta'],
      ['apply', 'gamma'],
      ['apply', 'delta'],
      ['apply', 'epsilon'],
      ['apply', 'zeta'],
      ['apply', 'eta'],
    ],
  );
  // In JavaScript an unescaped backtick opens a template literal; an escaped one is a code span.
  assert.deepEqual(
    extractDocumentedCommands('throw new Error(`veritas claim add requires --x`);\nconst hint = `Run \\`veritas apply theta\\`.`;', { javascript: true }),
    [['apply', 'theta']],
  );
});

test('the scan covers root Markdown, the generated .veritas/README.md and src command strings', () => {
  const scanned = new Set(shippedDocFiles().map((file) => relative(repoRootDir, file)));
  for (const pinned of ['README.md', 'CONTEXT.md', 'AGENTS.md', '.veritas/README.md', 'src/cli/setup-print.mjs', 'skills/setup-governance/SKILL.md']) {
    assert.ok(scanned.has(pinned), `the guard scans ${pinned}`);
  }
  assert.equal(scanned.has('CHANGELOG.md'), false);
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

// A target that also merges a tool config reads and merges it before writing anything, so a
// malformed config leaves nothing half installed, and a retry needs no --force.
const CONFIG_MERGING_TARGETS = [
  { args: ['apply', 'stop-hook', '--tool', 'claude-code'], config: '.claude/settings.json', written: '.veritas/hooks/stop.sh' },
  { args: ['apply', 'stop-hook', '--tool', 'cursor'], config: '.cursor/hooks.json', written: '.veritas/hooks/stop.sh' },
  { args: ['apply', 'claude-code-pre-tool-use-hook'], config: '.claude/settings.json', written: '.veritas/hooks/pre-tool-use.sh' },
  { args: ['apply', 'codex-hook', '--codex-home', 'codex-home'], config: 'codex-home/hooks.json', written: '.veritas/runtime/codex-hooks.json' },
];

for (const { args, config, written } of CONFIG_MERGING_TARGETS) {
  test(`${args.join(' ')} writes nothing when ${config} is malformed, and a retry needs no --force`, (t) => {
    const rootDir = tempDir(t, 'veritas-apply-malformed-config-');
    mkdirp(join(rootDir, config, '..'));
    writeFileSync(join(rootDir, config), '{not json\n');

    const failed = veritas(rootDir, args);
    assert.notEqual(failed.status, 0);
    assert.ok(failed.stderr.includes(config), `the error names ${config}: ${failed.stderr}`);
    assert.equal(existsSync(join(rootDir, written)), false, `${written} was not written`);
    assert.equal(readFileSync(join(rootDir, config), 'utf8'), '{not json\n');

    writeFileSync(join(rootDir, config), '{}\n');
    const fixed = veritas(rootDir, args);
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.ok(existsSync(join(rootDir, written)));

    const again = veritas(rootDir, args);
    assert.equal(again.status, 0, `an identical ${written} is accepted: ${again.stderr}`);

    writeFileSync(join(rootDir, written), '#!/bin/sh\necho custom\n');
    const custom = veritas(rootDir, args);
    assert.notEqual(custom.status, 0);
    assert.match(custom.stderr, /Refusing to overwrite existing file/);
    assert.equal(readFileSync(join(rootDir, written), 'utf8'), '#!/bin/sh\necho custom\n');
  });
}

test('apply refuses a --root that does not exist instead of creating it', (t) => {
  const cwd = tempDir(t, 'veritas-apply-missing-root-');
  const result = veritas(cwd, ['apply', 'runtime-hook', '--root', 'missing/deeper']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--root must name an existing directory; got missing\/deeper/);
  assert.deepEqual(readdirSync(cwd), []);
});
