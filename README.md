# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

Veritas helps teams earn merge autonomy for AI-authored code by making repo standards executable, evidence-backed, and inspectable.

Define what good looks like for your repo. Veritas checks each change against those standards, gives the agent just-in-time guidance while it works, and produces a readiness report that says whether the change has enough fresh evidence to merge with reduced human review.

## Quickstart

Inside a git repository:

```bash
npm install -D @kontourai/veritas
npx veritas init
npx veritas readiness --working-tree
```

That bootstraps repo standards, a repo map, and AI instruction guidance under `.veritas/`, then checks the current working tree. You'll see output like:

```text
veritas: 0 files changed ->
PASS  required-veritas-artifacts: All required repository artifacts are present.
PASS  ai-instruction-files-synced: All required AI instruction files contain the canonical governance block.

0 failures · 0 warnings
```

Once you've reviewed the generated standards, protect them with an authority-backed attestation:

```bash
npx veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
```

## What You Get

- **Executable repo standards** — requirements for tests, docs, protected files, shared contracts, release checks, security scans, and team-specific expectations.
- **Merge readiness** — a per-change outcome that says whether the current change has enough fresh evidence to merge under the repo standards.
- **Readiness coverage** — the evidence state behind that outcome: satisfied, missing, stale, failing, advisory, recheckable, or accepted by exception.
- **Change boundaries** — work areas, protected areas, and boundary crossings that add coordination, evidence, or authority requirements when shared code is touched.
- **Change guidance** — just-in-time instructions for developers and agents so repo knowledge does not disappear during long AI sessions.
- **Protected standards** — stronger authority requirements for changes that alter the repo standards, repo map, or verification authorities.
- **Standards feedback** — observed evidence about where the standards are helpful, noisy, stale, or missing coverage.
- **Standards recommendations** — suggested improvements to the repo standards based on evidence, with explicit accept/reject review.

## Caught In The Wild

For a repo requirement like (from the shipped [`nextjs-typescript` template](examples/repo-standards/nextjs-typescript.repo-standards.json)):

```json
{
  "id": "api-routes-require-api-tests",
  "kind": "diff-required",
  "match": {
    "if-changed": "app/api/**",
    "then-require": "tests/api/**"
  }
}
```

An agent that edits only the API gets immediate feedback:

```text
$ npx veritas readiness --working-tree
FAIL  api-routes-require-api-tests: Changed files matched app/api/** but no companion changes matched tests/api/**.
      -> app/api/projects/route.ts

1 failure · 0 warnings · run `veritas readiness --check evidence` for full evidence
```

After adding the missing API test and rerunning:

```text
$ npx veritas readiness --working-tree
PASS  api-routes-require-api-tests: Changed files matched app/api/** and included required companion changes under tests/api/**.

0 failures · 0 warnings · run `veritas readiness --check evidence` for full evidence
```

That is the point: the agent gets the missing requirement before it declares done, and reviewers can inspect the evidence instead of rediscovering the repo standards from the diff.

## Core Language

- **Repo Standards** define what good looks like for the repository.
- **Repo Map** defines work areas, change boundaries, protected areas, ownership context, and dependency relationships.
- **Requirement** is the unit of what must be satisfied, evidenced, or accepted by exception.
- **Evidence Check** is a runnable or inspectable check that produces evidence.
- **Verification Authority** is who or what is trusted to verify a requirement.
- **Attestation** is authority-backed evidence that something was verified, accepted, approved, or reviewed.
- **Exception** is an authority-backed decision to accept an unmet or failing requirement for a specific change.
- **Readiness Report** explains merge readiness, readiness coverage, boundary crossings, evidence freshness, recheck options, exceptions, and change guidance.

## Documentation

- [Full Documentation](https://kontourai.github.io/veritas/)
- [Getting Started](docs/guides/getting-started.md)
- [Concepts Overview](docs/concepts.md)
- [Glossary](docs/reference/glossary.md)
- [Veritas and Surface](docs/veritas-and-surface.md)
- [Developer Architecture](docs/architecture/developer-architecture.md)
- [Human Attestation](docs/guides/attestation.md)
- [Standards Recommendations](docs/guides/recommendations.md)
- [CLI Reference](docs/reference/cli.md)
- [Surface-Veritas Boundary](docs/architecture/surface-veritas-boundary.md)

## Repository Layout

- `bin/` — CLI entrypoints
- `src/` — implementation logic
- `schemas/` — JSON schemas
- `docs/` — guides, design, reference
- `tests/` — smoke tests

## Going Deeper

`veritas readiness` is the primary product command for evaluating a change.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0

*Veritas is built with [Surface](https://kontourai.io/surface). Users don't need to configure Surface — it's the shared shape under the readiness state.*

## Where Veritas fits

Kontour AI shows the work behind AI:

| Product | Owns |
| --- | --- |
| **Veritas** | Code/change transparency: repo standards, merge readiness |
| **[Surface](https://kontourai.io/surface)** | Portable trust state: claims, evidence, policies, trust snapshots |
| **[Survey](https://kontourai.io/survey)** | Producer evidence: source → extraction → candidate → review → claim |
| **[Flow](https://kontourai.io/flow)** | Process transparency: steps, gates, transitions, runs, exceptions |
| **[Flow Agents](https://kontourai.io/flow-agents)** | Agent-facing distribution: skills, kits, runtime adapters, hooks |

Each product stands alone. When they're together: Veritas readiness can appear as evidence behind a [Flow](https://kontourai.github.io/flow/) gate, and [Flow Agents](https://kontourai.github.io/flow-agents/) attaches Veritas reports as optional governance evidence.
