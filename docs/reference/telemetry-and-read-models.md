# Telemetry and Read Models

This page describes how Veritas output should be interpreted over time without turning the product into a heavy observability platform.

## Canonical Records

The canonical Veritas records are repo-local generated evidence and feedback artifacts:

- `.kontourai/veritas/evidence/<run-id>.json`
- `.kontourai/veritas/standards-feedback-drafts/<run-id>.json`
- `.kontourai/veritas/standards-feedback/<run-id>.json`

These artifacts support **Standards Feedback**.

## Derived Summaries

Some outputs are read models rather than source-of-truth records.

Current examples:

- `.kontourai/veritas/repo-conformance/*.json`
- `.kontourai/veritas/repo-conformance/*.md`
- `.kontourai/veritas/surface/<run-id>.console.json`
- `.kontourai/veritas/surface/latest.json`

Use **Readiness Report**, **Repo Conformance**, or **Standards Feedback** depending on the summary.

## Human-Facing Read Model

The intended interpretation path is:

1. readiness report for a change
2. repo conformance for standing requirements
3. standards feedback for trends
4. optional console or telemetry exports

Questions a read-model layer should answer:

- which requirements are noisy over time
- which missed issues repeat
- whether evidence is making review faster
- where time-to-green is drifting
- which evidence checks produce the most friction
- which standards recommendations are waiting for review

## Proposed OTLP integration

Veritas does not currently ship an OTLP exporter or exporter configuration. An external consumer could export canonical artifact summaries to existing observability infrastructure; that consumer and its privacy controls would need separate implementation and verification. The dimensions below are design guidance, not supported CLI options.

Do not use OTLP as the first or only source of truth. Keep rich detail in repo-local generated evidence.

## Recommended Dimensions

Safe dimensions are small and bounded:

- command name
- result status
- source kind
- current artifact class
- stable requirement IDs when bounded

Avoid high-cardinality labels:

- file paths
- free-text notes
- missed-issue text
- reviewer comments
- repo-specific arbitrary strings

## Product Guidance

Veritas should stay artifact-first:

1. generated evidence
2. readiness and conformance summaries
3. standards feedback
4. optional telemetry export
5. optional console
