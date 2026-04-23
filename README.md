# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

Veritas is a repo-local framework and CLI for trustworthy AI-assisted development. It lets your codebase define its own map, rules, and proof lanes — so AI-generated changes come with structured evidence instead of blind faith. Works with any AI agent. No runtime dependencies beyond Node.

## Quickstart

```bash
npm install -D @kontourai/veritas
npx veritas init
npx veritas shadow run --working-tree
```

That bootstraps your repo with an adapter, policy pack, and team profile, then runs the first shadow check.

## What You Get

- **Repo Map** — a typed graph of your codebase so AI knows what it's touching
- **Rules** — staged policies: invariants, preferences, and temporary rails
- **Evidence** — a bounded artifact of what changed, what was proven, what passed
- **Feedback** — live eval records that measure whether guidance actually helped

## Documentation

- [Full Documentation](https://kontourai.github.io/veritas/)
- [Getting Started](docs/guides/getting-started.md)
- [Concepts Overview](docs/concepts.md)
- [CLI Reference](docs/reference/cli.md)

## Repository Layout

- `bin/` — CLI entrypoints
- `src/` — framework logic
- `schemas/` — JSON schemas
- `docs/` — guides, design, reference
- `tests/` — smoke tests

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0
