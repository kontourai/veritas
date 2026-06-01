# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning for published package releases.

## [Unreleased]

## Prior Pre-Alignment Release - 2026-04-26

### Added

- Native evidence-inventory manifest validation and evidence fields for owners, freshness, review triggers, and evidence basis.
- `veritas readiness --check coverage` for focused readiness-coverage output in human, feedback, and JSON formats.
- Brownfield init inventory for legacy guidance, convergence, and guardrail checks.
- Reference documentation for evidence-inventory results, brownfield adoption, and readiness-coverage review.

### Changed

- Evidence artifacts now include a generated `readiness_coverage` that separates required, candidate, advisory, move-to-test, retire, and upstream-abstraction evidence inventories.
- Required evidence inventories must have an owner, review trigger, evidenceCheck id, and non-unknown recent catch evidence.
- Package version was prepared for the pre-alignment release.

## [0.1.3] - 2026-04-23

## [0.1.2] - 2026-04-23

## [0.1.1] - 2026-04-23

### Added

- Marker benchmark suite support and benchmark fixture coverage.
- Release automation for CI, docs pages, and npm publishing.
- Migration guidance, benchmarking methodology, schema-evolution policy, and release-process documentation.
- Community files for security reporting, issue intake, and pull requests.

### Changed

- Evidence Check commands now execute as tokenized argv without an implicit shell wrapper.
- Evidence Check command output now uses inherited stdio instead of rewriting stdout into stderr.
- Shared CLI token parsing, JSON loading, and path-boundary guard helpers were extracted into dedicated source modules.
- The Veritas repo conformance workflow now sanitizes `GITHUB_OUTPUT` values and scopes write permissions to the jobs that need them.

### Security

- Closed the config-level shell-injection path in evidence-check execution.
- Hardened Codex hook inspection and base-ref inference error handling.

## [0.1.0] - 2026-04-22

### Added

- Initial public package surface for repo-local repo maps, repo standards, evidence artifacts, and live standards feedback artifacts.
- CLI support for bootstrap, reporting, standards feedback drafting/recording, runtime hook setup, and deterministic marker benchmarks.
- Reference repo maps, repo standards, schemas, and shipped example artifacts for evidence, standards feedback, repo conformance, and benchmarks.
