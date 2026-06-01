# Contributing

This file is intentionally short.

The main docs in this repo are written for people installing and using Veritas.
This file is the footnote for people developing the product itself.

## Development Rules

- keep the core product generic
- prefer install/use clarity over maintainer cleverness
- avoid adding repo-specific assumptions to the core
- update the relevant docs and examples whenever the operator surface changes
- keep [README.md](README.md), [docs/README.md](docs/README.md), and the `docs/reference/` pages aligned with the shipped CLI and artifact surface
- keep the tracked `.veritas/` dogfooding config current, but do not commit generated `.veritas/evidence/`, `.veritas/standards-feedback-drafts/`, or `.veritas/standards-feedback/`
- no new dependencies without clear leverage

## Verification

Before considering a framework change complete:

```bash
npm run verify
npm test
```

## When Adding New Concepts

If you add a new Veritas concept, update:

1. the relevant schema
2. at least one example artifact
3. the user-facing docs

That keeps Veritas understandable for both agents and humans.
