# Concepts

Veritas is bespoke lint for AI agents, built on the Kontour Surface trust substrate. A normal linter tells a developer, "this line violates the repo's rules." Veritas tells an agent, "this change violated the repo's rules, and here is what to fix before you finish."

Veritas has three jobs:

1. **Enforce boundaries** so parallel workstreams don't collide or duplicate (strict surface ownership, cross-surface-write rules).
2. **Deliver just-in-time context** to fight agent focus drift in long sessions (the `explain` command and Claude Code PreToolUse hooks).
3. **Enforce standards via self-correction** — lint-style feedback agents act on immediately, not at code review time.

The framework has four core concepts: Surface foundation, rules, feedback, and improvement.

## Surface Foundation

Surface owns portable trust primitives: claims, evidence, verification policies, verification events, freshness/status, fault lines, proof requirements, and generated trust reports.

Veritas owns repo and AI-agent workflow mechanics: adapters, policy packs, proof lanes, proof families, verification budgets, shadow runs, and lint-style feedback. These are useful to coding agents, but they are not a second trust model.

Every Veritas evidence artifact includes `surface.input`, a Surface `TrustInput` projection of the run. That block contains claims, evidence, policies, and events. It must not contain Surface report-only fields such as `id`, `generatedAt`, `summary`, `faultLines`, or `proofRequirementsByClaimId`; Surface generates those when it builds a report.

For the full boundary rule, see [Surface-Veritas Boundary](architecture/surface-veritas-boundary.md).

## Rules

Rules are repo-local. They live in `.veritas/` and describe what your repository considers mandatory.

The adapter at `.veritas/repo.adapter.json` maps the repo into surfaces: product code, shared contracts, tests, docs, workflows, and governance files. It also declares activation targets such as `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or `.github/copilot-instructions.md` so every AI tool sees the same Veritas governance block.

The policy pack at `.veritas/policy-packs/default.policy-pack.json` defines the lint rules. Rules are classified by type via a required `kind` field. Supported rule kinds are:

- `required-artifacts`: required files must exist.
- `governance-block`: AI instruction files must contain the canonical Veritas governance block.
- `diff-required`: if one path appears in the diff (`if-changed`), a companion path must also appear (`then-require`).
- `forbidden-pattern`: specific patterns or strings are not allowed in matched files.
- `required-pattern`: specific patterns or strings are required to exist in matched files.
- `header-required`: specific headers or comments are required at the start of matched files.
- `cross-surface-write`: strict surface ownership rules; changes must be approved by surface owners or allowlisted.

Every rule includes an `explain` block with `summary`, `mustDo`, `mustNotDo`, `exampleGood`, `exampleBad`, and `contextLinks` to help agents understand the rule.

Example:

```json
{
  "id": "api-changes-require-test-changes",
  "kind": "diff-required",
  "classification": "promotable-policy",
  "stage": "block",
  "message": "If src/api/ changed, tests/api/ must also appear in the diff.",
  "match": {
    "if-changed": "src/api/",
    "then-require": "tests/api/"
  },
  "explain": {
    "summary": "API changes must have accompanying test changes.",
    "mustDo": "Add or modify tests for any API changes.",
    "mustNotDo": "Change src/api/ without touching tests/api/.",
    "exampleGood": "PR adds src/api/routes.ts and tests/api/routes.test.ts",
    "exampleBad": "PR adds src/api/routes.ts but no test changes",
    "contextLinks": ["docs/testing.md"]
  }
}
```

This is what makes Veritas different from a static checklist. The rule is about behavior in the actual change, not just whether a file exists somewhere in the repo.

### Content Rules

Content rules have two match layers:

- `match.files` is a file glob list. It uses Veritas path matching, including `**` globs and ordered `!` negation.
- `match.pattern` is a JavaScript `RegExp` string that runs against matched file contents.

For example, this blocks imports from a package root while allowing legitimate subpath imports:

```json
{
  "id": "forbid-shared-root-imports",
  "kind": "forbidden-pattern",
  "classification": "promotable-policy",
  "stage": "block",
  "message": "New code should not import from the @stallion-ai/shared root; use contracts or explicit helper subpaths.",
  "match": {
    "files": ["packages/**/*.ts", "packages/**/*.tsx", "packages/**/*.mjs", "packages/**/*.js"],
    "pattern": "@stallion-ai/shared(?!/)"
  }
}
```

The `(?!/)` part is regex, not glob syntax. It means `@stallion-ai/shared/contracts` is allowed, but `@stallion-ai/shared` is not.

Use `required-pattern` for required content and `header-required` when the pattern must appear at the start of a file, such as a license or governance header.

## Boundaries

The adapter's graph defines repo surfaces with owners and boundary types. A surface can be `strict` (changes require owner approval) or `advisory` (visible but not enforced). The `cross-surface-write` rule checks whether an actor (an agent, developer, or team) has permission to touch a strict surface.

Graph nodes declare:

- `owners`: array of owner ids for the surface
- `boundary`: `strict` or `advisory`
- `crossSurfaceAllow`: optional allowlist of actor ids or patterns allowed to write to strict surfaces

The `cross-surface-write` rule fails when:

- No actor was supplied. Pass `--actor <id>` or set `VERITAS_ACTOR`.
- A diff touches a `strict` boundary surface
- The actor is not an owner of that surface
- The actor is not in `crossSurfaceAllow`

There is intentionally no fallback to the operating-system username. CI users and local shell users are not governance actors. Missing actor identity is a configuration error, and Veritas reports it as a failure instead of silently passing.

This is how Veritas prevents parallel workstreams from accidentally colliding: surface ownership is explicit, actor identity is explicit, and the check fails closed before changes land.

## Just-In-Time Context

Long AI agent sessions drift toward high-level goals and lose sight of repo-specific constraints. Veritas delivers context just before an agent edits:

- `veritas explain --file <path>` — prints the rules and governance for a specific file
- `veritas explain --surface-node <node-id>` — prints rules for a surface
- `veritas explain <rule-id>` — prints full context for a rule

The `veritas hooks claude-code print|apply` command generates a Claude Code PreToolUse hook that calls `veritas explain --file <path>` before each edit. This keeps repo rules visible in the agent's context without clogging the main prompt.

## Feedback

`veritas shadow run` is the agent-facing path. It runs the configured proof lane, evaluates rules against the changed files, writes evidence, and prints lint-style feedback by default:

```text
veritas: 3 files changed -> governance.guidance, tooling.scripts
PASS  required-veritas-operational-artifacts: All required repository artifacts are present.
FAIL  api-changes-require-test-changes: Changed files matched src/api/ but no companion changes matched tests/api/.
      -> src/api/routes.ts

1 failure · 0 warnings · run `veritas report` for full evidence
report: .veritas/evidence/veritas-123.json · eval draft: .veritas/eval-drafts/veritas-123.json · run: veritas-123
```

The output is meant to be read by an agent during a session, the same way it reads a failing test or compiler error.

Exit codes are hook-friendly:

- `0`: no failures
- `1`: proof or blocking policy failure
- `2`: config or runtime error

`veritas report` remains the structured evidence path and keeps JSON as its default output. Use `--format feedback` when you want the same lint-style message in a PR comment or review surface.

## Improvement

Evidence records capture what changed, which repo surfaces were touched, which proof commands applied, which rules passed or failed, and the embedded `surface.input` that lets Surface produce the portable trust report. Eval records capture how the run turned out: accepted or rewritten, time to green, overrides, false positives, missed issues, and reviewer confidence.

Veritas also writes `.veritas/claims/*.input.json` when a report includes Surface input. Those files are per-claim slices of `surface.input`, not Surface `TrustReport` files. They exist so local tooling can inspect one claim and its matching evidence/events without copying the full evidence artifact.

For local use, `veritas eval record` appends compact JSONL entries to `.veritas/evals/history.jsonl`, and `veritas eval summary` reports the recent trend:

```text
Last 10 evals: 8 accepted, 2 required rewrite
Avg time to green: 14 min | Avg overrides: 0.3 | Confidence: high (7), medium (3)
Most flagged rule: api-changes-require-test-changes (3)
```

That closes the loop without external infrastructure. Start in shadow mode, look at the local trend, then promote rules only when the data says they are useful.

## How It Activates

Veritas does not own your AI instruction files. It injects a small marker-bounded block:

```html
<!-- veritas:governance-block:start -->
This repo uses Veritas for AI governance. Read `.veritas/GOVERNANCE.md` before making changes.
After changes, run `veritas shadow run` and address any FAIL lines before finishing.
<!-- veritas:governance-block:end -->
```

Use:

```bash
npx @kontourai/veritas apply governance-blocks
npx @kontourai/veritas apply stop-hook --tool generic
```

Tool-specific integrations are thin wrappers around the same generic contract. Claude Code, Cursor, Codex, Copilot, and any other tool can read the same repo-local rules and run the same shell command.

For hands-on setup, start with the [Getting Started guide](guides/getting-started.md). For CLI details, see the [CLI Reference](reference/cli.md).
