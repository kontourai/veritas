# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

Veritas is repo-local policy-pack lint for AI agents. You define what your repo considers mandatory: which files must exist, which tests must pass when a contract changes, which AI instruction files must stay synchronized, what content patterns are forbidden or required, and which governance files may never be weakened. When an agent finishes work, Veritas runs your rules and tells it exactly what it got wrong, like a linter would.

Veritas keeps repo-native workflow language such as adapters, policy packs, proof lanes, and shadow runs because those terms help coding agents act. Each evidence artifact also projects the portable trust shape into `surface.input`, so Surface can generate claims, evidence, freshness/status, fault lines, proof requirements, and trust reports without Veritas becoming a second trust model.

It works with any AI agent because the operational contract is repo-local: adapter, policy pack, proof lanes, hooks, and eval history live in your repository. Veritas builds its portable trust projection with Surface, but Surface does not ship Veritas-specific integration.

## Quickstart

```bash
npm install -D @kontourai/veritas
npx veritas init
npx veritas budget --working-tree
npx veritas shadow run --working-tree
```

That bootstraps your repo with an adapter, policy pack, team profile, and AI instruction governance blocks, shows the current verification budget, then runs the first feedback check.

## What You Get

- **Rules** — repo-specific lint for agents: required artifacts, governance blocks, diff-based companion changes, surface ownership boundaries, and content pattern checks
- **Feedback** — terse `PASS` / `FAIL` / `WARN` output designed to go straight back into an agent's context window
- **JIT context** — `veritas explain` and Claude Code PreToolUse hook output scoped to the rule or file being edited
- **Evidence** — local reports with selected proof lanes, policy results, optional proof-family results, verification budgets, and embedded `surface.input`
- **Budgeting** — `veritas budget` shows required, candidate, advisory, move-to-test, retiring, stale, and triggerless proof families
- **Improvement** — eval history so you can measure whether the guidance is helping over time

## Caught In The Wild

For a repo with this rule:

```json
{
  "id": "api-changes-require-test-changes",
  "kind": "diff-required",
  "match": {
    "if-changed": "src-server/api/",
    "then-require": "tests/api/"
  }
}
```

An agent that edits only the API gets immediate feedback:

```text
$ npx veritas shadow run --working-tree
FAIL  api-changes-require-test-changes: Changed files matched src-server/api/ but no companion changes matched tests/api/.
      -> src-server/api/projects.ts

1 failure · 0 warnings · run `veritas report` for full evidence
```

After adding the missing API test and rerunning:

```text
$ npx veritas shadow run --working-tree
PASS  api-changes-require-test-changes: Changed files matched src-server/api/ and included required companion changes under tests/api/.

0 failures · 0 warnings · run `veritas report` for full evidence
```

That is the point: the agent sees the missing proof before it declares done.

## Documentation

- [Full Documentation](https://kontourai.github.io/veritas/)
- [Getting Started](docs/guides/getting-started.md)
- [Brownfield Adoption](docs/guides/brownfield-adoption.md)
- [Concepts Overview](docs/concepts.md)
- [Deep Integration Template](docs/guides/deep-integration-template.md)
- [CLI Reference](docs/reference/cli.md)
- [Surface-Veritas Boundary](docs/architecture/surface-veritas-boundary.md)

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
