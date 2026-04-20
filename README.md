# AI Guidance Framework

> “A good harness is really operationalized around giving the model text at the right time so it can look at the work it has done and the information around what a good job looks like.”
>
> Ryan Laapo, OpenAI

Code is free. Trusted delivery is not.

This framework gives teams a shared operating layer for agentic development, with just-in-time guidance, standardized construction paths, baseline compliance, and evidence-backed feedback loops. The result is faster delivery, safer parallelization, and scalable agent output without making human review the bottleneck.

`ai-guidance-framework` is designed to be:

- easy for an agent to operate inside
- easy for a team to install and use
- easy for reviewers to trust

It should guide the repo in a way that is available to whatever AI is touching the codebase, not only one specific agent runtime.

It does that through three pieces:

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

- bootstrap a starter `.ai-guidance/` setup for a new repo
- infer conservative starter defaults from the target repo shape
- load repo adapters and policy packs
- resolve changed files into graph nodes and workstreams
- emit structured evidence records and Markdown summaries
- evaluate executable policy-pack rules
- define live-eval and team-tuning artifacts for measuring usefulness over time
- ship canonical fixtures for adapters, evidence, and convergence rule families

The first interpreted rule class is `required-repo-artifacts`, which `work-agent` now consumes through the framework instead of keeping fully bespoke in `verify:convergence`.

## Install

The install path should stay short.

```bash
npm install
```

Then bootstrap the repo:

```bash
npm exec -- ai-guidance init
```

That writes the minimum starter kit:

1. one adapter
2. one policy pack
3. one team profile
4. one local README

The first adaptive slice also inspects the repo for likely source roots, test roots, workflow presence, and a likely proof lane, then writes those decisions into the generated starter README so the team can confirm them quickly.

If you already know the right proof lane, you can still override it with `--proof-lane`.

## Use It

The primary workflow is:

1. bootstrap the repo
2. run the guidance report against changed files
3. use that evidence in review, CI, or future live evals

```bash
npm run verify
npm test

npm exec -- ai-guidance init

npm exec -- ai-guidance report --run-id local-smoke \
  package.json
```

If you want the shortest path to understanding the system as a user:

- read [docs/design/agent-activation.md](docs/design/agent-activation.md)
- read [docs/design/framework-core-vs-adapter.md](docs/design/framework-core-vs-adapter.md)
- read [docs/design/live-evals.md](docs/design/live-evals.md)
- read [docs/design/live-eval-roadmap.md](docs/design/live-eval-roadmap.md)
- read [docs/design/policy-packs.md](docs/design/policy-packs.md)
- read [docs/guides/getting-started.md](docs/guides/getting-started.md)
- read [docs/guides/start-your-next-project.md](docs/guides/start-your-next-project.md)
- read [docs/guides/tune-for-your-team.md](docs/guides/tune-for-your-team.md)
- inspect:
  - [adapters/work-agent.adapter.json](adapters/work-agent.adapter.json)
  - [adapters/demo-docs-site.adapter.json](adapters/demo-docs-site.adapter.json)
  - [policy-packs/work-agent-convergence.policy-pack.json](policy-packs/work-agent-convergence.policy-pack.json)
  - [examples/evidence/work-agent-pass.json](examples/evidence/work-agent-pass.json)
  - [examples/evals/work-agent-shadow-eval.json](examples/evals/work-agent-shadow-eval.json)
  - [examples/evals/work-agent-team-profile.json](examples/evals/work-agent-team-profile.json)

## Repository Layout

- `src/` — framework core and policy evaluation
- `bin/` — CLI entrypoints for bootstrap and reporting
- `schemas/` — JSON schemas for graph, adapter, evidence, policy-pack, eval, and team-profile artifacts
- `adapters/` — example adapters
- `policy-packs/` — example policy packs
- `examples/` — canonical evidence fixtures and grouped convergence classification artifacts
- `docs/design/` — framework rationale and structure
- `docs/guides/` — onboarding, bootstrap, and operator-oriented usage guidance

## Commands

```bash
npm run verify
npm test
```

## Developing The Framework

If you want to contribute to the framework itself, use [CONTRIBUTING.md](CONTRIBUTING.md).
