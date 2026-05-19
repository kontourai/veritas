# Documentation

Find what you need by what you're trying to do.

## Start Here

- [Concepts Overview](concepts.md) — understand the core ideas in five minutes
- [Getting Started](guides/getting-started.md) — install, bootstrap, and run your first evidence report

## I Want To...

### Set up Veritas in a new repo

- [Getting Started](guides/getting-started.md) for installation and first run
- [Human Attestation](guides/attestation.md) for the Zone 1 human-review gate
- [Proposal Flow](guides/proposal-flow.md) for eval-driven policy changes
- [Start Your Next Project](guides/start-your-next-project.md) for greenfield repos
- [Brownfield Adoption](guides/brownfield-adoption.md) for existing repos with custom guidance or verification
- [Fallow Integration](guides/fallow-integration.md) for optional JS/TS codebase-intelligence proof lanes
- [Plugin Authoring](plugin-authoring.md) for importing tool-owned evidence into authored claims
- [CLI Reference](reference/cli.md) for exact commands and flags

### Wire Veritas into my AI agent

- [Agent Runtime Integrations](guides/agent-runtime-integrations.md) for Claude Code, Cursor, Codex hooks
- [Agent Activation](design/agent-activation.md) for how the framework reaches agents
- [CLI Reference](reference/cli.md) for `explain`, `boundaries check`, and Claude Code PreToolUse hook setup

### Write rules for my repo

- [Policy Packs](design/policy-packs.md) for classification and staging model
- [Tune For Your Team](guides/tune-for-your-team.md) for rollout strategy

### Understand what reviewers see

- [Artifacts and Schemas](reference/artifacts-and-schemas.md) for the JSON contract surface
- [Example Fixtures](reference/examples.md) for sample evidence and eval payloads
- [Telemetry and Read Models](reference/telemetry-and-read-models.md) for derived artifacts
- [Environment Variables](reference/env-vars.md) for hook controls and temporary validation escape hatches

### Measure if Veritas is helping

- [Live Evals](design/live-evals.md) for the feedback model
- [Benchmarking](reference/benchmarking.md) for deterministic marker scoring
- [Live Eval Roadmap](design/live-eval-roadmap.md) for what's coming

### Run Veritas in CI

- [Operational Check-ins](guides/operational-checkins.md) for CI workflow setup
- [CLI Reference](reference/cli.md) for command flags and output format

### Contribute to the framework

- [Framework Core vs Adapter](design/framework-core-vs-adapter.md) for architecture decisions
- [Surface-Veritas Boundary](architecture/surface-veritas-boundary.md) for the one-way Surface foundation and Veritas product boundary
- [Schema Evolution](design/schema-evolution.md) for schema change policy
- [CONTRIBUTING.md](../CONTRIBUTING.md) for development workflow

## All Pages

### Guides

- [Getting Started](guides/getting-started.md) — install the framework and run your first evidence report
- [Walkthrough](guides/walkthrough.md) — initialize a Next.js-style repo and see a fail/pass feedback loop
- [Human Attestation](guides/attestation.md) — record and renew the Zone 1 human-review gate
- [Proposal Flow](guides/proposal-flow.md) — turn eval signal into accepted or rejected policy changes
- [Agent Runtime Integrations](guides/agent-runtime-integrations.md) — connect Veritas to Claude Code, Cursor, and Codex
- [Start Your Next Project](guides/start-your-next-project.md) — bootstrap a greenfield repo with Veritas from day one
- [Tune For Your Team](guides/tune-for-your-team.md) — adapt policy and rollout without forking the framework
- [Operational Check-ins](guides/operational-checkins.md) — run the check-in flow in CI and interpret the output
- [Fallow Integration](guides/fallow-integration.md) — record Fallow results as advisory Veritas evidence
- [Publish And Release](guides/publish-and-release.md) — what gets published, versioned, and how

### Reference

- [CLI Reference](reference/cli.md) — every command, flag, and JSON output shape
- [Artifacts and Schemas](reference/artifacts-and-schemas.md) — the JSON contract surface the framework ships
- [Example Fixtures](reference/examples.md) — canonical sample evidence and eval payloads used by tests
- [Telemetry and Read Models](reference/telemetry-and-read-models.md) — derived artifacts and how to read trends over time
- [Benchmarking](reference/benchmarking.md) — deterministic scoring against marker fixtures
- [Environment Variables](reference/env-vars.md) — hook controls and validation escape hatches
- [Plugin Authoring](plugin-authoring.md) — plugin interface, attribution, and claim scaffolding

### Design

- [Framework Core vs Adapter](design/framework-core-vs-adapter.md) — what stays generic and what lives in the repo adapter
- [Surface-Veritas Boundary](architecture/surface-veritas-boundary.md) — how Veritas maps repo proof into Surface trust input without reversing dependency direction
- [Agent Activation](design/agent-activation.md) — how the framework reaches whatever agent is touching the codebase
- [Policy Packs](design/policy-packs.md) — classification and staging model for repo-specific rules
- [Proof Family Results](design/proof-family-results.md) — native family-level evidence for decomposing broad proof lanes
- [Live Evals](design/live-evals.md) — how the framework measures whether its guidance is actually helping
- [Live Eval Roadmap](design/live-eval-roadmap.md) — the build plan for live eval, phase by phase
- [Schema Evolution](design/schema-evolution.md) — how framework contracts change without breaking consumers

### Project

- [Roadmap](design/roadmap.md) — open design questions and planned work
- [Implementation Backlog](design/implementation-backlog.md) — ordered execution backlog
- [Migrating](MIGRATING.md) — breaking changes and upgrade notes
- [Releasing](RELEASING.md) — publish and release checklist
