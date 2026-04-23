# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)

`@kontourai/veritas` is a repo-local framework and CLI for making AI-assisted development easier to trust.

It gives a codebase four things:

- a typed map of the repo through an **adapter**
- a staged ruleset through a **policy pack**
- a durable record of what changed through **evidence artifacts**
- a feedback loop for usefulness through **live eval artifacts**

The framework is intentionally agent-agnostic. It does not require one proprietary runtime, and it does not assume the framework repo owns the product code it is guiding.

## What This Project Ships

- a small Node CLI in `bin/` for bootstrap, reporting, shadow runs, eval capture, and hook setup
- framework logic in `src/index.mjs`
- JSON schemas in `schemas/`
- reference adapters and policy packs in `adapters/` and `policy-packs/`
- canonical example artifacts in `examples/`
- design, guide, and reference docs in `docs/`

All shipped CLI commands print JSON to stdout, and the command surfaces described in the docs are exercised by the test suite.

The benchmark layer now supports both single marker comparisons and multi-scenario suite summaries for proving that Veritas surfaces the right repo-specific context at the right time.

## What This Project Does Not Try To Be

- a hosted control plane
- a single-agent runtime
- a repo-specific product implementation
- a pile of one-off CI assertions with no reusable structure

Repo-specific bindings belong in adapters and policy packs.

## Operational Check-ins

This repo uses `veritas` on itself through the tracked files in `.veritas/`.

The intent is to use the same operational check-in flow that a normal consumer repo would use, not a one-off internal lane.

- keep `.veritas/repo.adapter.json`, `.veritas/policy-packs/default.policy-pack.json`, `.veritas/team/default.team-profile.json`, and `.veritas/README.md` reviewable and tracked
- keep the repo in `shadow` mode while the operator surface is still evolving
- treat `.veritas/evidence/`, `.veritas/eval-drafts/`, and `.veritas/evals/` as disposable local outputs, not source artifacts
- if self-hosting feels awkward, fix the product surface rather than hardcoding special behavior for the `veritas` repo

Use these repo-local scripts:

```bash
npm run veritas:checkin:report
npm run veritas:checkin:shadow
npm run veritas:checkin
npm run veritas:checkin:examples
npm run veritas:checkin:prove
```

The committed proof examples live under [examples/checkins/README.md](examples/checkins/README.md), and the check-in workflow is documented in [docs/guides/operational-checkins.md](docs/guides/operational-checkins.md).

There is also a scheduled GitHub Actions workflow at [.github/workflows/veritas-checkins.yml](.github/workflows/veritas-checkins.yml) that runs the check-in lane on `main`, on pull requests, on manual dispatch, and weekly. It uploads the generated `.veritas` check-in artifacts so you can inspect how the self-hosting lane is behaving over time.

That workflow now actively elevates the evidence:

- pull requests get an updated Veritas check-in comment
- non-PR runs update a standing `Veritas Health` issue when health is not green
- the issue closes automatically again when health returns to green

## Quickstart

Install dependencies and verify the framework repo itself:

```bash
npm install
npm run verify
npm test
```

Bootstrap a target repo with the starter kit:

```bash
npm install -D @kontourai/veritas
npm exec -- veritas init
```

Then use the normal operator flow:

```bash
npm exec -- veritas print package-scripts
npm exec -- veritas print ci-snippet
npm exec -- veritas apply package-scripts
npm exec -- veritas apply ci-snippet
npm exec -- veritas report --working-tree
npm exec -- veritas shadow run --working-tree
```

If you want exact flags instead of the short path, use:

```bash
npm exec -- veritas --help
npm exec -- veritas report --help
npm exec -- veritas eval marker-suite --suite examples/benchmarks/marker-suite.json
```

## Documentation Map

Start here:

- [Docs Home](docs/README.md) for the reading map by audience and repo area
- [Getting Started](docs/guides/getting-started.md) for first-time setup and the basic workflow
- [CLI Reference](docs/reference/cli.md) for exact commands, flags, outputs, and generated files
- [Artifacts and Schemas](docs/reference/artifacts-and-schemas.md) for the repo structure and JSON contract surface
- [Telemetry and Read Models](docs/reference/telemetry-and-read-models.md) for canonical artifacts, derived summaries, and optional telemetry export
- [Example Fixtures](docs/reference/examples.md) for the shipped evidence, eval, and classification examples

Go deeper here:

- [Framework Core vs Adapter](docs/design/framework-core-vs-adapter.md)
- [Agent Activation](docs/design/agent-activation.md)
- [Policy Packs](docs/design/policy-packs.md)
- [Live Evals](docs/design/live-evals.md)
- [Live Eval Roadmap](docs/design/live-eval-roadmap.md)
- [Operational Check-ins](docs/guides/operational-checkins.md)
- [Publish And Release](docs/guides/publish-and-release.md)
- [Tune The Framework For Your Team](docs/guides/tune-for-your-team.md)
- [Start Your Next Project With Veritas](docs/guides/start-your-next-project.md)

## Repository Layout

- `bin/` — CLI entrypoints
- `src/` — framework logic and exported helpers
- `schemas/` — JSON schemas for adapters, evidence, evals, graphs, policy packs, and team profiles
- `adapters/` — reference repo adapters
- `policy-packs/` — reference policy packs
- `examples/` — example evidence, eval, and rule-family artifacts
- `docs/` — guides, design notes, and reference material
- `tests/` — CLI and framework smoke coverage
- `scripts/verify.mjs` — low-cost repository verification for docs and fixtures

The `adapters/` directory contains reference adapters for other repo shapes, not the active adapter for this repo. Veritas dogfoods itself through the tracked repo-local adapter at `.veritas/repo.adapter.json`.

## Verification

Before calling the repo ready:

```bash
npm run verify
npm test
```

## Contributing

Framework development guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).
