# Concepts

Veritas is bespoke lint for AI agents. A normal linter tells a developer, "this line violates the repo's rules." Veritas tells an agent, "this change violated the repo's rules, and here is what to fix before you finish."

The framework has three concepts: rules, feedback, and improvement.

## Rules

Rules are repo-local. They live in `.veritas/` and describe what your repository considers mandatory.

The adapter at `.veritas/repo.adapter.json` maps the repo into surfaces: product code, shared contracts, tests, docs, workflows, and governance files. It also declares activation targets such as `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or `.github/copilot-instructions.md` so every AI tool sees the same Veritas governance block.

The policy pack at `.veritas/policy-packs/default.policy-pack.json` defines the lint rules. The first supported rule families are:

- `artifacts`: required files must exist.
- `governance-block`: AI instruction files must contain the canonical Veritas governance block.
- `if-changed` plus `then-require`: if one path appears in the diff, a companion path must also appear.

Example:

```json
{
  "id": "api-changes-require-test-changes",
  "classification": "promotable-policy",
  "stage": "block",
  "message": "If src/api/ changed, tests/api/ must also appear in the diff.",
  "match": {
    "if-changed": "src/api/",
    "then-require": "tests/api/"
  }
}
```

This is what makes Veritas different from a static checklist. The rule is about behavior in the actual change, not just whether a file exists somewhere in the repo.

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

Evidence records capture what changed, which repo surfaces were touched, which proof commands applied, and which rules passed or failed. Eval records capture how the run turned out: accepted or rewritten, time to green, overrides, false positives, missed issues, and reviewer confidence.

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
