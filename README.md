# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

Veritas is bespoke lint for AI agents. You define what your repo considers mandatory: which files must exist, which tests must pass when a contract changes, which AI instruction files must stay synchronized, and which governance files may never be weakened. When an agent finishes work, Veritas runs your rules and tells it exactly what it got wrong, like a linter would.

It works with any AI agent because the contract is repo-local: adapter, policy pack, proof lanes, hooks, and eval history live in your repository. No runtime dependencies beyond Node.

## Quickstart

```bash
npm install -D @kontourai/veritas
npx veritas init
npx veritas budget --working-tree
npx veritas shadow run --working-tree
```

That bootstraps your repo with an adapter, policy pack, team profile, and AI instruction governance blocks, shows the current verification budget, then runs the first feedback check.

## What You Get

- **Rules** — repo-specific lint for agents: required artifacts, governance blocks, proof lanes, and diff-based companion changes
- **Feedback** — terse `PASS` / `FAIL` / `WARN` output designed to go straight back into an agent's context window
- **Evidence** — local reports with selected proof lanes, policy results, optional proof-family results, and verification budgets
- **Budgeting** — `veritas budget` shows required, candidate, advisory, move-to-test, retiring, stale, and triggerless proof families
- **Improvement** — eval history so you can measure whether the guidance is helping over time

## Caught In The Wild

In the work-agent case study shape, a rule can say: if `src-server/api/` changes, `tests/api/` must appear in the same diff. Without Veritas, an agent can finish with a green-looking implementation and no API proof. With Veritas:

```text
FAIL  api-changes-require-test-changes: Changed files matched src-server/api/ but no companion changes matched tests/api/.
      -> src-server/api/projects.ts
```

That is the point: the agent sees the missing proof before it declares done.

## Documentation

- [Full Documentation](https://kontourai.github.io/veritas/)
- [Getting Started](docs/guides/getting-started.md)
- [Brownfield Adoption](docs/guides/brownfield-adoption.md)
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
