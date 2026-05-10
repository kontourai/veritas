# Implementation Backlog

This backlog turns the current roadmap and integration plans into executable work. It intentionally excludes the legacy Surface Veritas adapter restoration: Veritas now emits `surface.input` directly, and Surface should not keep a Veritas-specific adapter unless a real external consumer needs it.

## Now

### Landing path cleanup

- Trim the README so the first path is install, init, budget, and shadow-run.
- Explain Veritas in three jobs: enforce repo boundaries, deliver just-in-time context, and help agents self-correct before review.
- Cross-link Surface early: every Veritas evidence artifact projects a portable `surface.input`, but Veritas can be used alone.

### Deep integration documentation

- Keep Codex as the only worked deep-capture example.
- Mark Claude Code and Cursor as supported through governance blocks, PreToolUse/Stop hooks, and explicit `shadow run`; transcript capture is not implemented yet.

### Runtime escape hatches

- Document `VERITAS_SKIP_SURFACE_VALIDATION` and `VERITAS_SKIP_EVAL_VALIDATION`.
- Emit a warning whenever either escape hatch is used.

## Next

### Starter policy packs

- Add starter packs for `nextjs-typescript`, `python-fastapi`, and `monorepo-pnpm`.
- Add `veritas init --pack <name>` so new repos can start from a recognizable stack instead of translating this repo's policy pack.
- Add a worked Next.js walkthrough using real command output.

### Eval quality

- Harden Codex eval observation so uncomputed fields include reason codes instead of bare `null`.
- Validate generated eval drafts against `schemas/veritas-eval-draft.schema.json`.
- Add `.veritas/runs/history.jsonl` so pure CI fail-to-pass sequences can still produce `time_to_green_minutes`.

### Proof module maintainability

- Split `src/proof/index.mjs` into focused family and external-tool modules while preserving behavior.

## Later

### Cross-layer Surface rules

- Implement `surface-fixture-required` and `surface-projection-required` after Surface's candidate, assumption, comparison, and review-signal primitives are stable enough for real fixtures.

### Adapter packs and pilots

- Start adapter packs inside `adapters/`, then promote to packages once the shape is proven.
- Use Taxes as the MCP monorepo pilot and Campfit as the Next.js + Prisma confirmation pass.

### Longitudinal evidence

- Keep local run history first.
- Add a hosted or configurable external eval sink only after the local JSON/JSONL contracts are stable.
