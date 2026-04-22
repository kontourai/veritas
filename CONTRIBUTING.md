# Contributing

This file is intentionally short.

The main docs in this repo are written for people installing and using the framework.
This file is the footnote for people developing the framework itself.

## Development Rules

- keep the framework generic
- prefer install/use clarity over maintainer cleverness
- avoid adding repo-specific assumptions to the core
- update the relevant docs and examples whenever the operator surface changes
- keep [README.md](README.md), [docs/README.md](docs/README.md), and the `docs/reference/` pages aligned with the shipped CLI and artifact surface
- keep the tracked `.veritas/` check-in config current, but do not commit `.veritas/evidence/`, `.veritas/eval-drafts/`, or `.veritas/evals/`
- no new dependencies without clear leverage

## Verification

Before considering a framework change complete:

```bash
npm run verify
npm test
```

## When Adding New Concepts

If you add a new framework concept, update:

1. the relevant schema
2. at least one example artifact
3. the user-facing docs

That keeps the framework understandable for both agents and humans.
