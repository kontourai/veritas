# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning for published package releases.

## [1.1.0](https://github.com/kontourai/veritas/compare/v1.0.0...v1.1.0) (2026-06-16)


### Maintenance

* release 1.1.0 — ship Hachure trust-format alignment ([#95](https://github.com/kontourai/veritas/issues/95)) ([186668c](https://github.com/kontourai/veritas/commit/186668c16c2608caf06aca392719b9287156a2ca))

## [1.0.0](https://github.com/kontourai/veritas/compare/v0.5.1...v1.0.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* require Node >= 22; verify on current LTS (22, 24) ([#90](https://github.com/kontourai/veritas/issues/90))

### Features

* require Node &gt;= 22; verify on current LTS (22, 24) ([#90](https://github.com/kontourai/veritas/issues/90)) ([6ca8869](https://github.com/kontourai/veritas/commit/6ca8869235e82d986537f41f78d596f1e1205f50))


### Fixes

* **ci:** author release PRs via kontour-release-bot app token ([#89](https://github.com/kontourai/veritas/issues/89)) ([4b80089](https://github.com/kontourai/veritas/commit/4b80089acf6dcdd276be7f193128c91b9ae01be3))

## [0.5.1](https://github.com/kontourai/veritas/compare/v0.5.0...v0.5.1) (2026-06-12)


### Documentation

* Kontour Veritas branding and tagline, requirement kinds table, decision-language cleanups ([#87](https://github.com/kontourai/veritas/issues/87)) ([7671cce](https://github.com/kontourai/veritas/commit/7671cce21b1261d187eef9ced153cd4824c20941))

## [0.5.0](https://github.com/kontourai/veritas/compare/v0.4.0...v0.5.0) (2026-06-11)


### Features

* emit surface readiness claims ([82e3e10](https://github.com/kontourai/veritas/commit/82e3e10064c43a3647500a0dc619d617f9c17211))
* TrustBundle rename + neutral trust block on surface 0.9 ([#83](https://github.com/kontourai/veritas/issues/83)) ([26847f0](https://github.com/kontourai/veritas/commit/26847f0354ce2c7b06aaafbdec80ca160c1ec82e))


### Fixes

* allow veritas checkin PR comments ([e5b892a](https://github.com/kontourai/veritas/commit/e5b892adfda03f080abc9707483f3b422a275a1c))


### Documentation

* audit and fix documentation accuracy and intuitiveness ([#79](https://github.com/kontourai/veritas/issues/79)) ([a23de7b](https://github.com/kontourai/veritas/commit/a23de7b9ac263a6510863a842652964c1f16c8f8))
* mark shipped landing-path backlog items ([#82](https://github.com/kontourai/veritas/issues/82)) ([28d7a68](https://github.com/kontourai/veritas/commit/28d7a6865dd4853652db805a95f3f6dce3dc7124))

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
