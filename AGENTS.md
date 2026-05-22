# Veritas

## Intent

This repository owns the reusable Veritas product core for:
- graph-based codebase modeling
- task/diff resolution
- evidence collection
- Repo Standards
- adapter contracts

It does **not** own repo-specific product code.

Repo-specific bindings belong in adapters.

## Working Rules

- Keep the product core generic; avoid hardcoding `work-agent` assumptions into the core docs or examples.
- Prefer schema and contract clarity over premature implementation layers.
- When adding new concepts, update the design doc and the relevant schema together.
- Treat adapter examples as examples, not as the product core.
- No new dependencies unless they buy clear leverage.

## Verification

Before considering a framework change complete:
- `npm run verify`
- `npm test`

<!-- veritas:governance-block:start -->
This repo uses Veritas for AI governance. Read `.veritas/GOVERNANCE.md` before making changes.
After changes, run `veritas readiness` and address any FAIL lines before finishing.
<!-- veritas:governance-block:end -->
