# Example Fixtures

The files in `examples/` are canonical fixtures for the framework surface that this repo currently ships.

They are not decorative samples. They are read by tests in [tests/framework.test.mjs](../../tests/framework.test.mjs) so the docs can point at them without drifting.

## Evidence Fixtures

These live under `examples/evidence/` and demonstrate the current evidence schema in realistic states.

### Pass example

- [examples/evidence/work-agent-pass.json](../../examples/evidence/work-agent-pass.json)

Use it to see a clean branch-diff run:

- matched nodes and lanes
- selected proof commands
- clear uncovered-path result
- positive baseline proof outcome

### Fail example

- [examples/evidence/work-agent-fail.json](../../examples/evidence/work-agent-fail.json)

Use it to see:

- unmatched files
- a `warn` uncovered-path result
- a failed baseline proof outcome
- promotion suppression through `multi-workstream`

### Policy-gap example

- [examples/evidence/work-agent-policy-gap.json](../../examples/evidence/work-agent-policy-gap.json)

Use it to see a case where the change stayed inside known lanes, but the framework still records a recommendation that the policy surface has a gap.

## Eval Fixtures

These live under `examples/evals/` and show how evidence turns into team-scored outcomes.

### Team profile

- [examples/evals/work-agent-team-profile.json](../../examples/evals/work-agent-team-profile.json)

Use it to understand the current team-profile shape:

- rollout mode
- reviewer confidence scale
- promotion preferences

### Eval draft

- [examples/evals/work-agent-shadow-eval-draft.json](../../examples/evals/work-agent-shadow-eval-draft.json)

Use it to see:

- repo-local evidence provenance
- prefilled measurements
- missing confirmation fields

### Eval record

- [examples/evals/work-agent-shadow-eval.json](../../examples/evals/work-agent-shadow-eval.json)

Use it to see the completed live-eval shape:

- accepted or rejected outcome
- reviewer confidence
- measured time to green
- false-positive and missed-issue arrays
- operator notes

## Classification Fixture

- [examples/classification/work-agent-convergence-rule-families.json](../../examples/classification/work-agent-convergence-rule-families.json)

This file groups a real repo's current convergence checks into rule families. It is useful when you want to move from bespoke enforcement scripts toward a clearer policy-pack vocabulary.

## Check-in Examples

These live under `examples/checkins/` and show Veritas used on the Veritas repo itself.

- [examples/checkins/README.md](../../examples/checkins/README.md)
- [examples/checkins/veritas-repo-report.json](../../examples/checkins/veritas-repo-report.json)
- [examples/checkins/veritas-repo-report.md](../../examples/checkins/veritas-repo-report.md)
- [examples/checkins/veritas-repo-eval-draft.json](../../examples/checkins/veritas-repo-eval-draft.json)
- [examples/checkins/veritas-repo-eval.json](../../examples/checkins/veritas-repo-eval.json)
- [examples/checkins/veritas-repo-checkin-red.json](../../examples/checkins/veritas-repo-checkin-red.json)
- [examples/checkins/veritas-repo-checkin-red.md](../../examples/checkins/veritas-repo-checkin-red.md)

Use these to inspect:

- a repo-local adapter classifying this repo without unresolved files
- a repo-local policy pack producing concrete `policy_results`
- a draft-first eval flow on a real self-hosted example
- the exact shape of a red-health automated check-in when check-in automation detects a regression

## How To Use These Fixtures

Use the fixtures in four ways:

1. Read them while designing adapters, policy packs, or downstream tooling.
2. Compare your generated artifacts to them when the shapes seem unclear.
3. Use them as stable examples in docs and demos.
4. Keep them current whenever the schema or operator surface changes.

For the contract behind these files, see [Artifacts and Schemas](artifacts-and-schemas.md).
