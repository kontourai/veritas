# CLI Reference

This page documents the CLI surface that currently ships in this repo.

The primary CLI surface is seven verbs: `init`, `run`, `explain`, `attest`, `proposal`, `eval`, and `integrations`. Most commands print JSON to stdout. The agent-facing `run` feedback path prints lint-style text by default; use `--format json` when you need machine-readable orchestration output.

## Entry Points

- `npx @kontourai/veritas ...`
- `npx @kontourai/veritas --help`
- `npx @kontourai/veritas run --help`
- `npx @kontourai/veritas run --check shadow --help`
- `npx @kontourai/veritas <subcommand> --help`
- `node bin/veritas-report.mjs ...`

The convenience `veritas-report` binary defaults to repo-local starter paths:

- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`

## Core Workflow

The shortest end-user path is:

```bash
npm install -D @kontourai/veritas
npx @kontourai/veritas init
npx @kontourai/veritas attest bootstrap --actor <human-id> --non-interactive
npx @kontourai/veritas run --check budget --working-tree
npx @kontourai/veritas run --working-tree
```

Use `run --check budget` when you want the concise "what are we checking and what should be reviewed?" view. Use `run` when you want proof, evidence, eval-draft orchestration, and agent-readable feedback in one command.

Breaking proof-command migration notes live in [../MIGRATING.md](../MIGRATING.md).

## Commands

### `run`

Runs the requested check. Without `--check`, this is the agent-facing feedback path.

```bash
npx @kontourai/veritas run [--check shadow|boundaries|budget] [--root <path>] [--working-tree]
npx @kontourai/veritas run --check boundaries --actor cli-team [--diff main]
```

`run` is the recommended front door for proof execution, evidence capture, eval drafting, and feedback. `run --check boundaries` replaces `boundaries check`. `run --check budget` replaces the top-level `budget` command. `run --check shadow` remains as a compatibility alias for the same report path.

### `init`

Bootstraps the starter kit for a target repo.

```bash
npx @kontourai/veritas init [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--pack <name>] [--force] [--non-interactive]
npx @kontourai/veritas init --explore [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--output .veritas/init-plans/<name>.json]
npx @kontourai/veritas init --guided --answers <answers.json> [--root <path>] [--project-name <name>] [--output .veritas/init-plans/<name>.json]
npx @kontourai/veritas init --apply --plan <path> [--root <path>] [--force]
```

Writes:

- `.veritas/GOVERNANCE.md`
- `.veritas/README.md`
- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`
- `.veritas/team/default.team-profile.json`
- `.veritas/evidence/`
- `AGENTS.md` and `CLAUDE.md` governance blocks

`--pack` replaces the generated starter policy pack with a named example pack. Shipped packs are `nextjs-typescript`, `python-fastapi`, and `monorepo-pnpm`.

`init` keeps stdout machine-readable JSON and prints the suggested CODEOWNERS block to stderr as informational text.

In `--non-interactive` mode, `init` writes `.veritas/attestations/PENDING` instead of recording a human attestation. Run `attest bootstrap` after a human reviews the generated Zone 1 files.

The bootstrap logic infers:

- repo kind: `application`, `workspace`, or `docs`
- likely source roots
- likely test roots
- whether workflows exist
- an initial proof lane from common npm scripts

Guided initialization splits setup into a reviewed artifact flow:

- `--explore` inspects the repo and emits a recommendation JSON without writing starter files.
- `--guided --answers <answers.json>` folds owner-provided boundaries, style, proof-lane, and instruction-target choices into the recommendation.
- `--output` is intentionally constrained to `.veritas/init-plans/` so reviewed setup plans stay repo-local and obvious.
- `--apply --plan <path>` is the only guided write path. It validates the plan schema, target root, payload hashes, and overwrite rules before writing.
- Brownfield repos with existing guidance or convergence scripts also receive an `existing_verification` inventory and `recommended_proof_family_inventory`. Unknown catch evidence stays candidate/advisory until a maintainer supplies owner and review evidence.
- Unknown init flags fail before any files are written.

### `attest`

Records or inspects human attestations for Zone 1 governance files.

```bash
npx @kontourai/veritas attest bootstrap --actor <id> [--root <path>] [--non-interactive] [--valid-until-days <days>]
npx @kontourai/veritas attest policy-change --actor <id> --message <text> [--root <path>] [--valid-until-days <days>]
npx @kontourai/veritas attest status [--root <path>]
```

`bootstrap` records the first reviewed hashes for `.veritas/repo.adapter.json`, `.veritas/policy-packs/default.policy-pack.json`, and `.veritas/team/default.team-profile.json`. `policy-change` records a reviewed successor and requires an explanation in `--message`. `status` reports the current attestation, age, expiry, and hash drift.

The built-in rule `policy-changes-require-attestation` fails when the active attestation no longer matches those Zone 1 files.

### `hooks claude-code`

Prints, installs, or runs the Claude Code PreToolUse hook.

```bash
npx @kontourai/veritas hooks claude-code print [--root <path>]
npx @kontourai/veritas hooks claude-code apply [--root <path>] [--force]
npx @kontourai/veritas hooks claude-code pre-tool-use [--root <path>] [--file <path>] [--actor <id>]
```

`pre-tool-use` reads the Claude hook JSON payload from stdin, extracts `tool_input.file_path` or `tool_input.path`, resolves the actor from `--actor`, `VERITAS_ACTOR`, or the current attestation, and returns hook protocol JSON. Deny-enforced failures return `decision: "block"` and exit non-zero. Set `VERITAS_OVERRIDE_RULE` and `VERITAS_OVERRIDE_REASON` to allow a specific denied rule and append an override record.

### `integrations`

Installs or inspects runtime adapters through the tool-agnostic integration namespace.

```bash
npx @kontourai/veritas integrations codex status
npx @kontourai/veritas integrations claude-code install [--root <path>] [--force]
npx @kontourai/veritas integrations cursor install [--root <path>] [--force]
npx @kontourai/veritas integrations copilot status [--root <path>]
```

Codex and Claude Code have transcript readers. Claude Code install wires PreToolUse, Stop, and PostSession hooks. Cursor and Copilot currently install generic stop-hook wiring and report `transcriptReader: null`.

Answers are JSON and may include:

```json
{
  "proofLane": "npm run verify",
  "selectedInstructionTargets": ["AGENTS.md", "CLAUDE.md"],
  "boundaries": ["Do not edit generated snapshots without approval."],
  "codingStyle": "Prefer small ESM modules.",
  "releaseExpectations": "Run npm test and npm run verify before merge."
}
```

`selectedInstructionTargets` controls the AI instruction files that `--apply` mutates and the governance-block rule that the starter policy pack enforces.

### `report`

Generates an evidence artifact for a set of files or a repo state slice.

```bash
npx @kontourai/veritas run --check shadow [--root <path>] [--adapter <path>] [--policy-pack <path>] [--run-id <id>] [file ...]
npx @kontourai/veritas run --check shadow --format feedback --working-tree
npx @kontourai/veritas run --check shadow --working-tree
npx @kontourai/veritas run --check shadow --staged
npx @kontourai/veritas run --check shadow --unstaged --untracked
npx @kontourai/veritas run --check shadow --changed-from <ref> --changed-to <ref>
npx @kontourai/veritas run --check shadow --trend
```

Important behaviors:

- explicit files produce `source_kind: "explicit-files"`
- branch comparisons produce `source_kind: "branch-diff"`
- working-tree modes produce `source_kind: "working-tree"`

Every report also includes an `integrity` block. `integrity.sourceRef` mirrors the source anchor used for staleness decisions, `integrity.fileRefs` records readable changed-file fingerprints, and `integrity.configRefs` records hashes for the adapter, policy pack, and team profile when those paths are available. Surface dashboards use this to explain what a verified claim was actually verified against.
- the adapter selects proof commands through explicit `proofs`, `requiredProofIds`, `defaultProofIds`, and optional `proofRoutes`
- the artifact is written to the adapter-defined `artifactDir`
- every artifact includes `surface.input`, a Surface `TrustInput` projection with claims, evidence, policies, and events
- Veritas owns repo-native collection and Surface owns generic validation and report generation
- JSON is the default output; `--format feedback` prints the same lint-style findings used by hooks
- `--trend` prints the eval-history rule trend with sparklines and MTTR instead of generating a new report

### `explain`

Prints only the policy explanation relevant to a rule, surface node, or file.

```bash
npx @kontourai/veritas explain required-veritas-schema-artifacts
npx @kontourai/veritas explain --file src/index.mjs
npx @kontourai/veritas explain --surface-node app.src
```

Output is capped to fit an agent context window and includes the local governance excerpt plus matching rule `explain` blocks.

### `boundaries check`

Checks strict surface ownership for a working tree or diff.

```bash
npx @kontourai/veritas boundaries check --actor cli-team --diff main
npx @kontourai/veritas boundaries check --actor framework-team
```

`--actor` is required unless `VERITAS_ACTOR` is set. Veritas intentionally does not fall back to the operating-system user, because CI runner names and shell usernames are not governance actors. If no actor is supplied, the command exits non-zero with a missing-actor failure.

Strict nodes fail when the actor is neither an owner nor listed in `crossSurfaceAllow`. This means a working tree that spans several strict surfaces may legitimately fail for one actor while passing for another owner or allowlisted actor.

To turn a Veritas artifact into a Surface trust report:

```bash
artifact_path="$(npx @kontourai/veritas run --check shadow --working-tree --format json | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const parsed = JSON.parse(data); if (!parsed.artifactPath) throw new Error("missing artifactPath"); console.log(parsed.artifactPath); });')"
node -e 'const fs = require("node:fs"); const artifact = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(JSON.stringify(artifact.surface.input, null, 2));' "$artifact_path" > .veritas/external/surface-input.json
surface report --adapter surface --input .veritas/external/surface-input.json --format summary
```

Surface generates report-only fields such as `id`, `generatedAt`, `summary`, `faultLines`, and `proofRequirementsByClaimId`. Veritas owns repo-native collection and projection; Surface owns generic validation and report generation.

Current evidence artifacts also include `surface.report`, a compact summary generated by Surface's `buildTrustReport`. `veritas run` emits WARN lines for Surface-derived stale or disputed claims, and `veritas explain <rule-id>` includes the latest Surface claim status and fault lines for the matching policy claim.

### `budget`

Prints the verification budget without requiring operators to read the full report artifact.

```bash
npx @kontourai/veritas run --check budget [--root <path>] [--adapter <path>] [--policy-pack <path>] [--run-id <id>] [file ...]
npx @kontourai/veritas run --check budget --working-tree
npx @kontourai/veritas run --check budget --format feedback --working-tree
npx @kontourai/veritas run --check budget --format json --working-tree
```

Important behaviors:

- default output is a short human-readable budget summary
- `--format json` returns `verification_budget` and `proof_family_results`
- `--format feedback` reuses the same lint-style summary as `report --format feedback`
- the command uses the same adapter, policy-pack, and source-scope flags as `report`
- malformed declared proof-family manifests fail with the manifest path and family id

### `run`

Runs proof first, then creates a report, then creates an eval draft, and optionally finishes the eval record if the missing judgment fields are supplied.

```bash
npx @kontourai/veritas run [--root <path>] [--adapter <path>] [--policy-pack <path>] [--team-profile <path>]
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

External tool proof lanes follow the same rule. For tools such as Fallow, put shell-sensitive behavior like `2>/dev/null || true` inside a script, have that script write a JSON artifact under `.veritas/`, and point the proof lane's `externalTool.artifactPath` at that file. Advisory external tool findings appear as warnings in feedback; blocking external tool findings fail the run.

Exit codes:

- `0`: no blocking failures
- `1`: proof or blocking policy failure
- `2`: config/runtime error

### `eval draft`

Builds a repo-local draft artifact from a repo-local evidence artifact.

```bash
npx @kontourai/veritas eval draft --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  [--reviewer-confidence <scale-entry|unknown>]
  [--time-to-green-minutes <number>]
  [--override-count <number>]
  [--false-positive-rule <rule-id>]
  [--missed-issue <text>]
  [--note <text>]
```

### `eval observe`

Builds an eval draft from a Codex or Claude Code transcript. With `--tool none`, it uses filesystem artifacts instead of a transcript.

```bash
npx @kontourai/veritas eval observe [--transcript <path>] [--tool auto|codex|claude-code|none] [--evidence <path>] [--output <path>] [--rewrite-threshold <ratio>] [--verbose]
```

When a heuristic cannot compute a value, the draft stores a reason object such as `{ "value": null, "reason": "no_passing_run_observed" }` instead of a bare null. The command validates the draft shape before writing unless `VERITAS_SKIP_EVAL_VALIDATION=1` is set.

Filesystem fallback fields include `source: "filesystem-inferred"` so transcript-derived and artifact-derived values stay distinguishable.

Guardrail:

- evidence input must be under `.veritas/evidence/`
- the generated draft now includes a derived `governance` object that records whether the evidence touched the governance surface and whether constitutional review is required

### `eval record`

Completes a live-eval record from either evidence directly or a previously created draft.

```bash
npx @kontourai/veritas eval record --evidence <path> [--team-profile <path>] [--output <path>] [--force]
  --accepted-without-major-rewrite <true|false>
  --required-followup <true|false>
  --reviewer-confidence <scale-entry|unknown>
  --time-to-green-minutes <number>
  --override-count <number>

npx @kontourai/veritas eval record --draft <path> [--team-profile <path>] [--output <path>] [--force]
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
npx @kontourai/veritas eval marker \
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
npx @kontourai/veritas eval marker-suite \
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
npx @kontourai/veritas eval summary [--root <path>]
```

The summary includes acceptance count, required rewrites, average time to green, average overrides, confidence distribution, and the most flagged false-positive rule.

### `eval propose`

Reads `.veritas/evals/history.jsonl` and writes non-blocking proposal artifacts under `.veritas/proposals/`.

```bash
npx @kontourai/veritas eval propose [--root <path>] [--force] [--dry-run]
```

The generator looks for frequently overridden failures, warning rules that did not cause follow-up, inactive rules, and paths that repeatedly matched no surface node.

### `proposal`

Review proposal artifacts.

```bash
npx @kontourai/veritas proposal list [--root <path>] [--status proposed|accepted|rejected|all]
npx @kontourai/veritas proposal show <id> [--root <path>]
npx @kontourai/veritas proposal decide <id> --accept|--reject --actor <id> [--message <text>] [--root <path>]
```

`veritas attest proposal <id> --accept|--reject --actor <id>` is the human-loop alias. Accepting a rule proposal applies the recorded policy-pack diff and creates a proposal-acceptance attestation. Rejecting records the decision without changing policy files.

### `print`

Print-only helpers return suggested content without changing the repo.

```bash
npx @kontourai/veritas print package-scripts [--root <path>] [--proof-lane <cmd>]
npx @kontourai/veritas print ci-snippet [--root <path>] [--proof-lane <cmd>]
npx @kontourai/veritas print git-hook [--root <path>] [--hook post-commit]
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

### `apply`

Write the suggested assets into the repo.

```bash
npx @kontourai/veritas apply package-scripts [--root <path>] [--proof-lane <cmd>] [--force]
npx @kontourai/veritas apply ci-snippet [--root <path>] [--output <path>] [--proof-lane <cmd>] [--force]
npx @kontourai/veritas apply git-hook [--root <path>] [--hook post-commit] [--output <path>] [--configure-git] [--force]
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
- eval artifacts must stay under `.veritas/evals/`
- git hooks must stay under `.githooks/`

### `runtime status`

Inspects the installed state of the tracked adapter surfaces.

```bash
npx @kontourai/veritas integrations codex status [--root <path>] [--target-hooks-file <path>] [--codex-home <path>]
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
- calls `veritas run`

`print runtime-hook` and `apply runtime-hook` produce a shell wrapper that:

- skips itself when `VERITAS_HOOK_SKIP=1`
- also honors legacy `AI_GUIDANCE_HOOK_SKIP=1`
- defaults to `veritas run --format json --working-tree`
- forwards any explicit arguments through to `veritas run --format json`

`print stop-hook` and `apply stop-hook` produce `.veritas/hooks/stop.sh`, which:

- skips itself when `VERITAS_HOOK_SKIP=1`
- runs `veritas run --format feedback --working-tree`
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
- veritas run defaults to feedback text; `--format json` returns orchestration status plus the artifact paths it created

For the artifact fields themselves, see [Artifacts and Schemas](artifacts-and-schemas.md).
