# Telemetry and Read Models

This page describes how Veritas should be interpreted over time without turning the framework into a heavy observability product.

## Canonical Records

The canonical Veritas records are repo-local artifacts:

- `.veritas/evidence/<run-id>.json`
- `.veritas/eval-drafts/<run-id>.json`
- `.veritas/evals/<run-id>.json`

These are the durable, reviewable records that define what happened and how a run was judged.

## Derived Summaries

Some Veritas outputs are derived summaries rather than canonical truth.

Current example:

- `.veritas/checkins/*.json`
- `.veritas/checkins/*.md`

`checkin` is useful as a compact operator-facing summary, but it is derived from canonical report/eval inputs and should be treated as a read-model layer, not a peer source of truth.

## Human-Facing Read Model

The intended path for human interpretation is:

1. canonical artifacts first
2. derived summaries second
3. dashboards later, if needed

This keeps Veritas lightweight while still supporting trend analysis and operator insight.

Questions a read-model layer should answer:

- which rules are noisy over time
- which misses repeat
- whether reviewer confidence is improving
- where time-to-green is drifting
- which proof lanes produce the most friction

## Optional OTLP Export

OTLP is an optional export surface, not the canonical model.

Use OTLP when you want:

- team dashboards
- cross-repo aggregation
- trend analysis in existing observability infrastructure

Do not use OTLP as the first or only source of truth.

## Recommended OTLP Shape

Veritas should emit one telemetry unit per command invocation, not one synthetic trace for the entire human review lifecycle.

Good command-level units:

- `veritas.report`
- `veritas.shadow_run`
- `veritas.eval_draft`
- `veritas.eval_record`
- `veritas.checkin`

Correlate them with stable keys such as:

- `run_id`
- `evidence_digest`
- `command`
- `source_kind`
- `adapter_name`
- `policy_pack_name`

## Cardinality Rules

Safe telemetry dimensions are small and bounded:

- command name
- result status
- source kind
- adapter name
- policy pack name
- stable rule IDs when bounded

Do not export:

- file paths
- free-text notes
- missed-issue text
- reviewer comments
- repo-specific arbitrary strings

Keep rich detail in artifacts, not telemetry labels.

## Product Guidance

Veritas should stay lightweight by following this order:

1. artifact-first canonical records
2. derived local summaries
3. optional telemetry export
4. optional dashboards

That keeps the framework useful for humans and agents out of the box while preserving room for richer analytics later.
