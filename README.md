# AI Guidance Framework

`ai-guidance-framework` is a lightweight framework for keeping AI-driven development focused, reviewable, and auditable without forcing humans to manually rediscover the same guardrails on every change.

It does that with three pieces:

- a **[framework core](docs/design/framework-core-vs-adapter.md)** that understands graph nodes, resolution, evidence, and policy evaluation
- a **[repo adapter](docs/design/framework-core-vs-adapter.md)** that maps those abstractions onto a real codebase
- **[policy packs](docs/design/policy-packs.md)** that define what a repo treats as required, promotable, or still too brittle to trust fully

## Why This Structure Matters

Most AI coding systems fail in one of two ways:

1. they are too loose, so the model wanders and humans have to audit everything manually
2. they are too repo-specific, so the "framework" is really just a pile of local checks that cannot transfer

This framework is structured to avoid both failure modes.

- **AI focus:** the adapter turns a repo into bounded nodes and proof lanes, so the model can reason about where it is operating instead of treating the whole repo as one blob.
- **Auditability:** the evidence record turns "the agent seemed fine" into a concrete artifact with phase, workstream, affected nodes, proof-lane status, and policy-pack provenance.
- **Policy evolution:** policy packs let a team distinguish hard invariants from softer guidance instead of encoding every rule as an equally rigid one-off script.
- **Differentiation:** most agent tooling stops at prompting or orchestration. This repo is about making agent behavior legible, reviewable, and enforceable at the repo boundary.

## Current Capabilities

Today the framework can:

- load repo adapters and policy packs
- resolve changed files into graph nodes and workstreams
- emit structured evidence records and Markdown summaries
- evaluate executable policy-pack rules
- ship canonical fixtures for adapters, evidence, and convergence rule families

The first interpreted rule class is `required-repo-artifacts`, which `work-agent` now consumes through the framework instead of keeping fully bespoke in `verify:convergence`.

## Quick Start

The onboarding path is intentionally short.

1. Copy or author one adapter JSON for your repo.
2. Author one policy pack with the handful of rules you actually care about first.
3. Run the CLI against a changed-file set or a git diff.

```bash
npm install
npm run verify
npm test

node bin/ai-guidance-report.mjs \
  --root /path/to/repo \
  --adapter ./adapters/work-agent.adapter.json \
  --policy-pack ./policy-packs/work-agent-convergence.policy-pack.json \
  --run-id local-smoke \
  package.json
```

If you want the shortest path to understanding the model:

- read [docs/design/framework-core-vs-adapter.md](docs/design/framework-core-vs-adapter.md)
- read [docs/design/policy-packs.md](docs/design/policy-packs.md)
- read [docs/guides/getting-started.md](docs/guides/getting-started.md)
- inspect:
  - [adapters/work-agent.adapter.json](adapters/work-agent.adapter.json)
  - [adapters/demo-docs-site.adapter.json](adapters/demo-docs-site.adapter.json)
  - [policy-packs/work-agent-convergence.policy-pack.json](policy-packs/work-agent-convergence.policy-pack.json)
  - [examples/evidence/work-agent-pass.json](examples/evidence/work-agent-pass.json)

## Repository Layout

- `src/` — framework core and policy evaluation
- `bin/` — CLI entrypoint
- `schemas/` — JSON schemas for graph, adapter, evidence, and policy-pack artifacts
- `adapters/` — example adapters
- `policy-packs/` — example policy packs
- `examples/` — canonical evidence fixtures and grouped convergence classification artifacts
- `docs/design/` — framework rationale and structure
- `docs/guides/` — onboarding and operator-oriented usage guidance

## Commands

```bash
npm run verify
npm test
```
