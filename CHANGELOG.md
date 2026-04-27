# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning for published package releases.

## [Unreleased]

## [0.3.0] - 2026-04-26

### Added

- Native proof-family manifest validation and evidence fields for owners, freshness, review triggers, and evidence basis.
- `veritas budget` for focused verification-budget output in human, feedback, and JSON formats.
- Brownfield init inventory for legacy guidance, convergence, and guardrail checks.
- Reference documentation for proof-family results, brownfield adoption, and verification-budget review.

### Changed

- Evidence artifacts now include a generated `verification_budget` that separates required, candidate, advisory, move-to-test, retire, and upstream-abstraction families.
- Required proof families must have an owner, review trigger, lane id, and non-unknown recent catch evidence.
- Package version is prepared for the `@kontourai/veritas@0.3.0` release.

## [0.1.3] - 2026-04-23

## [0.1.2] - 2026-04-23

## [0.1.1] - 2026-04-23

### Added

- Marker benchmark suite support and benchmark fixture coverage.
- Release automation for CI, docs pages, and npm publishing.
- Migration guidance, benchmarking methodology, schema-evolution policy, and release-process documentation.
- Community files for security reporting, issue intake, and pull requests.

### Changed

- Proof commands now execute as tokenized argv without an implicit shell wrapper.
- Proof command output now uses inherited stdio instead of rewriting stdout into stderr.
- Shared CLI token parsing, JSON loading, and path-boundary guard helpers were extracted into dedicated source modules.
- The Veritas check-in workflow now sanitizes `GITHUB_OUTPUT` values and scopes write permissions to the jobs that need them.

### Security

- Closed the config-level shell-injection path in proof-lane execution.
- Hardened Codex hook inspection and base-ref inference error handling.

## [0.1.0] - 2026-04-22

### Added

- Initial public package surface for repo-local adapters, policy packs, evidence artifacts, and live eval artifacts.
- CLI support for bootstrap, reporting, eval drafting/recording, runtime hook setup, and deterministic marker benchmarks.
- Reference adapters, policy packs, schemas, and shipped example artifacts for evidence, evals, check-ins, and benchmarks.
