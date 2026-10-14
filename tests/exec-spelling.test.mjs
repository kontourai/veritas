import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREVIOUS_CODEX_HOOK_COMMANDS } from '../src/integrations/codex-hook-history.mjs';
import { PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS } from '../src/hooks/claude-code-hook-history.mjs';
import { buildSuggestedClaudeCodePostSessionHook } from '../src/hooks/suggestions.mjs';
import { buildSuggestedCodexHookConfig } from '../src/integrations/codex-hooks.mjs';
import { buildGovernanceBlock } from '../src/governance.mjs';
import { buildGovernanceInstructions } from '../src/bootstrap/guidance.mjs';
import { buildBootstrapReadme } from '../src/bootstrap/readme.mjs';
import { evaluateGovernanceBlockRule } from '../src/rules/evaluate.mjs';
import { buildAttestationPolicyResult } from '../src/attestations.mjs';
import { buildFeedbackSummary } from '../src/report/format.mjs';
import { formatPreToolUseGuidance } from '../src/hooks/pre-tool-use.mjs';
import { buildExplainGuidance, buildExplainText } from '../src/explain.mjs';
import { buildInitRecommendation } from '../src/bootstrap/recommendation.mjs';
import { setupRepoHooks } from '../src/hooks/git-hooks.mjs';
import { inspectRuntimeIntegrationStatus } from '../src/integrations/runtime-integrations.mjs';
import { buildConformanceAlerts } from '../src/conformance/run.mjs';
import { runPrintCodexHookCli } from '../src/cli/setup-print.mjs';
import { buildStandardsFeedbackRecordCommand } from '../src/standards-feedback/artifacts.mjs';
import { tempDir } from './temp-dir.mjs';

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
// reader to run it sends a shell to "command not found", and the natural recovery, putting npx in
// front, fetches the unscoped package. Usage and error text that names the command being invoked
// ("veritas init requires --plan") and prose that names a command ("`veritas readiness` is the
// primary command") are not instructions. Three checks, each for lowercase `veritas` followed by a
// subcommand:
// - generator seams: the tests below call the code that writes adopter files, readiness results and
//   next steps, and require every command-valued field, every fenced shell line and every code span
//   in the rendered text that runs Veritas to start with the standard spelling;
// - shipped files: a fenced shell line or a `$ veritas` prompt line that runs it (escaped template
//   backticks read as backticks, continuations joined);
// - shipped files: a run verb before it, matched across line breaks. This catches prose
//   instructions the seams do not render; it is a backstop, not the guard for generated text.
const SAFE_VERITAS = 'npx --no @kontourai/veritas ';
const RUN_VERB = '(?:[Rr]un|[Rr]unning|[Rr]e-?run|[Uu]se|[Pp]repare|[Tt]ry)';
const BARE_RUN = new RegExp(`\\b${RUN_VERB}\\s+\\\\?\`?veritas\\s+[a-z]`);
const BARE_SPAN = /`veritas\s+[a-z]/;

function bareRunInstruction(text) {
  return BARE_RUN.test(text) ? ['bare veritas in a run instruction'] : [];
}

// A shell line runs bare Veritas when one of its commands, after a `$ ` prompt and any VAR=value
// assignments, starts with the word `veritas` and a subcommand.
function runsBareVeritas(line) {
  return line.split(/&&|\|\||\$\(|[;|()`]/).some((segment) => {
    const words = segment.trim().replace(/^\$\s+/, '').split(/\s+/);
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (words[0] === 'exec') words.shift();
    return words[0] === 'veritas' && /^[a-z]/.test(words[1] ?? '');
  });
}

// Lines of unlabeled, shell and YAML fences (continuations joined; a YAML `run:` key read as the
// command it runs), and `$ ` prompt lines outside fences, that run bare Veritas. JSON and other
// fences hold data, where `veritas readiness` is a string, not a command.
const SHELL_FENCE = /^(|bash|sh|shell|zsh|console|shell-session|yaml|yml)$/;
function bareShellLines(markdown) {
  const found = [];
  let fenced = false;
  let shellFence = false;
  let block = [];
  const flush = (startNumber) => {
    for (const { number, text } of logicalLines(block.join('\n'))) {
      if (runsBareVeritas(text.replace(/^\s*-?\s*run:\s*/, ''))) found.push({ number: startNumber + number, text: text.trim() });
    }
    block = [];
  };
  let fenceStart = 0;
  markdown.replaceAll('\\`', '`').split('\n').forEach((line, index) => {
    const fence = line.match(/^\s*(?:```|~~~)\s*([\w-]*)/);
    if (fence) {
      if (fenced) flush(fenceStart);
      else {
        fenceStart = index + 1;
        shellFence = SHELL_FENCE.test(fence[1].toLowerCase());
      }
      fenced = !fenced;
    } else if (fenced) {
      if (shellFence) block.push(line);
    } else if (/^\s*\$\s+veritas\s+[a-z]/.test(line)) {
      found.push({ number: index + 1, text: line.trim() });
    }
  });
  if (fenced) flush(fenceStart);
  return found;
}

function bareRenderedInstruction(text) {
  return [
    ...bareRunInstruction(text),
    ...(BARE_SPAN.test(text) ? ['bare veritas in a code span'] : []),
    ...bareShellLines(text).map(({ text: line }) => `bare veritas in a shell line: ${line}`),
  ];
}

// Every string under a key that names a command (suggestedCommand, apply_command, nextCommands, ...),
// except a hook's own `command`, which the shipped-file scan reads.
function commandFields(value, path = '$') {
  if (Array.isArray(value)) return value.flatMap((item, index) => commandFields(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (key !== 'command' && /command/i.test(key)) {
      const strings = typeof child === 'string' ? [child] : Array.isArray(child) ? child.filter((item) => typeof item === 'string') : [];
      return [...strings.map((command) => ({ path: childPath, command })), ...commandFields(child, childPath)];
    }
    return commandFields(child, childPath);
  });
}

const invokesVeritas = (command) => /(^|[\s/])veritas\s+[a-z]/.test(command);

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

// The files allowed to hold earlier spellings: the records of exact commands earlier releases wrote
// into Codex hooks files and Claude Code settings, kept so a reinstall can remove them. Only those
// recorded strings are exempt; anything else in the files is scanned like every other line.
const RECORDED_PAST_COMMANDS = Object.values(PREVIOUS_CODEX_HOOK_COMMANDS).flat();
const PAST_OUTPUT_RECORDS = new Map([
  ['src/integrations/codex-hook-history.mjs', RECORDED_PAST_COMMANDS],
  ['src/hooks/claude-code-hook-history.mjs', PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS],
]);
const withoutRecordedPastCommands = (file, line) => (PAST_OUTPUT_RECORDS.get(file) ?? [])
  .reduce((text, command) => text.replaceAll(command, ''), line);

test('the record of past Claude Code PostSession commands holds only earlier commands', () => {
  assert.equal(PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS.length, 3);
  // v0.4.0 and v0.5.0 through v1.11.0 ran npm exec without --no; v1.11.1 and v1.11.2 ran npx --no.
  assert.deepEqual(PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS.map((command) => unsafeExec(command).length > 0), [true, true, false]);
  const current = Object.values(buildSuggestedClaudeCodePostSessionHook().toolConfig.hooks)
    .flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command)));
  for (const command of PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS) assert.equal(current.includes(command), false, command);
});

test('the record of past Codex hook commands holds only earlier commands', () => {
  // Three unsafe spellings from v0.4.0 through v1.11.0, and the two v1.11.1 walk commands, which ran
  // npx --no --prefix and could run another veritas on PATH (#286).
  assert.equal(RECORDED_PAST_COMMANDS.length, 5);
  assert.equal(RECORDED_PAST_COMMANDS.filter((command) => unsafeExec(command).length > 0).length, 3);
  assert.equal(RECORDED_PAST_COMMANDS.filter((command) => command.includes('npx --no --prefix "$VERITAS_PREFIX"')).length, 2);
  const current = new Set(Object.values(buildSuggestedCodexHookConfig().hooks)
    .flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command))));
  for (const command of RECORDED_PAST_COMMANDS) {
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
    'src/hooks/claude-code-hook-history.mjs',
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
      const problems = unsafeExec(line);
      if (problems.length > 0) offenders.push(`${file}:${number}: ${problems.join('; ')}: ${text.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('shipped text never tells a reader to run bare veritas', () => {
  const offenders = [];
  for (const file of shippedFiles()) {
    const text = readFileSync(join(repoRootDir, file), 'utf8');
    for (const { number, text: line } of bareShellLines(text)) offenders.push(`${file}:${number}: shell line: ${line}`);
    // Across line breaks, so a verb that ends one line still binds the command that starts the next.
    const runPattern = new RegExp(BARE_RUN.source, 'g');
    for (const match of text.matchAll(runPattern)) {
      const number = text.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${number}: run instruction: ${match[0].replace(/\s+/g, ' ')}`);
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
    'rerun `veritas init --force` and reapply local policy edits',
    'must re-run `veritas init --explore`',
    "'Use \\`veritas claim add\\` to add claims.'",
    'Agents may run\n`veritas attest ... --approval-ref <ref>` commands',
    'run veritas explain --file with the exact intended path.',
  ]) {
    assert.notDeepEqual(bareRunInstruction(unsafe), [], unsafe);
  }
  for (const safe of [
    'After changes, run `npx --no @kontourai/veritas readiness` and address any FAIL lines before finishing.',
    '`veritas readiness` is the primary product command for evaluating a change.',
    "throw new Error('veritas init --apply requires --plan <path>');",
    'npm run veritas:check',
    'A copy retained with `veritas readiness --projection-output <path>` is owned by the caller.',
    'generated runtime hooks before they call `veritas feedback observe --session-log`.',
    'Use Veritas for AI governance with veritas.claims.json committed.',
  ]) {
    assert.deepEqual(bareRunInstruction(safe), [], safe);
  }
  for (const unsafe of [
    '```bash\nveritas readiness\n```',
    '```\nnpm install\nveritas readiness --working-tree\n```',
    '```sh\n$ veritas init\n```',
    '```bash\nRESULT=$(veritas readiness --format feedback)\n```',
    '```bash\nVERITAS_ACTOR=me veritas attest status\n```',
    '```bash\nnpm test && veritas readiness\n```',
    '```bash\nexec veritas hooks claude-code pre-tool-use\n```',
    '```yaml\n      - run: veritas readiness --changed-from main --changed-to HEAD\n```',
    '\\`\\`\\`bash\nveritas readiness\n\\`\\`\\`',
    'Then:\n\n$ veritas readiness --working-tree\n',
  ]) {
    assert.notDeepEqual(bareShellLines(unsafe), [], unsafe);
  }
  for (const safe of [
    '```bash\nnpx --no @kontourai/veritas readiness\n```',
    '```bash\nnpx --no @kontourai/veritas readiness --check evidence \\\n  --repo-map ./.veritas/repo-map.json\n```',
    '```\nveritas: 3 files changed -> app.src\n```',
    '```json\n{ "command": "veritas readiness" }\n```',
    '```json\n"(veritas readiness|scripts/check-veritas-vocabulary\\\\.mjs)"\n```',
    'veritas readiness --working-tree',
  ]) {
    assert.deepEqual(bareShellLines(safe), [], safe);
  }
  assert.notDeepEqual(bareRenderedInstruction('The `veritas readiness` command'), []);
  assert.deepEqual(bareRenderedInstruction('The `npx --no @kontourai/veritas readiness` command'), []);
  assert.deepEqual(bareRenderedInstruction('Read `veritas.claims.json` and `.veritas/GOVERNANCE.md`.'), []);
  assert.deepEqual(
    commandFields({ a: { suggestedCommand: 'x', hooks: [{ command: 'hook' }] }, nextCommands: ['y', 'z'], apply_command: 'w' })
      .map(({ path, command }) => `${path}=${command}`),
    ['$.a.suggestedCommand=x', '$.nextCommands=y', '$.nextCommands=z', '$.apply_command=w'],
  );
});

function captureStdout(run) {
  const original = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };
  try {
    run();
  } finally {
    process.stdout.write = original;
  }
  return output;
}

function gitRepo(t, prefix) {
  const rootDir = tempDir(t, prefix);
  execFileSync('git', ['init', '-q'], { cwd: rootDir });
  return rootDir;
}

function assertRunsInstalledVeritas(label, { texts = {}, values = {} }) {
  const offenders = [];
  for (const [name, text] of Object.entries(texts)) {
    for (const problem of bareRenderedInstruction(text)) offenders.push(`${label} ${name}: ${problem}`);
  }
  const commands = Object.entries(values).flatMap(([name, value]) => commandFields(value, name));
  for (const { path, command } of commands) {
    if (invokesVeritas(command) && !command.startsWith(SAFE_VERITAS)) offenders.push(`${label} ${path}: ${command}`);
  }
  assert.deepEqual(offenders, []);
  return commands.filter(({ command }) => invokesVeritas(command));
}

// What Veritas writes into adopter repositories and prints as next steps, rendered by the code that
// produces it. The governance block is copied into every adopter's AGENTS.md and CLAUDE.md and is
// the most-read line.
test('generated instruction files and readiness results run only the installed Veritas', (t) => {
  const rootDir = tempDir(t, 'veritas-bare-instruction-');
  writeFileSync(join(rootDir, 'NO_MARKERS.md'), '# Local\n');
  writeFileSync(join(rootDir, 'STALE.md'), '<!-- veritas:governance-block:start -->\nold\n<!-- veritas:governance-block:end -->\n');
  writeFileSync(join(rootDir, 'DUPLICATE.md'), `${buildGovernanceBlock()}\n${buildGovernanceBlock()}\n`);
  writeFileSync(join(rootDir, 'MALFORMED.md'), '<!-- veritas:governance-block:end -->\n');
  const governanceResult = evaluateGovernanceBlockRule(
    { id: 'ai-instruction-files-synced', kind: 'governance-block', match: { 'governance-block': ['MISSING.md', 'NO_MARKERS.md', 'STALE.md', 'DUPLICATE.md', 'MALFORMED.md'] } },
    { rootDir },
  );
  assert.equal(new Set(governanceResult.findings.map(({ remediation }) => remediation)).size, 4);

  const attestationResults = [
    buildAttestationPolicyResult({ state: 'drifted', drift: [{ field: 'repoStandardsHash', attested: 'a', current: 'b' }] }),
    buildAttestationPolicyResult({ state: 'missing' }),
    buildAttestationPolicyResult({ state: 'active', expired: true, currentAttestationId: 'x', validUntil: '2026-01-01' }),
  ];
  const remediations = [...governanceResult.findings, ...attestationResults.flatMap(({ findings }) => findings)]
    .map(({ artifact, remediation }) => [`remediation for ${artifact}`, remediation]);
  assert.equal(remediations.filter(([, text]) => text.includes(SAFE_VERITAS)).length, 8);

  const readmeVariants = {
    'README (defaults)': buildBootstrapReadme({ projectName: 'demo' }),
    'README (every branch)': buildBootstrapReadme({
      projectName: 'demo',
      evidenceCheck: 'npm run verify',
      recommendationSummary: 'Adopt the starter standards.',
      ownerAnswers: { replaceExistingGovernance: false },
      repoInsights: {
        repoKind: 'library',
        sourceRoots: ['src'],
        toolingRoots: ['scripts'],
        testRoots: ['tests'],
        productRoots: ['packages/a'],
        hasWorkflows: true,
        matchedScripts: ['test'],
        enableWorkAreaEvidenceRouting: true,
      },
    }),
  };
  for (const readme of Object.values(readmeVariants)) {
    const fencedVeritas = readme.split('\n').filter((line) => line.startsWith(SAFE_VERITAS));
    assert.equal(fencedVeritas.length, 5, 'the README template suggests five Veritas commands');
  }

  const pre = formatPreToolUseGuidance({
    selector: { kind: 'file', value: 'src/a.js' },
    rules: Array.from({ length: 13 }, (_, index) => ({
      id: `r${index}`, enforcementLevel: 'Guide', summary: 's', evidenceCheckIds: [], mustDo: [], mustNotDo: [], contextLinks: [],
    })),
  });
  assert.match(pre, /1 more rule\(s\)/);

  assertRunsInstalledVeritas('generated', {
    texts: {
      'governance block': buildGovernanceBlock(),
      '.veritas/GOVERNANCE.md': buildGovernanceInstructions(),
      ...readmeVariants,
      'governance-block summary': governanceResult.summary,
      ...Object.fromEntries(remediations),
      'PreToolUse overflow': pre,
    },
  });
  assert.match(buildGovernanceBlock(), /run `npx --no @kontourai\/veritas readiness`/);
});

test('the readiness feedback footer runs only the installed Veritas', () => {
  const summary = buildFeedbackSummary({
    record: {
      files: [],
      components: [],
      policy_results: [],
      evidence_inventory_results: [],
      external_tool_results: [],
      trust: { report: { claims: [{ id: 'rec-1', claimType: 'veritas-recommendation', status: 'proposed' }] } },
    },
  });
  assert.match(summary, /recommendations: 1 open/);
  assert.equal(summary.split('\n').filter((line) => line.includes(SAFE_VERITAS.trim())).length, 2);
  assertRunsInstalledVeritas('feedback', { texts: { footer: summary } });
});

test('init, setup, integration status and conformance next steps run only the installed Veritas', (t) => {
  const initRoot = gitRepo(t, 'veritas-bare-init-');
  writeFileSync(join(initRoot, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(initRoot, 'CLAUDE.md'), '# Claude\n');
  const init = JSON.parse(execFileSync(process.execPath, [join(repoRootDir, 'bin/veritas.mjs'), 'init', '--root', initRoot], {
    cwd: initRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const recommendation = buildInitRecommendation({ rootDir: gitRepo(t, 'veritas-bare-plan-') });
  const explained = buildExplainGuidance({
    rootDir: initRoot,
    repoMap: JSON.parse(readFileSync(join(initRoot, '.veritas/repo-map.json'), 'utf8')),
    repoStandards: JSON.parse(readFileSync(join(initRoot, '.veritas/repo-standards/default.repo-standards.json'), 'utf8')),
    ruleId: 'policy-changes-require-attestation',
  });
  assert.ok(explained.rules.some((rule) => rule.id === 'policy-changes-require-attestation'), 'explain must reach the attestation guidance');
  const explainText = buildExplainText({
    rootDir: initRoot,
    repoMap: JSON.parse(readFileSync(join(initRoot, '.veritas/repo-map.json'), 'utf8')),
    repoStandards: JSON.parse(readFileSync(join(initRoot, '.veritas/repo-standards/default.repo-standards.json'), 'utf8')),
    ruleId: 'policy-changes-require-attestation',
  });
  assert.match(explainText, /Governance: `npx --no @kontourai\/veritas attest \.\.\./);
  assert.deepEqual(
    Object.keys(recommendation.artifact_payloads).filter((path) => path.endsWith('.md')).sort(),
    ['.veritas/GOVERNANCE.md', '.veritas/README.md'],
  );
  const initWritten = ['.veritas/GOVERNANCE.md', '.veritas/README.md', 'AGENTS.md', 'CLAUDE.md']
    .map((path) => [`init wrote ${path}`, readFileSync(join(initRoot, path), 'utf8')]);
  const hooksRoot = gitRepo(t, 'veritas-bare-hooks-');
  const setup = setupRepoHooks({ rootDir: hooksRoot });

  // Every branch of the status next steps: nothing installed; then hooks, runtime hook and Codex
  // artifact present but not executable, with a Codex home and with a hooks file checked.
  const bareRoot = gitRepo(t, 'veritas-bare-status-');
  const missing = inspectRuntimeIntegrationStatus(bareRoot);
  const presentRoot = gitRepo(t, 'veritas-bare-present-');
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: presentRoot });
  for (const file of ['.githooks/post-commit', '.githooks/pre-push', '.veritas/hooks/agent-runtime.sh', '.veritas/runtime/codex-hooks.json']) {
    mkdirSync(dirname(join(presentRoot, file)), { recursive: true });
    writeFileSync(join(presentRoot, file), '#!/bin/sh\n', { mode: 0o644 });
  }
  const codexHome = tempDir(t, 'veritas-bare-codex-home-');
  const present = inspectRuntimeIntegrationStatus(presentRoot, { codexHome });
  const targeted = inspectRuntimeIntegrationStatus(presentRoot, { targetHooksFile: '.codex/hooks.json' });
  const alerts = [missing, present].flatMap((status) => buildConformanceAlerts(
    { record: { policy_results: [], unresolved_files: [] } },
    status,
    false,
  ));
  const printed = ['--codex-home', '--target-hooks-file'].map((option) => JSON.parse(captureStdout(
    () => runPrintCodexHookCli(['--root', presentRoot, option, option === '--codex-home' ? codexHome : '.codex/hooks.json']),
  )));
  const draftCommand = buildStandardsFeedbackRecordCommand('.kontourai/veritas/standards-feedback-drafts/run-1.json', {
    prefilled_outcome: { reviewer_confidence: 'medium' },
    prefilled_measurements: { time_to_green_minutes: null, exception_count: 0, false_positive_rules: [], missed_issues: [] },
    notes: [],
  });

  const commands = assertRunsInstalledVeritas('next steps', {
    texts: {
      ...Object.fromEntries(initWritten),
      ...Object.fromEntries(Object.entries(recommendation.artifact_payloads ?? {})
        .filter(([path]) => path.endsWith('.md'))
        .map(([path, text]) => [`init plan ${path}`, text])),
      'explain guidance': JSON.stringify(explained.rules.flatMap((rule) => [...rule.mustDo, ...rule.mustNotDo])),
      'explain text': explainText,
    },
    values: { init, recommendation, setup, missing, present, targeted, alerts, printed, draft: { suggestedRecordCommand: draftCommand } },
  });
  // Pinned independently of the generators: the distinct Veritas next steps these fixtures reach.
  const distinct = new Set(commands.map(({ command }) => command.replace(/(--root|--codex-home|--target-hooks-file) \S+/g, '$1 <x>')));
  for (const expected of [
    'npx --no @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <approval-reference> --non-interactive --root <x>',
    'npx --no @kontourai/veritas init --apply --plan <path-to-this-artifact>',
    'npx --no @kontourai/veritas setup repo-hooks',
    'npx --no @kontourai/veritas setup repo-hooks --force',
    'npx --no @kontourai/veritas integrations codex install',
    'npx --no @kontourai/veritas integrations codex install --force',
    'npx --no @kontourai/veritas integrations codex status --codex-home <x>',
    'npx --no @kontourai/veritas integrations codex install --codex-home <x> --force',
    'npx --no @kontourai/veritas integrations codex install --target-hooks-file <x> --force',
    'npx --no @kontourai/veritas apply codex-hook --codex-home <x>',
    'npx --no @kontourai/veritas apply codex-hook --target-hooks-file <x>',
  ]) {
    assert.ok(distinct.has(expected), `fixtures must reach: ${expected}\nreached: ${[...distinct].join('\n')}`);
  }
  assert.ok([...distinct].some((command) => command.startsWith(`${SAFE_VERITAS}feedback record`)), [...distinct].join('\n'));
});
