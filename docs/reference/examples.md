# Example Fixtures

The files in `examples/` are canonical fixtures for the current schemas. They are read by tests, so docs can point at them without drifting.

Some example paths and fields predate the current product vocabulary. Treat them as exact fixture references, not naming guidance.

## Evidence Fixtures

These live under `examples/evidence/` and demonstrate generated evidence in realistic states.

### Pass example

- [examples/evidence/work-agent-pass.json](../../examples/evidence/work-agent-pass.json)

Use it to see a clean branch-diff run:

- matched work areas
- selected evidenceChecks
- uncovered-path result
- baseline evidence outcome

### Fail example

- [examples/evidence/work-agent-fail.json](../../examples/evidence/work-agent-fail.json)

Use it to see:

- unmatched files
- warning-level uncovered-path result
- failed baseline evidence outcome
- suppression of stronger enforcement when the change spans multiple work areas

### Requirement-gap example

- [examples/evidence/work-agent-policy-gap.json](../../examples/evidence/work-agent-policy-gap.json)

Use it to see a case where the change stayed inside known work areas, but Veritas still records that the standards are missing coverage.

## Standards Feedback Fixtures

These live under `examples/evals/` and demonstrate standards feedback.

- [examples/evals/work-agent-team-profile.json](../../examples/evals/work-agent-team-profile.json)
- [examples/evals/work-agent-observe-eval-draft.json](../../examples/evals/work-agent-observe-eval-draft.json)
- [examples/evals/work-agent-observe-eval.json](../../examples/evals/work-agent-observe-eval.json)

Use them to inspect:

- current shape for standards strictness settings
- generated evidence provenance
- completed feedback outcomes
- time-to-green and exception/override counts
- false positives and missed issues

## Benchmark Fixtures

These live under `examples/benchmarks/` and show deterministic benchmark fixtures for whether change guidance surfaced at the right time.

Use them to inspect:

- marker phrases
- trigger tags
- assistant-turn timing windows
- baseline vs Veritas comparisons
- grouped reliability metrics

## Operational Summary Fixtures

These examples demonstrate generated readiness, conformance, or standards-feedback summaries.

- [examples/checkins/veritas-repo-report.json](../../examples/checkins/veritas-repo-report.json)
- [examples/checkins/veritas-repo-checkin-red.json](../../examples/checkins/veritas-repo-checkin-red.json)

## Specific Benchmark Fixtures

- [examples/benchmarks/migration-marker-scenario.json](../../examples/benchmarks/migration-marker-scenario.json)
- [examples/benchmarks/migration-marker-comparison.json](../../examples/benchmarks/migration-marker-comparison.json)
- [examples/benchmarks/marker-suite.json](../../examples/benchmarks/marker-suite.json)
- [examples/benchmarks/marker-suite-report.json](../../examples/benchmarks/marker-suite-report.json)
- [examples/benchmarks/governance-protected-standards-marker-scenario.json](../../examples/benchmarks/governance-protected-standards-marker-scenario.json)
- [examples/benchmarks/governance-standards-growth-marker-scenario.json](../../examples/benchmarks/governance-standards-growth-marker-scenario.json)

## Classification Fixture

- [examples/classification/work-agent-convergence-rule-groups.json](../../examples/classification/work-agent-convergence-rule-groups.json)

This file groups a real repo's current checks. It is useful when moving from bespoke scripts toward clearer requirements and evidence-check inventories.
