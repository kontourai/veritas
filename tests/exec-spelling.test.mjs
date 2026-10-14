import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREVIOUS_CODEX_HOOK_COMMANDS } from '../src/integrations/codex-hook-history.mjs';
import { buildSuggestedCodexHookConfig } from '../src/integrations/codex-hooks.mjs';
import { buildGovernanceBlock } from '../src/governance.mjs';
import { buildGovernanceInstructions } from '../src/bootstrap/guidance.mjs';
import { buildBootstrapReadme } from '../src/bootstrap/readme.mjs';
import { evaluateGovernanceBlockRule } from '../src/rules/evaluate.mjs';

const repoRootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `npx` and `npm exec` fall back to the registry when there is no local bin, and install without
// prompting when there is no terminal. Agents run without one. Anything Veritas ships (the docs,
// skills and flows adopters copy from, and the source that writes hooks, package scripts, CI
// snippets and printed next steps into adopter repos) must pass --no, so a missing install is an
// error and never a silent fetch. The standard spelling is `npx --no @kontourai/veritas`: the
// `@kontourai` scope is ours, while the unscoped `veritas` package belongs to another project.
// Survey has two bins, so it runs as `npm exec --no --package=@kontourai/survey -- <bin>`. The
// one fetch is the setup bootstrap, `npm exec --yes --package="@kontourai/veritas@${v:?...}" --
// veritas`. npx answers a leading --version, --help, -v or -h itself, so those go after `--`.
// `pnpm dlx`, `pnpx`, `yarn dlx`, `bunx` and `bun x` always download, so they never run Veritas or
// Survey. Other packages are out of scope: the Flow Agents kit install fetches a package that is
// not installed yet, by design.
const SCOPED_PACKAGES = new Set(['@kontourai/veritas', '@kontourai/survey']);
// Bin names of the scoped packages. As a bare package name each resolves to whatever owns that
// name on the registry.
const BARE_NAMES = new Set(['veritas', 'veritas-report', 'survey', 'survey-review-mcp', 'survey-review-console']);
const RUNNERS = [
  { words: ['npx'], kind: 'npx' },
  { words: ['npm', 'exec'], kind: 'npm exec' },
  { words: ['npm', 'x'], kind: 'npm exec' },
  { words: ['pnpm', 'dlx'], kind: 'pnpm dlx', downloads: true },
  { words: ['pnpx'], kind: 'pnpx', downloads: true },
  { words: ['yarn', 'dlx'], kind: 'yarn dlx', downloads: true },
  { words: ['bunx'], kind: 'bunx', downloads: true },
  { words: ['bun', 'x'], kind: 'bun x', downloads: true },
];
const BOOTSTRAP_PACKAGE = '@kontourai/veritas@${v:?}';
// npm options that take the next word as their value when written without `=`. Without this, the
// value would be read as the package name and the invocation skipped.
const VALUE_OPTIONS = new Set([
  '--call', '-c', '--workspace', '-w', '--prefix', '--registry', '--cache', '--userconfig',
  '--globalconfig', '--loglevel', '--node-options', '--script-shell', '--scope', '--tag', '--before',
]);
const LEADING_NPX_FLAG = new Set(['--version', '--help', '-v', '-h']);

const packageName = (spec) => spec.match(/^(@[^/@]+\/[^@]+|[^@]+)/)?.[1] ?? spec;
const isOurs = (spec) => SCOPED_PACKAGES.has(packageName(spec)) || BARE_NAMES.has(packageName(spec));
const unquote = (word) => word.replace(/^["']+|["']+$/g, '');

function shellWords(line) {
  return line
    // The bootstrap's `${v:?message}` holds spaces; reduce it to one word.
    .replace(/\$\{v:\?[^}]*\}/g, '${v:?}')
    // Shell separators and Markdown code spans end an invocation.
    .replace(/&&|\|\||\$\(|[;|()`]/g, ' ; ')
    .split(/\s+/)
    .map((word) => word.replace(/^["',]+/, '').replace(/["',:]+$/, ''))
    .filter(Boolean);
}

function runnerAt(words, index) {
  return RUNNERS.find((runner) => runner.words.every((word, offset) => words[index + offset] === word));
}

// Every package-runner invocation on the line: its kind and the words up to the next separator or
// the next invocation.
function invocations(line) {
  const words = shellWords(line);
  const found = [];
  for (let index = 0; index < words.length; index += 1) {
    const runner = runnerAt(words, index);
    if (!runner) continue;
    let end = index + runner.words.length;
    while (end < words.length && words[end] !== ';' && !runnerAt(words, end)) end += 1;
    found.push({ kind: runner.kind, downloads: runner.downloads === true, args: words.slice(index + runner.words.length, end) });
    index = end - 1;
  }
  return found;
}

function parseExecArgs(args) {
  const options = [];
  const packages = [];
  let index = 0;
  while (index < args.length && args[index].startsWith('-') && args[index] !== '--') {
    const word = args[index];
    const packageOption = word.match(/^(?:--package|-p)(?:=(.*))?$/);
    if (packageOption) {
      packages.push(unquote(packageOption[1] ?? args[index + 1] ?? ''));
      if (packageOption[1] === undefined) index += 1;
    } else if (VALUE_OPTIONS.has(word)) {
      index += 1;
    }
    options.push(word);
    index += 1;
  }
  const separated = args[index] === '--';
  if (separated) index += 1;
  return { options, packages, separated, command: args[index], rest: args.slice(index + 1) };
}

// Joins shell line continuations (a trailing backslash) so a command split across lines is read
// whole; each logical line keeps the number of the line it starts on.
function logicalLines(text) {
  const lines = [];
  let pending = null;
  text.split('\n').forEach((line, index) => {
    const current = pending ? { number: pending.number, text: `${pending.text} ${line.trim()}` } : { number: index + 1, text: line };
    if (/\\\s*$/.test(line)) pending = { number: current.number, text: current.text.replace(/\\\s*$/, '') };
    else {
      lines.push(current);
      pending = null;
    }
  });
  if (pending) lines.push(pending);
  return lines;
}

function unsafeExec(line) {
  const problems = [];
  for (const { kind, downloads, args } of invocations(line)) {
    if (downloads) {
      const names = args.flatMap((word) => [word, word.replace(/^(?:--package|-p)=/, '')]).map(unquote);
      if (names.some(isOurs)) problems.push(`${kind} always fetches from the registry`);
      continue;
    }
    const { options, packages, separated, command, rest } = parseExecArgs(args);
    const named = [...packages, ...(command ? [command] : [])];
    if (!named.some(isOurs)) continue;
    const bootstrap = kind === 'npm exec'
      && options.length === 2
      && options[0] === '--yes'
      && packages.length === 1
      && packages[0] === BOOTSTRAP_PACKAGE
      && separated
      && command === 'veritas';
    if (bootstrap) continue;
    if (!options.includes('--no')) problems.push(`${kind} without an exact --no`);
    if (options.some((option) => /^(?:--yes|-y)(?:=|$)/.test(option))) problems.push(`${kind} with --yes`);
    const packageSpecs = packages.length > 0 ? packages : [command ?? ''];
    for (const spec of packageSpecs) {
      if (isOurs(spec) && !SCOPED_PACKAGES.has(packageName(spec))) problems.push(`unscoped package ${packageName(spec)}`);
    }
    if (kind === 'npm exec' && !separated) problems.push('npm exec without -- before the command');
    if (kind === 'npx' && !separated && LEADING_NPX_FLAG.has(rest[0])) problems.push(`leading ${rest[0]} needs --`);
  }
  return problems;
}

// A bare `veritas` is on PATH only inside an npm script or with a global install. Text that tells a
// reader to run it sends a shell to "command not found", and the natural recovery, `npx veritas`,
// runs the unscoped package. Two matchers, both for lowercase `veritas` followed by a subcommand:
// - in shipped files, after a verb that tells the reader to run it. Naming a command in prose
//   ("`veritas readiness` is the primary command") and usage or error text that names the command
//   being invoked ("veritas init requires --plan") are not instructions and are not matched;
// - in rendered generator output, which is Markdown, any code span that starts with it, verb or not.
const RUN_VERB = '(?:[Rr]un|[Rr]unning|[Rr]e-?run|[Uu]se|[Uu]sing|[Ww]ith|[Tt]hrough|[Ss]ee|[Vv]ia|[Pp]repare|[Tt]ry|[Cc]all|[Ii]nvoke)';
const BARE_RUN = new RegExp(`\\b${RUN_VERB}\\s+\\\\?\`?veritas\\s+[a-z]`);
const BARE_SPAN = /`veritas\s+[a-z]/;

function bareRunInstruction(text) {
  return BARE_RUN.test(text) ? ['bare veritas in a run instruction'] : [];
}

function bareRenderedInstruction(text) {
  return [...bareRunInstruction(text), ...(BARE_SPAN.test(text) ? ['bare veritas in a code span'] : [])];
}

// Everything the package ships, from package.json `files`: what adopters copy from and the source
// that generates text into their repos. npm also packs package.json itself, which is deliberately
// not scanned: its scripts are this repository's own, and they run the checkout's bin through
// `npm exec`, because npx cannot find a package from inside that package's own checkout.
// Stated limits: JSON `args` arrays and Windows `npx.cmd` invocations are not parsed.
function shippedFiles() {
  const entries = JSON.parse(readFileSync(join(repoRootDir, 'package.json'), 'utf8')).files;
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRootDir, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && entries.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)));
}

// The one file allowed to hold earlier spellings: the record of exact commands earlier releases
// merged into Codex hooks files, kept so a reinstall can replace them. Only those recorded strings
// are exempt; anything else in the file is scanned like every other line.
const PAST_OUTPUT_RECORD = 'src/integrations/codex-hook-history.mjs';
const RECORDED_PAST_COMMANDS = Object.values(PREVIOUS_CODEX_HOOK_COMMANDS).flat();
const withoutRecordedPastCommands = (file, line) => (file === PAST_OUTPUT_RECORD
  ? RECORDED_PAST_COMMANDS.reduce((text, command) => text.replaceAll(command, ''), line)
  : line);

test('the record of past Codex hook commands holds only earlier unsafe spellings', () => {
  assert.equal(RECORDED_PAST_COMMANDS.length, 2);
  const current = new Set(Object.values(buildSuggestedCodexHookConfig().hooks)
    .flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command))));
  for (const command of RECORDED_PAST_COMMANDS) {
    assert.notDeepEqual(unsafeExec(command), [], command);
    assert.equal(current.has(command), false, command);
  }
});

test('shipped text and generated source only run an installed Veritas or Survey', () => {
  const files = shippedFiles();
  // Pinned independently of package.json: the generated-text sources and the adopter docs.
  for (const required of [
    'README.md',
    'kit.json',
    'docs/MIGRATING.md',
    'docs/guides/governance-kit.md',
    'skills/setup-governance/SKILL.md',
    'flows/readiness-check.flow.json',
    'provisions/codex-hooks.json',
    'src/bootstrap/guidance.mjs',
    'src/bootstrap/readme.mjs',
    'src/bootstrap/recommendation.mjs',
    'src/hooks/suggestions.mjs',
    'src/hooks/git-hooks.mjs',
    'src/integrations/codex-hooks.mjs',
    'src/integrations/codex-hook-history.mjs',
    'src/integrations/runtime-integrations.mjs',
    'src/conformance/run.mjs',
    'src/cli/setup-print.mjs',
    'src/standards-feedback/artifacts.mjs',
    'examples/repo-conformance/veritas-repo-conformance-red.json',
    'examples/repo-conformance/veritas-repo-conformance-red.md',
  ]) {
    assert.ok(files.includes(required), `exec spelling scan must cover ${required}`);
  }
  assert.equal(files.some((file) => file.startsWith('tests/')), false);
  const offenders = [];
  for (const file of files) {
    for (const { number, text } of logicalLines(readFileSync(join(repoRootDir, file), 'utf8'))) {
      const line = withoutRecordedPastCommands(file, text);
      const problems = [...unsafeExec(line), ...bareRunInstruction(line)];
      if (problems.length > 0) offenders.push(`${file}:${number}: ${problems.join('; ')}: ${text.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the exec spelling matcher rejects every registry-fetching or npm-answered form', () => {
  for (const unsafe of [
    'npm exec -- veritas readiness',
    'npm exec --yes -- veritas',
    'npx veritas init',
    'npx --yes veritas',
    'npx @kontourai/veritas readiness',
    'npx --yes @kontourai/veritas readiness',
    'npx --no --yes @kontourai/veritas readiness',
    'npx @kontourai/survey survey-review-mcp',
    'npm exec -- survey-review-mcp --session x',
    'npm exec --no -- veritas readiness',
    'npx --no @kontourai/veritas --version',
    'npx --no @kontourai/veritas --help',
    'npm exec --yes --package="@kontourai/veritas@${v:-1}" -- veritas',
    // npm x is npm exec.
    'npm x -- veritas readiness',
    'npm x --no -- veritas readiness',
    // No option before the name.
    'npm exec veritas readiness',
    'npm exec @kontourai/veritas readiness',
    // The `=` form of --package.
    'npx --package=@kontourai/veritas veritas readiness',
    'npx --package=@kontourai/survey survey-review-mcp',
    'npx -p @kontourai/veritas veritas readiness',
    'npx --no --package=veritas veritas readiness',
    // -v and -h print npm's version and help.
    'npx --no @kontourai/veritas -v',
    'npx --no @kontourai/veritas -h',
    // A second invocation on the same line.
    'npx --no @kontourai/veritas readiness && npx @kontourai/veritas init',
    'npm exec --no -- eslint . && npm exec -- veritas readiness',
    '`npx --no @kontourai/veritas readiness` then `npx @kontourai/veritas attest status`',
    'RESULT=$(npx @kontourai/veritas readiness --format feedback 2>&1)',
    // --no must be exact.
    'npx --no=false @kontourai/veritas readiness',
    'npx --no=true @kontourai/veritas readiness',
    // Download runners always fetch.
    'pnpm dlx @kontourai/veritas readiness',
    'pnpx @kontourai/veritas readiness',
    'yarn dlx @kontourai/veritas readiness',
    'bunx @kontourai/veritas readiness',
    'bun x @kontourai/veritas readiness',
    'bunx --bun @kontourai/veritas readiness',
    'pnpm dlx --package=@kontourai/survey survey-review-mcp',
    'yarn dlx -p @kontourai/survey survey-review-console',
    'pnpx veritas readiness',
    // A value-taking option before the package name.
    'npx --registry https://registry.example.test @kontourai/veritas readiness',
    'npx --prefix /srv/app @kontourai/veritas readiness',
    'npx --cache /tmp/npm-cache --yes @kontourai/veritas readiness',
    'npx --no --prefix "$VERITAS_PREFIX" veritas readiness',
    // Generated text as it appears in source and JSON.
    "    'veritas:check': 'npm exec -- veritas readiness --working-tree',",
    '            "command": "npm exec -- veritas hooks codex pre-tool-use",',
    'exec npm exec -- veritas readiness --format json "$@"',
  ]) {
    assert.notDeepEqual(unsafeExec(unsafe), [], unsafe);
  }
});

test('the exec spelling matcher accepts the standard spellings and other packages', () => {
  for (const safe of [
    'npx --no @kontourai/veritas readiness --working-tree',
    'npx --no @kontourai/veritas -- --version',
    'npx --no @kontourai/veritas -- -v',
    'npx --no @kontourai/veritas init --explore --help',
    'npx --no @kontourai/veritas readiness -h',
    'npx --no -- @kontourai/veritas --version',
    'npm exec --no --package=@kontourai/survey -- survey-review-mcp --session x',
    'npm exec --no --package @kontourai/survey -- survey-review-console',
    'npm exec --yes --package="@kontourai/veritas@${v:?resolve v first}" -- veritas readiness --working-tree',
    'npm exec --no -- eslint .',
    'npx @kontourai/flow-agents kit install',
    'npx -y fallow --format json --quiet',
    'pnpm dlx create-vite',
    'npx --no @kontourai/veritas readiness && npx --no @kontourai/veritas attest status',
    'exec npx --no @kontourai/veritas hooks claude-code pre-tool-use "$@"',
    '            "command": "npx --no @kontourai/veritas hooks codex pre-tool-use",',
    'The `npx` and `npm exec` runners fall back to the registry; `pnpm dlx` always does.',
    'veritas readiness --working-tree',
    'npx --no --prefix "$VERITAS_PREFIX" @kontourai/veritas hooks codex pre-tool-use',
    'npx --registry https://registry.example.test --no @kontourai/veritas readiness',
  ]) {
    assert.deepEqual(unsafeExec(safe), [], safe);
  }
});

test('line continuations are joined before matching', () => {
  const lines = logicalLines('first\nnpx \\\n  @kontourai/veritas readiness\nnpx --no \\\n  @kontourai/veritas readiness');
  assert.deepEqual(lines.map((line) => line.number), [1, 2, 4]);
  assert.notDeepEqual(unsafeExec(lines[1].text), [], lines[1].text);
  assert.deepEqual(unsafeExec(lines[2].text), [], lines[2].text);
});

test('the bare-veritas matchers catch run instructions and leave names and usage alone', () => {
  for (const unsafe of [
    'After changes, run `veritas readiness` and address any FAIL lines before finishing.',
    'Run veritas attest bootstrap --actor <authority-id> --non-interactive.',
    'by running `veritas explain`; use in repositories',
    'form with `veritas explain --file <path> --json`',
    'rerun `veritas init --force` and reapply local policy edits',
    'must re-run `veritas init --explore`',
    "'Use \\`veritas claim add\\` to add claims.'",
    'Agents may prepare\n`veritas attest ... --approval-ref <ref>` commands',
    'run veritas explain --file with the exact intended path.',
  ]) {
    assert.notDeepEqual(bareRunInstruction(unsafe), [], unsafe);
  }
  for (const safe of [
    'After changes, run `npx --no @kontourai/veritas readiness` and address any FAIL lines before finishing.',
    '`veritas readiness` is the primary product command for evaluating a change.',
    "throw new Error('veritas init --apply requires --plan <path>');",
    'npm run veritas:check',
    'run the Veritas `feedback observe --session-log` command',
    'Use Veritas for AI governance with veritas.claims.json committed.',
    'Use the `claim` subcommand to maintain the store:',
  ]) {
    assert.deepEqual(bareRunInstruction(safe), [], safe);
  }
  assert.notDeepEqual(bareRenderedInstruction('The `veritas readiness` command'), []);
  assert.deepEqual(bareRenderedInstruction('The `npx --no @kontourai/veritas readiness` command'), []);
  assert.deepEqual(bareRenderedInstruction('Read `veritas.claims.json` and `.veritas/GOVERNANCE.md`.'), []);
});

// The rendered text Veritas writes into adopter instruction files and readiness results. The
// governance block is copied into every adopter's AGENTS.md and CLAUDE.md and is the most-read line.
test('generated instruction text runs only the installed Veritas', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'veritas-bare-instruction-'));
  writeFileSync(join(rootDir, 'NO_MARKERS.md'), '# Local\n');
  writeFileSync(join(rootDir, 'STALE.md'), '<!-- veritas:governance-block:start -->\nold\n<!-- veritas:governance-block:end -->\n');
  writeFileSync(join(rootDir, 'DUPLICATE.md'), `${buildGovernanceBlock()}\n${buildGovernanceBlock()}\n`);
  writeFileSync(join(rootDir, 'MALFORMED.md'), '<!-- veritas:governance-block:end -->\n');
  const governanceResult = evaluateGovernanceBlockRule(
    { id: 'ai-instruction-files-synced', kind: 'governance-block', match: { 'governance-block': ['MISSING.md', 'NO_MARKERS.md', 'STALE.md', 'DUPLICATE.md', 'MALFORMED.md'] } },
    { rootDir },
  );
  assert.equal(new Set(governanceResult.findings.map(({ remediation }) => remediation)).size, 4);

  const rendered = {
    'governance block': buildGovernanceBlock(),
    '.veritas/GOVERNANCE.md': buildGovernanceInstructions(),
    '.veritas/README.md': buildBootstrapReadme({ projectName: 'demo' }),
    'governance-block summary': governanceResult.summary,
    ...Object.fromEntries(governanceResult.findings.map(({ artifact, remediation }) => [`remediation for ${artifact}`, remediation])),
  };
  const offenders = Object.entries(rendered)
    .filter(([, text]) => bareRenderedInstruction(text).length > 0)
    .map(([name, text]) => `${name}: ${text}`);
  assert.deepEqual(offenders, []);
  assert.match(rendered['governance block'], /run `npx --no @kontourai\/veritas readiness`/);
});
