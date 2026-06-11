# CLI Reference

This page documents the CLI surface that currently ships in this repo.

The primary CLI surface is eight verbs: `init`, `readiness`, `explain`, `attest`, `recommendation`, `feedback`, `setup`, `integrations`. Most commands print JSON to stdout. The developer- and agent-facing readiness feedback path prints lint-style text by default; use `--format json` when you need machine-readable orchestration output.

## Entry Points

- `npx @kontourai/veritas ...`
- `npx @kontourai/veritas --help`
- `npx @kontourai/veritas readiness --help`
- `npx @kontourai/veritas readiness --check evidence --help`
- `npx @kontourai/veritas <subcommand> --help`
- `node bin/veritas-report.mjs ...`

The convenience `veritas-report` binary defaults to repo-local starter paths:

- `.veritas/repo-map.json`
- `.veritas/repo-standards/default.repo-standards.json`

## Core Workflow

The shortest current path is:

```bash
npm install -D @kontourai/veritas
npx @kontourai/veritas init
npx @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
npx @kontourai/veritas readiness --working-tree
```

Use `readiness` when you want evidence checks, generated evidence, standards feedback capture, and change guidance in one command.

Use `readiness --check coverage` when you want readiness coverage. The product question it answers is "what evidence is complete, missing, stale, or needs review?"

Breaking evidence-check migration notes live in [../MIGRATING.md](../MIGRATING.md).

## Commands

### `readiness`

Runs the requested check. Without `--check`, this is the agent-facing feedback path.

```bash
npx @kontourai/veritas readiness [--check evidence|boundaries|coverage] [--root <path>] [--working-tree]
npx @kontourai/veritas readiness --check boundaries --actor cli-team [--diff main]
```

`readiness` is the recommended current front door for evidenceCheck execution, generated evidence, standards feedback drafting, and change guidance. `readiness --check boundaries` replaces `boundaries check`. `readiness --check coverage` is the current command for readiness coverage. `readiness --check evidence` is the current command for the lower-level generated evidence path.

### `init`

Bootstraps starter Repo Standards and a Repo Map for a target repo.

```bash
npx @kontourai/veritas init [--root <path>] [--project-name <name>] [--evidence-check <cmd>] [--template <name>] [--force] [--non-interactive]
npx @kontourai/veritas init --explore [--root <path>] [--project-name <name>] [--evidence-check <cmd>] [--output .veritas/init-plans/<name>.json]
npx @kontourai/veritas init --guided --answers <answers.json> [--root <path>] [--project-name <name>] [--output .veritas/init-plans/<name>.json]
npx @kontourai/veritas init --apply --plan <path> [--root <path>] [--force]
```

Writes:

- `.veritas/GOVERNANCE.md`
- `.veritas/README.md`
- `.veritas/repo-map.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/authority/default.authority-settings.json`
- `.veritas/evidence/`
- `AGENTS.md` and `CLAUDE.md` governance blocks

`--template` replaces generated starter standards with a named example template. Shipped templates currently include `nextjs-typescript`, `python-fastapi`, and `monorepo-pnpm`.

`init` keeps stdout machine-readable JSON and prints the suggested CODEOWNERS block to stderr as informational text.

In `--non-interactive` mode, `init` writes `.veritas/attestations/PENDING` instead of recording an attestation. Run `attest bootstrap` after a trusted authority reviews the generated protected standards.

The bootstrap logic infers:

- repo kind: `application`, `workspace`, or `docs`
- likely source roots
- likely test roots
- whether workflows exist
- an initial evidenceCheck from common npm scripts

Guided initialization splits setup into a reviewed artifact flow:

- `--explore` inspects the repo and emits a recommendation JSON without writing starter files.
- `--guided --answers <answers.json>` folds owner-provided boundaries, style, evidence-check, and instruction-target choices into the recommendation.
- `--output` is intentionally constrained to `.veritas/init-plans/` so reviewed setup plans stay repo-local and obvious.
- `--apply --plan <path>` is the only guided write path. It validates the plan schema, target root, payload hashes, and overwrite rules before writing.
- Brownfield repos with existing guidance or convergence scripts also receive an `existing_verification` inventory and a recommended evidence-check inventory. Unknown catch evidence stays candidate/advisory until a maintainer supplies owner and review evidence.
- Unknown init flags fail before any files are written.

### `attest`

Records or inspects attestations for protected standards.

```bash
npx @kontourai/veritas attest bootstrap --actor <id> --approval-ref <ref> [--root <path>] [--non-interactive] [--valid-until-days <days>]
npx @kontourai/veritas attest policy-change --actor <id> --approval-ref <ref> --message <text> [--root <path>] [--valid-until-days <days>]
npx @kontourai/veritas attest status [--root <path>]
```

`bootstrap` records the first reviewed hashes for the current protected standards files: `.veritas/repo-map.json`, `.veritas/repo-standards/default.repo-standards.json`, and `.veritas/authority/default.authority-settings.json`. `policy-change` records a reviewed successor and requires an explanation in `--message`. Both write paths require `--approval-ref`, a durable reference to the explicit human approval that authorized the attestation. `status` reports the current attestation, age, expiry, and hash drift.

The built-in requirement `policy-changes-require-attestation` fails when the active attestation no longer matches protected standards.

### `hooks claude-code`

Prints, installs, or runs the Claude Code PreToolUse hook.

```bash
npx @kontourai/veritas hooks claude-code print [--root <path>]
npx @kontourai/veritas hooks claude-code apply [--root <path>] [--force]
npx @kontourai/veritas hooks claude-code pre-tool-use [--root <path>] [--file <path>] [--actor <id>]
```

`pre-tool-use` reads the Claude hook JSON payload from stdin, extracts `tool_input.file_path` or `tool_input.path`, resolves the actor from `--actor`, `VERITAS_ACTOR`, or the current attestation, and returns hook protocol JSON. Deny-enforced failures return `decision: "block"` and exit non-zero. Set `VERITAS_EXCEPTION_RULE` and `VERITAS_EXCEPTION_REASON` to allow a specific denied rule and append an exception record.

### `integrations`

Installs or inspects runtime integrations through the tool-agnostic integration namespace.

```bash
npx @kontourai/veritas integrations codex status
npx @kontourai/veritas integrations claude-code install [--root <path>] [--force]
npx @kontourai/veritas integrations cursor install [--root <path>] [--force]
npx @kontourai/veritas integrations copilot status [--root <path>]
```

Codex and Claude Code have session log readers. Claude Code install wires PreToolUse, Stop, and PostSession hooks. Cursor and Copilot currently install generic stop-hook wiring and report `sessionLogReader: null`.

Answers are JSON and may include:

```json
{
  "evidenceCheck": "npm run verify",
  "selectedInstructionTargets": ["AGENTS.md", "CLAUDE.md"],
  "boundaries": ["Do not edit generated snapshots without approval."],
  "codingStyle": "Prefer small ESM modules.",
  "releaseExpectations": "Run npm test and npm run verify before merge."
}
```

`selectedInstructionTargets` controls the AI instruction files that `--apply` mutates and the governance-block requirement that starter Repo Standards enforce.

### `report`

Generates an evidence artifact for a set of files or a repo state slice.

```bash
npx @kontourai/veritas readiness --check evidence [--root <path>] [--repo-map <path>] [--repo-standards <path>] [--run-id <id>] [file ...]
npx @kontourai/veritas readiness --check evidence --format feedback --working-tree
npx @kontourai/veritas readiness --check evidence --working-tree
npx @kontourai/veritas readiness --check evidence --staged
npx @kontourai/veritas readiness --check evidence --unstaged --untracked
npx @kontourai/veritas readiness --check evidence --changed-from <ref> --changed-to <ref>
npx @kontourai/veritas readiness --check evidence --trend
```

Important behaviors:

- explicit files produce `source_kind: "explicit-files"`
- branch comparisons produce `source_kind: "branch-diff"`
- working-tree modes produce `source_kind: "working-tree"`

Every report also includes an `integrity` block. `integrity.sourceRef` mirrors the source anchor used for staleness decisions, `integrity.fileRefs` records readable changed-file fingerprints, and `integrity.configRefs` records hashes for Repo Map, Repo Standards, and settings files when those paths are available. Surface Console views use this to explain what a verified claim was actually verified against.
- the Repo Map selects evidenceCheck commands through explicit evidenceCheck definitions, required check ids, default check ids, and optional routes
- the artifact is written to the Repo Map-defined `artifactDir`
- every artifact includes `trust.bundle`, a Surface `TrustBundle` projection with claims, evidence, policies, and events
- Veritas owns repo-native claimGroup and Surface owns generic validation and report generation
- JSON is the default output; `--format feedback` prints the same lint-style findings used by hooks
- `--trend` prints the standards-feedback trend with sparklines and MTTR instead of generating a new report

### `explain`

Prints only the standards explanation relevant to a requirement, work area, or file.

```bash
npx @kontourai/veritas explain required-veritas-schema-artifacts
npx @kontourai/veritas explain --file src/index.mjs
npx @kontourai/veritas explain --work-area app.src
```

Output is capped to fit an agent context window and includes the local governance excerpt plus matching rule `explain` blocks.

### `boundaries check` (legacy)

Checks strict work area ownership for a working tree or diff. Prefer `readiness --check boundaries` instead; `boundaries check` remains available for backward compatibility.

```bash
npx @kontourai/veritas readiness --check boundaries --actor cli-team [--working-tree | --diff main]
```

`--actor` is required unless `VERITAS_ACTOR` is set. Veritas intentionally does not fall back to the operating-system user, because CI runner names and shell usernames are not governance actors. If no actor is supplied, the command exits non-zero with a missing-actor failure.

Strict nodes fail when the actor is neither an owner nor listed in `boundaryAllow`. This means a working tree that spans several strict work areas may legitimately fail for one actor while passing for another owner or allowlisted actor.

To turn a Veritas readiness artifact into a Surface trust report, use the `reportArtifactPath` returned by `veritas readiness --format json` as the stable path. Do not reconstruct `.veritas/evidence/<run-id>.json` in downstream tools.

```bash
artifact_path="$(npx @kontourai/veritas readiness --working-tree --format json | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const parsed = JSON.parse(data); if (!parsed.reportArtifactPath) throw new Error("missing reportArtifactPath"); console.log(parsed.reportArtifactPath); });')"
node -e 'const fs = require("node:fs"); const artifact = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(JSON.stringify(artifact.trust.bundle, null, 2));' "$artifact_path" > .veritas/external/surface-bundle.json
surface report --repo-map surface --input .veritas/external/surface-bundle.json --format summary
```

Portable consumers can find merge readiness by selecting `trust.bundle.claims[]` or generated `trust.report.claims[]` where `claimType` is `software-readiness-verdict` and `subjectType` is `repository-change`. Integrity scope is available in claim/evidence metadata; authority trace is available as first-class `trust.bundle.authorityTrace`.

Surface generates report-only fields such as `id`, `generatedAt`, `summary`, `transparencyGaps`, and `evidenceRequirementsByClaimId`. Veritas owns repo-native evidence collection and projection; Surface owns generic validation and report generation.

Current evidence artifacts also include `trust.report`, a compact summary generated by Surface's `buildTrustReport`. `veritas readiness` emits WARN lines for Surface-derived stale or disputed claims, and `veritas explain <rule-id>` includes the latest Surface claim status and transparency gaps for the matching policy claim.

### `coverage`

Prints readiness coverage without requiring operators to read the full report artifact.

```bash
npx @kontourai/veritas readiness --check coverage [--root <path>] [--repo-map <path>] [--repo-standards <path>] [--run-id <id>] [file ...]
npx @kontourai/veritas readiness --check coverage --working-tree
npx @kontourai/veritas readiness --check coverage --format feedback --working-tree
npx @kontourai/veritas readiness --check coverage --format json --working-tree
```

Important behaviors:

- default output is a short human-readable readiness coverage summary
- `--format json` returns the current readiness-coverage and inventory fields
- `--format feedback` reuses the same lint-style summary as `report --format feedback`
- the command uses the same Repo Map, Repo Standards, and source-scope flags as `report`
- malformed declared inventory manifests fail with the manifest path and item id

### `readiness` orchestration

Runs evidence checks first, then creates a report, then creates a standards-feedback draft, and optionally finishes the feedback record if the missing judgment fields are supplied.

```bash
npx @kontourai/veritas readiness [--root <path>] [--repo-map <path>] [--repo-standards <path>] [--authority-settings <path>]
  [--format feedback|json]
  [--evidence-check-command <cmd>] [--skip-evidence-check]
  [--working-tree | --changed-from <ref> --changed-to <ref>]
  [--run-id <id>]
  [--reviewer-confidence <scale-entry|unknown>]
  [--time-to-green-minutes <number>]
  [--exception-count <number>]
  [--false-positive-rule <rule-id>]
  [--missed-issue <text>]
  [--note <text>]
  [--accepted-without-major-rewrite <true|false>]
  [--required-followup <true|false>]
  [--force]
```

If `accepted_without_major_rewrite`, `required_followup`, and `time_to_green_minutes` are not all present, the command stops after report plus draft. Feedback mode prints the report path, standards-feedback draft path, and run id in the footer. JSON mode returns the orchestration object with the suggested feedback-record command.

Evidence Check commands are executed as tokenized argv, not through an implicit shell. Keep each command to one executable plus arguments, or move compound shell logic into a real script.

External tool evidenceChecks follow the same rule. For tools such as Fallow, put shell-sensitive behavior like `2>/dev/null || true` inside a script, have that script write a JSON artifact under `.veritas/`, and point the check's `externalTool.artifactPath` at that file. Advisory external tool findings appear as warnings in feedback; blocking external tool findings fail the run.

Exit codes:

- `0`: no blocking failures
- `1`: evidenceCheck or blocking policy failure
- `2`: config/runtime error

### `standards feedback draft`

Builds a repo-local draft artifact from a repo-local evidence artifact.

```bash
npx @kontourai/veritas feedback draft --evidence <path> [--authority-settings <path>] [--output <path>] [--force]
  [--reviewer-confidence <scale-entry|unknown>]
  [--time-to-green-minutes <number>]
  [--exception-count <number>]
  [--false-positive-rule <rule-id>]
  [--missed-issue <text>]
  [--note <text>]
```

### `feedback observe`

Builds a standards-feedback draft from a Codex or Claude Code session log. With `--tool none`, it uses filesystem artifacts instead of a session log.

```bash
npx @kontourai/veritas feedback observe [--session-log <path>] [--tool auto|codex|claude-code|none] [--evidence <path>] [--output <path>] [--rewrite-threshold <ratio>] [--verbose]
```

When a heuristic cannot compute a value, the draft stores a reason object such as `{ "value": null, "reason": "no_passing_run_observed" }` instead of a bare null. The command validates the draft shape before writing unless `VERITAS_SKIP_STANDARDS_FEEDBACK_VALIDATION=1` is set.

Filesystem fallback fields include `source: "filesystem-inferred"` so session-log-derived and artifact-derived values stay distinguishable.

Guardrail:

- evidence input must be under `.veritas/evidence/`
- the generated draft now includes a derived `governance` object that records whether the evidence touched the Protected Standards and whether protected-standards review is required

### `standards feedback record`

Completes a standards-feedback record from either evidence directly or a previously created draft.

```bash
npx @kontourai/veritas feedback record --evidence <path> [--authority-settings <path>] [--output <path>] [--force]
  --accepted-without-major-rewrite <true|false>
  --required-followup <true|false>
  --reviewer-confidence <scale-entry|unknown>
  --time-to-green-minutes <number>
  --exception-count <number>

npx @kontourai/veritas feedback record --draft <path> [--authority-settings <path>] [--output <path>] [--force]
  --accepted-without-major-rewrite <true|false>
  --required-followup <true|false>
  --reviewer-confidence <scale-entry|unknown>
  --time-to-green-minutes <number>
  --exception-count <number>
```

Guardrails:

- evidence input must stay under `.veritas/evidence/`
- draft input must stay under `.veritas/standards-feedback-drafts/`
- a draft must be completed with the same standards settings that created it
- the completed record keeps the same derived `governance` object so governance-touching feedback can be measured later
- existing output is not overwritten without `--force`

### `feedback marker`

Scores a deterministic marker-surfacing benchmark by comparing one `without Veritas` session log to one `with Veritas` session log against the same benchmark scenario.

```bash
npx @kontourai/veritas feedback marker \
  --scenario examples/benchmarks/migration/scenario.json \
  --without-veritas-session-log examples/benchmarks/migration/without-veritas.json \
  --with-veritas-session-log examples/benchmarks/migration/with-veritas.json
```

Important behaviors:

- the command is read-only and prints JSON to stdout
- the scenario defines the required marker phrases and the scoring window
- session logs must declare the matching `benchmark_id` plus the expected `without-veritas` or `with-veritas` condition id
- session logs must include a trigger tag, and may include a response-window tag when the tagged assistant turn is the response that must carry the marker
- this command scores one benchmark pair; repeat it across multiple runs when you want `pass^k`-style evidence, or use `marker-suite` for the aggregated `pass_pow_k` metric

### `feedback marker-suite`

Scores a suite of marker benchmarks and reports aggregate reliability metrics across multiple scenario groups and trials.

```bash
npx @kontourai/veritas feedback marker-suite \
  --suite examples/benchmarks/suites/context-surfacing-suite.json
```

Important behaviors:

- the suite artifact references scenario files plus one or more trial session log pairs per benchmark
- each `benchmark_id` and `trial_id` in the suite must be unique
- aggregate metrics include per-trial rates and grouped reliability summaries
- `improvement_rate` counts trials where Veritas improves outcome quality or delivers the same correct outcome faster
- `pass_at_1` is computed from the first listed trial in each benchmark group
- `pass_at_k` means a benchmark has at least one passing `with Veritas` trial across its recorded trials
- `pass_pow_k` is the suite report name for `pass^k`: every recorded `with Veritas` trial in a benchmark group passes
- the command validates every referenced scenario and session log before producing a suite summary

### `standards feedback summary`

Reads `.veritas/standards-feedback/history.jsonl` and prints recent local outcome metrics.

```bash
npx @kontourai/veritas feedback summary [--root <path>]
```

The summary includes acceptance count, required rewrites, average time to green, average exceptions, confidence distribution, and the most flagged false-positive rule.

### `feedback recommend`

Reads `.veritas/standards-feedback/history.jsonl` and writes non-blocking recommendation artifacts under `.veritas/recommendations/`.

```bash
npx @kontourai/veritas feedback recommend [--root <path>] [--force] [--dry-run]
```

The generator looks for frequently excepted failures, warning requirements that did not cause follow-up, inactive requirements, and paths that repeatedly matched no work area.

### `recommendation`

Review recommendation artifacts.

```bash
npx @kontourai/veritas recommendation list [--root <path>] [--status proposed|accepted|rejected|all]
npx @kontourai/veritas recommendation show <id> [--root <path>]
npx @kontourai/veritas recommendation decide <id> --accept|--reject --actor <id> [--approval-ref <ref>] [--message <text>] [--root <path>]
```

`veritas attest recommendation <id> --accept|--reject --actor <id>` is the authority-loop alias. Accepting a recommendation applies the recorded standards diff and creates a recommendation-acceptance attestation, so accepted recommendations also require `--approval-ref`. Rejecting records the decision without changing standards files.

### `print`

Print-only helpers return suggested content without changing the repo.

```bash
npx @kontourai/veritas print package-scripts [--root <path>] [--evidence-check <cmd>]
npx @kontourai/veritas print ci-snippet [--root <path>] [--evidence-check <cmd>]
npx @kontourai/veritas print git-hook [--root <path>] [--hook post-commit|pre-push]
npx @kontourai/veritas print runtime-hook [--root <path>]
npx @kontourai/veritas print stop-hook [--root <path>] [--tool generic|claude-code|cursor]
npx @kontourai/veritas print governance-block
npx @kontourai/veritas print codex-hook [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
npx @kontourai/veritas print claude-code-pre-tool-use-hook [--root <path>]
```

Printed helper surfaces:

- suggested `package.json` scripts
- a CI snippet
- a tracked git hook body
- a tracked runtime hook body
- a generic stop-hook body and thin tool-specific wrapper configs
- the canonical Veritas governance block
- a tracked Codex hooks config plus optional target inspection status
- a Claude Code PreToolUse hook that injects `veritas explain` context before file edits

### `setup`

Installs or repairs first-class repo setup.

```bash
npx @kontourai/veritas setup repo-hooks [--root <path>] [--force]
```

`setup repo-hooks` installs or repairs:

- `.githooks/post-commit`
- `.githooks/pre-push`
- executable bits for both hook files
- repo-local `core.hooksPath=.githooks`

This is the recommended command for local Git hook repair. Developers do not need to run raw `git config` commands. By default, setup is idempotent for Veritas-generated hook bodies and refuses to overwrite custom hook files; pass `--force` to replace existing hook files with the generated Veritas versions.

### `apply`

Write the suggested assets into the repo.

```bash
npx @kontourai/veritas apply package-scripts [--root <path>] [--evidence-check <cmd>] [--force]
npx @kontourai/veritas apply ci-snippet [--root <path>] [--output <path>] [--evidence-check <cmd>] [--force]
npx @kontourai/veritas apply git-hook [--root <path>] [--hook post-commit|pre-push] [--output <path>] [--configure-git] [--force]
npx @kontourai/veritas apply runtime-hook [--root <path>] [--output <path>] [--force]
npx @kontourai/veritas apply stop-hook [--root <path>] [--tool generic|claude-code|cursor] [--output <path>] [--force]
npx @kontourai/veritas apply governance-blocks [--root <path>] [--force]
npx @kontourai/veritas apply codex-hook [--root <path>] [--output <path>] [--target-hooks-file <path> | --codex-home <path>] [--force]
npx @kontourai/veritas apply claude-code-pre-tool-use-hook [--root <path>] [--output <path>] [--force]
```

Write restrictions are intentional:

- CI snippets must stay under `.veritas/snippets/`
- runtime hooks must stay under `.veritas/hooks/`
- stop hooks must stay under `.veritas/hooks/`
- Codex hook artifacts must stay under `.veritas/runtime/`
- standards feedback artifacts must stay under `.veritas/standards-feedback/`
- git hooks must stay under `.githooks/`

`apply git-hook` remains available for lower-level scripting, custom output-path control inside `.githooks/`, and installing one hook at a time. For normal repository setup or repair, prefer `setup repo-hooks`.

### `runtime status`

Inspects the installed state of tracked runtime integrations.

```bash
npx @kontourai/veritas integrations codex status [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
```

It reports:

- whether `.githooks/post-commit` exists and is executable
- whether `.githooks/pre-push` exists and is executable
- whether `core.hooksPath` points at `.githooks`
- whether `.veritas/hooks/agent-runtime.sh` exists and is executable
- whether `.veritas/runtime/codex-hooks.json` exists
- whether the target Codex hooks file already contains the Veritas command
- the next repair or install commands to run

Git hook setup or repair suggestions point to:

```bash
npx @kontourai/veritas setup repo-hooks
```

## Generated Hook Behavior

`print git-hook` and `apply git-hook` produce a `post-commit` hook that:

- skips itself when `VERITAS_HOOK_SKIP=1`
- compares `HEAD~1..HEAD` on normal commits
- uses the empty tree for the first commit
- calls `veritas readiness`

They can also produce a `pre-push` hook that:

- skips itself when `VERITAS_HOOK_SKIP=1`
- calls `npm run --if-present prepush`
- relies on the repo's push-safe `prepush` script instead of the full test suite

`print runtime-hook` and `apply runtime-hook` produce a shell wrapper that:

- skips itself when `VERITAS_HOOK_SKIP=1`
- defaults to `veritas readiness --format json --working-tree`
- forwards any explicit arguments through to `veritas readiness --format json`

`print stop-hook` and `apply stop-hook` produce `.veritas/hooks/stop.sh`, which:

- skips itself when `VERITAS_HOOK_SKIP=1`
- runs `veritas readiness --format feedback --working-tree`
- prints failures back to the agent
- exits `0` so the AI session can continue and repair the findings

`print codex-hook` and `apply codex-hook` produce a tracked Codex config that installs the runtime hook as a `Stop` hook.

## Environment Variables

- `VERITAS_HOOK_SKIP=1`: skips generated git/runtime hook execution

Do not set either skip variable in CI if the CI lane is meant to enforce evidenceCheck execution.

## Output Shape

The exact JSON varies by command, but the operator-facing contract is stable:

- print/apply commands return machine-readable status objects
- report returns `artifactPath`, `markdownSummary`, and the full evidence record including `policy_results`
- standards-feedback draft returns `artifactPath`, `suggestedRecordCommand`, `markdownSummary`, and the full draft record
- standards-feedback record returns `artifactPath`, `historyPath`, `markdownSummary`, and the full feedback record
- standards-feedback summary returns a plain-text local history summary
- marker scoring returns a benchmark comparison object with per-condition timing, false-positive, and pass results
- marker suite scoring returns a suite report with per-benchmark rollups and aggregate reliability metrics
- veritas readiness defaults to feedback text; `--format json` returns orchestration status plus the artifact paths it created

For the artifact fields themselves, see [Artifacts and Schemas](artifacts-and-schemas.md).
