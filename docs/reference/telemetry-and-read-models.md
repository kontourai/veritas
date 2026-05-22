# Telemetry and Read Models

This page describes how Veritas output should be interpreted over time without turning the product into a heavy observability platform.

## Canonical Records

The canonical Veritas records are repo-local generated evidence and feedback artifacts:

- `.veritas/evidence/<run-id>.json`
- `.veritas/eval-drafts/<run-id>.json`
- `.veritas/evals/<run-id>.json`

These artifacts support **Standards Feedback**.

## Derived Summaries

Some outputs are read models rather than source-of-truth records.

Current examples:

- `.veritas/checkins/*.json`
- `.veritas/checkins/*.md`
- `.surface/runs/<run-id>.console.json`
- `.surface/runs/latest.json`

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

## Optional OTLP Export

OTLP is optional. Use it for team dashboards, cross-repo aggregation, or trend analysis in existing observability infrastructure.

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
