# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

Veritas is repo-local policy-pack lint for AI-assisted code changes. You define what your repo considers mandatory; Veritas runs those rules and tells the agent what it missed before review.

The headline loop is: run checks, let eval history propose policy changes, and require a human attestation before Zone 1 governance changes become trusted.

## Quickstart

```bash
npm install -D @kontourai/veritas
npx veritas init
npx veritas attest bootstrap --actor <human-id> --non-interactive
npx veritas run --check budget --working-tree
npx veritas run --working-tree
```

That bootstraps your repo with an adapter, policy pack, team profile, and AI instruction governance blocks, records the first human attestation for Zone 1 governance, shows the current verification budget, then runs the first feedback check.

If the adapter, policy pack, or team profile changes later, `veritas run` emits `policy-changes-require-attestation` until a human runs `veritas attest policy-change --actor <human-id> --message <reason>`.

Veritas projects every run into a `surface.input` block consumable by [Surface](https://github.com/kontourai/surface). You can also use Veritas by itself.

## What You Get

- **Enforce boundaries** — required files, governance blocks, companion test changes, ownership boundaries, and forbidden or required patterns.
- **Keep governance human-owned** — attestation gates policy-pack, adapter, and team-profile drift instead of letting generated evidence silently bless governance changes.
- **Turn eval signal into proposals** — `veritas eval propose` drafts rule relaxations, retirements, and surface additions; `veritas proposal decide` accepts or rejects them, and accepted rule diffs chain a fresh attestation.
- **Deliver just-in-time context** — `veritas explain` and hook output tell the agent why the file or rule matters at the point of edit.
- **Help agents self-correct** — `veritas run` prints concise `PASS` / `FAIL` / `WARN` feedback the agent can act on before it declares done.

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
$ npx veritas run --working-tree
FAIL  api-changes-require-test-changes: Changed files matched src-server/api/ but no companion changes matched tests/api/.
      -> src-server/api/projects.ts

1 failure · 0 warnings · run `veritas run --check shadow` for full evidence
```

After adding the missing API test and rerunning:

```text
$ npx veritas run --working-tree
PASS  api-changes-require-test-changes: Changed files matched src-server/api/ and included required companion changes under tests/api/.

0 failures · 0 warnings · run `veritas run --check shadow` for full evidence
```

That is the point: the agent sees the missing proof before it declares done.

## Documentation

- [Full Documentation](https://kontourai.github.io/veritas/)
- [Veritas and Surface](docs/veritas-and-surface.md) — how the two relate, when to reach for each
- [Getting Started](docs/guides/getting-started.md)
- [Worked Walkthrough](docs/guides/walkthrough.md)
- [Brownfield Adoption](docs/guides/brownfield-adoption.md)
- [Human Attestation](docs/guides/attestation.md)
- [Proposal Flow](docs/guides/proposal-flow.md)
- [Concepts Overview](docs/concepts.md)
- [Glossary](docs/reference/glossary.md) — Veritas → Surface vocabulary mapping
- [Deep Integration Template](docs/guides/deep-integration-template.md)
- [CLI Reference](docs/reference/cli.md)
- [Surface-Veritas Boundary](docs/architecture/surface-veritas-boundary.md)

## Repository Layout

- `bin/` — CLI entrypoints
- `src/` — framework logic
- `schemas/` — JSON schemas
- `docs/` — guides, design, reference
- `tests/` — smoke tests

## Going Deeper

Veritas can also record evidence artifacts, eval drafts, proof-family results, verification budgets, and Surface trust projections. Those pieces are useful once the basic feedback loop is working.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0
