# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

Veritas helps teams earn merge autonomy for AI-authored code by making repo standards executable, evidence-backed, and inspectable.

Define what good looks like for your repo. Veritas checks each change against those standards, gives the agent just-in-time guidance while it works, and produces a readiness report that says whether the change has enough fresh evidence to merge with reduced human review.

> **Engine and Governance Kit.** `@kontourai/veritas` is a standalone **evaluation engine** — an
> importable library (engine API at `@kontourai/veritas/engine`) plus the thin CLIs used below.
> Its repo-installed **product surface** — scaffolding standards, wiring hooks, authoring standards,
> and delivering just-in-time guidance to agents — is also packaged as the flow-agents
> **[Veritas Governance Kit](https://github.com/kontourai/flow-agents/tree/main/kits/veritas-governance)**,
> which wraps this engine via its CLI + recorded artifacts (it never reimplements evaluation). Use
> the standalone CLI directly, as in the Quickstart, or adopt the kit inside a Flow Agents setup —
> both drive the same engine. See the [Engine / Surface Seam](docs/architecture/engine-surface-seam.md).

## Quickstart

Inside a git repository:

```bash
npm install -D @kontourai/veritas
npx veritas init
```

That bootstraps repo standards, a repo map, and AI instruction guidance under `.veritas/`. Once you've reviewed the generated standards, protect them with an authority-backed attestation — do this before your first readiness check, or `readiness` reports an advisory warning that no attestation exists yet:

```bash
npx veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
```

Now check the current working tree:

```bash
npx veritas readiness --working-tree
```

You'll see output like:

```text
veritas: 8 files changed -> governance.guidance
PASS  evidence-check: node -e "process.exit(0)"
PASS  policy-changes-require-attestation: Active attestation bootstrap-2026-07-20T14-18-01-415Z-ba6e20f3f7ba matches current protected standards hashes.
PASS  required-veritas-artifacts: All required repository artifacts are present.
PASS  ai-instruction-files-synced: All required AI instruction files contain the canonical Veritas governance block.
PASS  prefer-veritas-routed-delivery: All required repository artifacts are present.

0 failures · 0 warnings · run `veritas readiness --check evidence` for full generated evidence
```

## Governance Kit

This repository is also a root-valid Flow Kit repository. Install the Veritas Governance Kit
directly from a pinned Git ref, activate its flows and skills, and then use its setup guidance to
install or configure the standalone engine in the target repository:

```bash
npx @kontourai/flow-agents kit install \
  https://github.com/kontourai/veritas.git#v1.5.1 --dest .
npx @kontourai/flow-agents kit activate --dest . --format json
```

Git installation never executes setup scripts or silently installs the engine. See the
[Governance Kit guide](docs/guides/governance-kit.md) for the reviewed engine-setup and readiness
gate sequence.

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
  "enforcementLevel": "Guide",
  "match": {
    "if-changed": "app/api/**",
    "then-require": "tests/api/**"
  }
}
```

`enforcementLevel: "Guide"` means this requirement shows up as a `WARN`, not a blocking `FAIL` — it is advice the agent should follow, not a merge blocker. An agent that edits only the API gets immediate feedback:

```text
$ npx veritas readiness --working-tree
veritas: 1 file changed -> app.app
PASS  evidence-check: node -e "process.exit(0)"
PASS  policy-changes-require-attestation: Active attestation bootstrap-2026-07-20T14-19-16-185Z-d827e763e4e0 matches current protected standards hashes.
PASS  required-veritas-artifacts: All required repository artifacts are present.
PASS  ai-instruction-files-synced: All required AI instruction files contain the canonical Veritas governance block.
WARN  api-routes-require-api-tests: Changed files matched app/api/** but no companion changes matched tests/api/**.
      -> app/api/projects/route.ts
PASS  no-console-log-in-app: No matched files contain forbidden pattern console\.log.
PASS  centralize-env-access: No matched files contain forbidden pattern process\.env\.(?!NODE_ENV).
WARN  surface-status: claim "veritas.policy.fix-sv-caught.nextjs-typescript.api-routes-require-api-tests" is DISPUTED (Evidence explicitly reported a non-passing result.)

0 failures · 2 warnings · run `veritas readiness --check evidence` for full generated evidence
```

After adding the missing API test and rerunning:

```text
$ npx veritas readiness --working-tree
veritas: 2 files changed -> app.app, verification.tests
PASS  evidence-check: node -e "process.exit(0)"
PASS  policy-changes-require-attestation: Active attestation bootstrap-2026-07-20T14-19-16-185Z-d827e763e4e0 matches current protected standards hashes.
PASS  required-veritas-artifacts: All required repository artifacts are present.
PASS  ai-instruction-files-synced: All required AI instruction files contain the canonical Veritas governance block.
PASS  api-routes-require-api-tests: Changed files matched app/api/** and included required companion changes under tests/api/**.
PASS  no-console-log-in-app: No matched files contain forbidden pattern console\.log.
PASS  centralize-env-access: No matched files contain forbidden pattern process\.env\.(?!NODE_ENV).

0 failures · 0 warnings · run `veritas readiness --check evidence` for full generated evidence
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
- [Governance Kit](docs/guides/governance-kit.md)
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

*Veritas is built with [Surface](https://kontourai.io/surface). Veritas projects readiness evidence into Surface format so downstream tools — [Flow](https://kontourai.io/flow) gates, the Surface Console, and MCP-connected agents — can inspect claims and gaps without importing Veritas runtime code.*

## Where Veritas fits

Kontour AI shows the work behind AI:

| Product | Owns |
| --- | --- |
| **Veritas** | Code/change transparency: repo standards, merge readiness |
| **[Surface](https://kontourai.io/surface)** | Portable trust state: claims, evidence, policies, trust snapshots |
| **[Survey](https://kontourai.io/survey)** | Producer evidence: source → extraction → candidate → review → claim |
| **[Flow](https://kontourai.io/flow)** | Process transparency: steps, gates, transitions, runs, exceptions |
| **[Flow Agents](https://kontourai.io/flow-agents)** | Agent-facing distribution: skills, kits, runtime adapters, hooks |

(`kontourai.io/<product>` is each product's homepage; `kontourai.github.io/<product>/` is that product's generated docs site, same split as this repo's own [Full Documentation](https://kontourai.github.io/veritas/) link above.)

Each product stands alone. When they're together: Veritas readiness appears as evidence behind a [Flow](https://kontourai.github.io/flow/) gate, and [Flow Agents](https://kontourai.github.io/flow-agents/) ships the **Veritas Governance Kit** — an agentless kit that projects a real `veritas readiness` verdict into a `software-readiness-verdict` trust.bundle claim the gate checks, and that owns the repo-installed governance surface (scaffold, hooks, standards authoring, agent guidance) by wrapping this engine's CLI. Veritas evaluates; the kit is the product surface built on it.
