# Veritas

`veritas` is a repo-local framework and CLI for making AI-assisted development easier to trust.

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

## What This Project Does Not Try To Be

- a hosted control plane
- a single-agent runtime
- a repo-specific product implementation
- a pile of one-off CI assertions with no reusable structure

Repo-specific bindings belong in adapters and policy packs.

## Dogfooding

This repo uses `veritas` on itself through the tracked files in `.veritas/`.

- keep `.veritas/repo.adapter.json`, `.veritas/policy-packs/default.policy-pack.json`, `.veritas/team/default.team-profile.json`, and `.veritas/README.md` reviewable and tracked
- keep the repo in `shadow` mode while the operator surface is still evolving
- treat `.veritas/evidence/`, `.veritas/eval-drafts/`, and `.veritas/evals/` as disposable local outputs, not source artifacts
- if self-hosting feels awkward, fix the product surface rather than hardcoding special behavior for the `veritas` repo

Use these repo-local scripts:

```bash
npm run veritas:dogfood:report
npm run veritas:dogfood:shadow
npm run veritas:dogfood:checkin
npm run veritas:dogfood:examples
npm run veritas:dogfood:prove
```

The committed proof examples live under [examples/dogfood](/Users/brian/dev/github/kontourai/veritas/examples/dogfood), and the dogfood workflow is documented in [docs/guides/dogfooding-veritas.md](/Users/brian/dev/github/kontourai/veritas/docs/guides/dogfooding-veritas.md).

There is also a scheduled GitHub Actions workflow at [.github/workflows/veritas-dogfood.yml](/Users/brian/dev/github/kontourai/veritas/.github/workflows/veritas-dogfood.yml) that runs the dogfood lane on `main`, on pull requests, on manual dispatch, and weekly. It uploads the generated `.veritas` check-in artifacts so you can inspect how the self-hosting lane is behaving over time.

That workflow now actively elevates the evidence:

- pull requests get an updated Veritas dogfood comment
- non-PR runs update a standing `Veritas Dogfood Health` issue when health is not green
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
npm exec -- veritas init
```

Then use the normal operator flow:

```bash
npm exec -- veritas print package-scripts
npm exec -- veritas print ci-snippet
npm exec -- veritas apply package-scripts
npm exec -- veritas apply ci-snippet
npm exec -- veritas report --working-tree
npm exec -- veritas shadow run
```

If you want exact flags instead of the short path, use:

```bash
npm exec -- veritas --help
npm exec -- veritas report --help
```

## Documentation Map

Start here:

- [Docs Home](docs/README.md) for the reading map by audience and repo area
- [Getting Started](docs/guides/getting-started.md) for first-time setup and the basic workflow
- [CLI Reference](docs/reference/cli.md) for exact commands, flags, outputs, and generated files
- [Artifacts and Schemas](docs/reference/artifacts-and-schemas.md) for the repo structure and JSON contract surface
- [Example Fixtures](docs/reference/examples.md) for the shipped evidence, eval, and classification examples

Go deeper here:

- [Framework Core vs Adapter](docs/design/framework-core-vs-adapter.md)
- [Agent Activation](docs/design/agent-activation.md)
- [Policy Packs](docs/design/policy-packs.md)
- [Live Evals](docs/design/live-evals.md)
- [Live Eval Roadmap](docs/design/live-eval-roadmap.md)
- [Dogfooding Veritas](docs/guides/dogfooding-veritas.md)
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

## Verification

Before calling the repo ready:

```bash
npm run verify
npm test
```

## Contributing

Framework development guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).
