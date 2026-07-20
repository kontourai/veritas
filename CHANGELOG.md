# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning for published package releases.

## [1.5.3](https://github.com/kontourai/veritas/compare/v1.5.2...v1.5.3) (2026-07-20)


### Fixes

* keep readiness projections out of worktrees ([b871229](https://github.com/kontourai/veritas/commit/b8712296f19742a7296978a02d78776951bddad2))
* keep readiness projections out of worktrees ([38d77b2](https://github.com/kontourai/veritas/commit/38d77b2f1ee764dc4896ee4486f423d11737ae0f))
* preserve governance artifact bytes ([#154](https://github.com/kontourai/veritas/issues/154)) ([a3b0f4f](https://github.com/kontourai/veritas/commit/a3b0f4f4e310f6ba67f412004db8aaf37c7a4e11))


### Documentation

* content sweep — accuracy and clarity fixes ([#144](https://github.com/kontourai/veritas/issues/144)) ([7bc032a](https://github.com/kontourai/veritas/commit/7bc032ac862fff9c27b24aec311599ca96f49b95))

## [1.5.2](https://github.com/kontourai/veritas/compare/v1.5.1...v1.5.2) (2026-07-20)


### Documentation

* record governance kit epic closeout ([#128](https://github.com/kontourai/veritas/issues/128)) ([6be3175](https://github.com/kontourai/veritas/commit/6be3175ccde79db51dc847e54b22349329f723b8))

## [1.5.1](https://github.com/kontourai/veritas/compare/v1.5.0...v1.5.1) (2026-07-18)


### Fixes

* route the veritas hooks claude-code subcommand (veritas[#119](https://github.com/kontourai/veritas/issues/119)) ([#125](https://github.com/kontourai/veritas/issues/125)) ([05be9dc](https://github.com/kontourai/veritas/commit/05be9dce30a7856d6a027f5ec612602de947c785))

## [1.5.0](https://github.com/kontourai/veritas/compare/v1.4.0...v1.5.0) (2026-07-17)


### Features

* **ci:** enforce the engine has zero flow-agents dependency (flow-agents[#651](https://github.com/kontourai/veritas/issues/651)) ([#123](https://github.com/kontourai/veritas/issues/123)) ([aedbeee](https://github.com/kontourai/veritas/commit/aedbeeee8f91209f4320a0a49480a9003e5b34ef))
* **engine:** add @kontourai/veritas/engine subpath — the frozen engine-library API (flow-agents[#650](https://github.com/kontourai/veritas/issues/650) Step A) ([#120](https://github.com/kontourai/veritas/issues/120)) ([819e173](https://github.com/kontourai/veritas/commit/819e173e6b653330a7142d3a2a37b2707f5e4972))
* **engine:** make the public @kontourai/veritas library API engine-only (flow-agents[#650](https://github.com/kontourai/veritas/issues/650) Step B) ([#122](https://github.com/kontourai/veritas/issues/122)) ([903b5d4](https://github.com/kontourai/veritas/commit/903b5d406e07afb4992136f9ac587354f71a2a91))


### Documentation

* reconcile veritas docs to the engine/kit split (flow-agents[#652](https://github.com/kontourai/veritas/issues/652)) ([#124](https://github.com/kontourai/veritas/issues/124)) ([cfd4470](https://github.com/kontourai/veritas/commit/cfd4470248dcaeb0d47650dbc057dd165f8d3945))

## [1.4.0](https://github.com/kontourai/veritas/compare/v1.3.0...v1.4.0) (2026-07-16)


### Features

* add check-hachure-boundary ratchet (layer-doctrine enforcement) ([#116](https://github.com/kontourai/veritas/issues/116)) ([2a57022](https://github.com/kontourai/veritas/commit/2a5702229ffc7b53616c7dab6b002b36562eb368))

## [1.3.0](https://github.com/kontourai/veritas/compare/v1.2.0...v1.3.0) (2026-07-12)


### Features

* **conformance:** shared content-boundary gate with tracked+untracked enumeration ([#113](https://github.com/kontourai/veritas/issues/113)) ([a93c2fc](https://github.com/kontourai/veritas/commit/a93c2fc883f4aca0ec897b62ece1782ac8c3e03d))

## [1.2.0](https://github.com/kontourai/veritas/compare/v1.1.1...v1.2.0) (2026-07-02)


### Features

* **surface:** migrate Claim `surface` field to `facet`, bump to Surface ^2.0.0 (schemaVersion 5) ([#109](https://github.com/kontourai/veritas/issues/109)) ([d10d037](https://github.com/kontourai/veritas/commit/d10d0372ce4496fba83d4f67f92cd56ba077088e))


### Fixes

* **readiness:** blocking failures win over promotion_allowed short-circuit (fixes [#106](https://github.com/kontourai/veritas/issues/106)) ([#107](https://github.com/kontourai/veritas/issues/107)) ([3d88428](https://github.com/kontourai/veritas/commit/3d88428142ad238ec172134513b251d97a1bc44a))

## [1.1.1](https://github.com/kontourai/veritas/compare/v1.1.0...v1.1.1) (2026-07-01)


### Fixes

* **veritas:** default per-evidence-check timeout so readiness can't hang (ops[#19](https://github.com/kontourai/veritas/issues/19)) ([#102](https://github.com/kontourai/veritas/issues/102)) ([051e8c8](https://github.com/kontourai/veritas/commit/051e8c8a9e5a2cc7428356c02155d5af50d4300b))
* **veritas:** point Surface Console readModelPath at the path the writer actually writes (ops[#18](https://github.com/kontourai/veritas/issues/18)) ([#103](https://github.com/kontourai/veritas/issues/103)) ([5ef141d](https://github.com/kontourai/veritas/commit/5ef141d00536afde6fc5ac46bd254fb692da81fb))
* **veritas:** word-boundary the 'ci' approval denylist token ([#99](https://github.com/kontourai/veritas/issues/99)) ([8be4aa9](https://github.com/kontourai/veritas/commit/8be4aa9f0331d4110a08425da4a7bf50a7a64e56))


### Refactoring

* **veritas:** reconcile repo-standards vocab to Observe/Guide/Require (ops[#17](https://github.com/kontourai/veritas/issues/17)) ([#104](https://github.com/kontourai/veritas/issues/104)) ([ffdd3d3](https://github.com/kontourai/veritas/commit/ffdd3d3008d8ea3b6b432f0782cea0e67d9ee4eb))

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
