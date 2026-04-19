# AI Guidance Framework

## Intent

This repository owns the reusable framework for:
- graph-based codebase modeling
- task/diff resolution
- evidence collection
- policy packs
- adapter contracts

It does **not** own repo-specific product code.

Repo-specific bindings belong in adapters.

## Working Rules

- Keep the framework generic; avoid hardcoding `work-agent` assumptions into the core docs or examples.
- Prefer schema and contract clarity over premature implementation layers.
- When adding new concepts, update the design doc and the relevant schema together.
- Treat adapter examples as examples, not as the framework.
- No new dependencies unless they buy clear leverage.

## Verification

Before considering a framework change complete:
- `npm run verify`
- `npm test`

