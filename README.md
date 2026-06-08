# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

Veritas helps teams earn merge autonomy for AI-authored code by making repo standards executable, evidence-backed, and inspectable.

Define what good looks like for your repo. Veritas checks each change against those standards, gives the agent just-in-time guidance while it works, and produces a readiness report that says whether the change has enough fresh evidence to merge with reduced human review.

## Quickstart

```bash
npm install -D @kontourai/veritas
npx veritas init
npx veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
npx veritas readiness --working-tree
```

That bootstraps repo standards, a repo map, and AI instruction guidance under `.veritas/`, records the first authority-backed attestation for protected standards, then checks the current working tree.

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

For a repo requirement like:

```json
{
  "id": "api-changes-need-api-tests",
  "kind": "diff-required",
  "match": {
    "if-changed": "src-server/api/",
    "then-require": "tests/api/"
  }
}
```

An agent that edits only the API gets immediate feedback:

```text
$ npx veritas readiness --working-tree
FAIL  api-changes-need-api-tests: Changed files matched src-server/api/ but no companion changes matched tests/api/.
      -> src-server/api/projects.ts

1 failure · 0 warnings · run `veritas readiness --check evidence` for full evidence
```

After adding the missing API test and rerunning:

```text
$ npx veritas readiness --working-tree
PASS  api-changes-need-api-tests: Changed files matched src-server/api/ and included required companion changes under tests/api/.

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

*Veritas is built with [Surface](https://github.com/kontourai/surface). Users don't need to configure Surface — it's the shared shape under the readiness state.*
