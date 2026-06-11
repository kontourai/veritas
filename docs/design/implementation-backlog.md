# Implementation Backlog

This backlog turns the current roadmap and integration plans into executable work. It excludes restoring a Veritas-specific Surface integration: Veritas now emits `trust.bundle` directly, and Surface should not import Veritas readiness runtime code unless a real external product needs it.

## Now

### Landing path cleanup (done)

- ~~Trim the README so the first path is install, init, readiness coverage, and generated evidence.~~ Shipped: the README quickstart leads with install → init → readiness inside a git repository.
- Explain Veritas in three jobs: enforce repo boundaries, deliver just-in-time context, and help agents self-correct before review.
- ~~Cross-link Surface early~~ Shipped: the README's "Where Veritas fits" table and Surface footnote link the family.

### Deep integration documentation

- Keep Codex as the only worked deep-capture example.
- Mark Claude Code as supported through governance blocks, PreToolUse/Stop hooks, explicit `veritas readiness`, and agent session log observation.
- Mark Cursor as supported through generic stop-hook wiring and explicit `veritas readiness`; agent session log observation is pending until Cursor exposes a durable session log shape Veritas can read.

### Runtime escape hatches

- Document `VERITAS_SKIP_SURFACE_VALIDATION` and `VERITAS_SKIP_STANDARDS_FEEDBACK_VALIDATION`.
- Emit a warning whenever either escape hatch is used.

## Next

### Repo Standards templates

- Add starter templates for `nextjs-typescript`, `python-fastapi`, and `monorepo-pnpm`.
- Rename `veritas init --template <name>` to template-oriented language so new repos can start from a recognizable stack.
- Add a worked Next.js walkthrough using real command output.

### Standards feedback quality

- Harden Codex standards feedback observation so uncomputed fields include reason codes instead of bare `null`.
- Validate generated standards-feedback drafts against `schemas/veritas-standards-feedback-draft.schema.json`.
- Add `.veritas/runs/history.jsonl` so pure CI fail-to-pass sequences can still produce `time_to_green_minutes`.

### Evidence Check module maintainability

- Split `src/evidence/index.mjs` into focused inventory and external-tool modules while preserving behavior.

## Later

### Cross-layer Surface rules

- Implement `surface-fixture-required` and `surface-projection-required` after Surface's candidate, assumption, comparison, and review-signal primitives are stable enough for real fixtures.

### Repo Map templates and pilots

- Start Repo Map templates inside `repo-maps/`, then promote to packages once the shape is proven.
- Use one monorepo pilot and one Next.js + Prisma confirmation pass from outside the Veritas repo.

### Longitudinal evidence

- Keep local run history first.
- Add a hosted or configurable external standards-feedback sink only after the local JSON/JSONL contracts are stable.
