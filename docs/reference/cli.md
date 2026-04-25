# CLI Reference

This page documents the CLI surface that currently ships in this repo.

All examples here match the command shapes exercised in [tests/framework.test.mjs](../../tests/framework.test.mjs). Most commands print JSON to stdout. The agent-facing exception is `veritas shadow run`, which defaults to lint-style feedback; use `--format json` when you need the previous machine-readable orchestration object.

## Entry Points

- `npm exec -- veritas ...`
- `npm exec -- veritas --help`
- `npm exec -- veritas report --help`
- `npm exec -- veritas <subcommand> --help`
- `node bin/veritas-report.mjs ...`

The convenience `veritas-report` binary defaults to repo-local starter paths:

- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`

## Core Workflow

The shortest end-user path is:

```bash
npm install -D @kontourai/veritas
npm exec -- veritas init
npm exec -- veritas shadow run --working-tree
```

Use `shadow run` when you want proof, evidence, eval-draft orchestration, and agent-readable feedback in one command. Use `report` when you want evidence only. Treat `print` and `apply` as optional installer helpers, not the main product path.

Breaking proof-command migration notes live in [../MIGRATING.md](../MIGRATING.md).

## Commands

### `init`

Bootstraps the starter kit for a target repo.

```bash
npm exec -- veritas init [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--force]
```

Writes:

- `.veritas/GOVERNANCE.md`
- `.veritas/README.md`
- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`
- `.veritas/team/default.team-profile.json`
- `.veritas/evidence/`
- `AGENTS.md` and `CLAUDE.md` governance blocks

`init` keeps stdout machine-readable JSON and prints the suggested CODEOWNERS block to stderr as informational text.

The bootstrap logic infers:

- repo kind: `application`, `workspace`, or `docs`
- likely source roots
- likely test roots
- whether workflows exist
- an initial proof lane from common npm scripts

### `report`

Generates an evidence artifact for a set of files or a repo state slice.

```bash
npm exec -- veritas report [--root <path>] [--adapter <path>] [--policy-pack <path>] [--run-id <id>] [file ...]
npm exec -- veritas report --format feedback --working-tree
npm exec -- veritas report --working-tree
npm exec -- veritas report --staged
npm exec -- veritas report --unstaged --untracked
npm exec -- veritas report --changed-from <ref> --changed-to <ref>
```

Important behaviors:

- explicit files produce `source_kind: "explicit-files"`
- branch comparisons produce `source_kind: "branch-diff"`
- working-tree modes produce `source_kind: "working-tree"`
- the adapter selects proof commands through `requiredProofLanes`, `defaultProofLanes`, and optional `surfaceProofLanes`
- the artifact is written to the adapter-defined `artifactDir`
- JSON is the default output; `--format feedback` prints the same lint-style findings used by hooks

### `shadow run`

Runs proof first, then creates a report, then creates an eval draft, and optionally finishes the eval record if the missing judgment fields are supplied.

```bash
npm exec -- veritas shadow run [--root <path>] [--adapter <path>] [--policy-pack <path>] [--team-profile <path>]
  [--format feedback|json]
  [--proof-command <cmd>] [--skip-proof]
  [--working-tree | --changed-from <ref> --changed-to <ref>]
  [--run-id <id>]
  [--reviewer-confidence <scale-entry|unknown>]
  [--time-to-green-minutes <number>]
  [--override-count <number>]
  [--false-positive-rule <rule-id>]
  [--missed-issue <text>]
  [--note <text>]
  [--accepted-without-major-rewrite <true|false>]
  [--required-followup <true|false>]
  [--force]
```

If `accepted_without_major_rewrite`, `required_followup`, and `time_to_green_minutes` are not all present, the command stops after report plus draft. Feedback mode prints the report path, eval-draft path, and run id in the footer. JSON mode returns the previous orchestration object with the suggested `eval record` command.

Proof commands are executed as tokenized argv, not through an implicit shell. Keep each proof lane to one executable plus arguments, or move compound shell logic into a real script.

Exit codes:

- `0`: no blocking failures
- `1`: proof or blocking policy failure
- `2`: config/runtime error

### `eval draft`

Builds a repo-local draft artifact from a repo-local evidence artifact.

```bash
npm exec -- veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  [--reviewer-confidence <scale-entry|unknown>]
  [--time-to-green-minutes <number>]
  [--override-count <number>]
  [--false-positive-rule <rule-id>]
  [--missed-issue <text>]
  [--note <text>]
```

Guardrail:

- evidence input must be under `.veritas/evidence/`
- the generated draft now includes a derived `governance` object that records whether the evidence touched the governance surface and whether constitutional review is required

### `eval record`

Completes a live-eval record from either evidence directly or a previously created draft.

```bash
npm exec -- veritas eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  --accepted-without-major-rewrite <true|false>
  --required-followup <true|false>
  --reviewer-confidence <scale-entry|unknown>
  --time-to-green-minutes <number>
  --override-count <number>

npm exec -- veritas eval record --draft <path> [--team-profile <path>] [--output <path>] [--force]
  --accepted-without-major-rewrite <true|false>
  --required-followup <true|false>
  --reviewer-confidence <scale-entry|unknown>
  --time-to-green-minutes <number>
  --override-count <number>
```

Guardrails:

- evidence input must stay under `.veritas/evidence/`
- draft input must stay under `.veritas/eval-drafts/`
- a draft must be completed with the same team profile that created it
- the completed record keeps the same derived `governance` object so governance-touching evals can be measured later
- existing output is not overwritten without `--force`

### `eval marker`

Scores a deterministic marker-surfacing benchmark by comparing one `without Veritas` transcript to one `with Veritas` transcript against the same benchmark scenario.

```bash
npm exec -- veritas eval marker \
  --scenario examples/benchmarks/migration-marker-scenario.json \
  --without-veritas-transcript examples/benchmarks/migration-marker-without-veritas.json \
  --with-veritas-transcript examples/benchmarks/migration-marker-with-veritas.json
```

Important behaviors:

- the command is read-only and prints JSON to stdout
- the scenario defines the required marker phrases and the scoring window
- transcripts must declare the matching `benchmark_id` plus the expected `without-veritas` or `with-veritas` condition id
- transcripts must include a trigger tag, and may include a response-window tag when the tagged assistant turn is the response that must carry the marker
- this command scores one benchmark pair; repeat it across multiple runs when you want `pass^k`-style evidence, or use `marker-suite` for the aggregated `pass_pow_k` metric

### `eval marker-suite`

Scores a suite of marker benchmarks and reports aggregate reliability metrics across multiple scenario groups and trials.

```bash
npm exec -- veritas eval marker-suite \
  --suite examples/benchmarks/marker-suite.json
```

Important behaviors:

- the suite artifact references scenario files plus one or more trial transcript pairs per benchmark
- each `benchmark_id` and `trial_id` in the suite must be unique
- aggregate metrics include per-trial rates and grouped reliability summaries
- `improvement_rate` counts trials where Veritas improves outcome quality or delivers the same correct outcome faster
- `pass_at_1` is computed from the first listed trial in each benchmark group
- `pass_at_k` means a benchmark has at least one passing `with Veritas` trial across its recorded trials
- `pass_pow_k` is the suite report name for `pass^k`: every recorded `with Veritas` trial in a benchmark group passes
- the command validates every referenced scenario and transcript before producing a suite summary

### `eval summary`

Reads `.veritas/evals/history.jsonl` and prints recent local outcome metrics.

```bash
npm exec -- veritas eval summary [--root <path>]
```

The summary includes acceptance count, required rewrites, average time to green, average overrides, confidence distribution, and the most flagged false-positive rule.

### `print`

Print-only helpers return suggested content without changing the repo.

```bash
npm exec -- veritas print package-scripts [--root <path>] [--proof-lane <cmd>]
npm exec -- veritas print ci-snippet [--root <path>] [--proof-lane <cmd>]
npm exec -- veritas print git-hook [--root <path>] [--hook post-commit]
npm exec -- veritas print runtime-hook [--root <path>]
npm exec -- veritas print stop-hook [--root <path>] [--tool generic|claude-code|cursor]
npm exec -- veritas print governance-block
npm exec -- veritas print codex-hook [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
```

Printed helper surfaces:

- suggested `package.json` scripts
- a CI snippet
- a tracked git hook body
- a tracked runtime hook body
- a generic stop-hook body and thin tool-specific wrapper configs
- the canonical Veritas governance block
- a tracked Codex hooks config plus optional target inspection status

### `apply`

Write the suggested assets into the repo.

```bash
npm exec -- veritas apply package-scripts [--root <path>] [--proof-lane <cmd>] [--force]
npm exec -- veritas apply ci-snippet [--root <path>] [--output <path>] [--proof-lane <cmd>] [--force]
npm exec -- veritas apply git-hook [--root <path>] [--hook post-commit] [--output <path>] [--configure-git] [--force]
npm exec -- veritas apply runtime-hook [--root <path>] [--output <path>] [--force]
npm exec -- veritas apply stop-hook [--root <path>] [--tool generic|claude-code|cursor] [--output <path>] [--force]
npm exec -- veritas apply governance-blocks [--root <path>] [--force]
npm exec -- veritas apply codex-hook [--root <path>] [--output <path>] [--target-hooks-file <path> | --codex-home <path>] [--force]
```

Write restrictions are intentional:

- CI snippets must stay under `.veritas/snippets/`
- runtime hooks must stay under `.veritas/hooks/`
- stop hooks must stay under `.veritas/hooks/`
- Codex hook artifacts must stay under `.veritas/runtime/`
- eval artifacts must stay under `.veritas/evals/`
- git hooks must stay under `.githooks/`

### `runtime status`

Inspects the installed state of the tracked adapter surfaces.

```bash
npm exec -- veritas runtime status [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
```

It reports:

- whether `.githooks/post-commit` exists and is executable
- whether `core.hooksPath` points at `.githooks`
- whether `.veritas/hooks/agent-runtime.sh` exists and is executable
- whether `.veritas/runtime/codex-hooks.json` exists
- whether the target Codex hooks file already contains the adapter command
- the next repair or install commands to run

## Generated Hook Behavior

`print git-hook` and `apply git-hook` produce a `post-commit` hook that:

- skips itself when `VERITAS_HOOK_SKIP=1`
- also honors legacy `AI_GUIDANCE_HOOK_SKIP=1`
- compares `HEAD~1..HEAD` on normal commits
- uses the empty tree for the first commit
- calls `veritas shadow run`

`print runtime-hook` and `apply runtime-hook` produce a shell wrapper that:

- skips itself when `VERITAS_HOOK_SKIP=1`
- also honors legacy `AI_GUIDANCE_HOOK_SKIP=1`
- defaults to `veritas shadow run --format json --working-tree`
- forwards any explicit arguments through to `shadow run --format json`

`print stop-hook` and `apply stop-hook` produce `.veritas/hooks/stop.sh`, which:

- skips itself when `VERITAS_HOOK_SKIP=1`
- runs `veritas shadow run --format feedback --working-tree`
- prints failures back to the agent
- exits `0` so the AI session can continue and repair the findings

`print codex-hook` and `apply codex-hook` produce a tracked Codex config that installs the runtime hook as a `Stop` hook.

## Environment Variables

- `VERITAS_HOOK_SKIP=1`: skips generated git/runtime hook execution
- `AI_GUIDANCE_HOOK_SKIP=1`: legacy alias still honored by generated hooks

Do not set either skip variable in CI if the CI lane is meant to enforce proof execution.

## Output Shape

The exact JSON varies by command, but the operator-facing contract is stable:

- print/apply commands return machine-readable status objects
- report returns `artifactPath`, `markdownSummary`, and the full evidence record including `policy_results`
- eval draft returns `artifactPath`, `suggestedRecordCommand`, `markdownSummary`, and the full draft record
- eval record returns `artifactPath`, `historyPath`, `markdownSummary`, and the full eval record
- eval summary returns a plain-text local history summary
- eval marker returns a benchmark comparison object with per-condition timing, false-positive, and pass results
- eval marker-suite returns a suite report with per-benchmark rollups and aggregate reliability metrics
- shadow run defaults to feedback text; `--format json` returns orchestration status plus the artifact paths it created

For the artifact fields themselves, see [Artifacts and Schemas](artifacts-and-schemas.md).
