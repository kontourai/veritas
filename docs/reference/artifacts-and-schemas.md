# Artifacts and Schemas

This page ties the repo layout to the framework contract.

If you want command syntax, use [CLI Reference](cli.md). If you want sample payloads, use [Example Fixtures](examples.md).

## Repo Areas

- `bin/` contains the public CLI entrypoints.
- `src/index.mjs` contains the framework logic and exported helpers.
- `schemas/` contains the JSON schema contracts.
- `adapters/` contains reference repo adapters.
- `policy-packs/` contains reference policy packs.
- `examples/` contains canonical example artifacts.
- `examples/benchmarks/` contains canonical marker-benchmark scenarios, transcripts, and scored comparisons.
- `tests/` exercises the framework and the shipped CLI surfaces.

## Repo-Local Generated Artifacts

These are the paths the framework writes into a target repo.

### Starter kit from `init`

- `.veritas/README.md`
- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`
- `.veritas/team/default.team-profile.json`
- `.veritas/evidence/`
- `AGENTS.md` and `CLAUDE.md` governance blocks

### Evidence and eval capture

- `.veritas/evidence/<run-id>.json`
- `.veritas/eval-drafts/<run-id>.json`
- `.veritas/evals/<run-id>.json`
- `.veritas/evals/history.jsonl`

### Suggested wiring from `apply`

- `.veritas/snippets/ci-snippet.yml`
- `.githooks/post-commit`
- `.veritas/hooks/agent-runtime.sh`
- `.veritas/hooks/stop.sh`
- `.veritas/runtime/codex-hooks.json`

The CLI intentionally refuses to write these artifacts outside their reviewable directories unless the path class itself is allowed.

## Canonical vs Derived

Canonical records:

- evidence/report artifacts under `.veritas/evidence/`
- eval drafts under `.veritas/eval-drafts/`
- eval records under `.veritas/evals/`

Derived read-model artifacts may exist on top of those records. Current example:

- operational check-ins under `.veritas/checkins/`

Derived artifacts are useful summaries, but they should not become second sources of truth.

Recent governance additions follow that split:

- eval draft / eval record artifacts now carry a derived `governance` object so governance-touching review outcomes can be measured alongside the core outcome fields
- operational check-ins carry both the per-run `governance_surface` classification and a derived `governance_trend` summary from local check-in history

## Reference Artifact Types

### Adapter

Defined by [schemas/veritas-adapter.schema.json](../../schemas/veritas-adapter.schema.json).

An adapter owns:

- graph nodes and path mapping
- default and rule-based workstream resolution
- explicit proof-lane objects and routing by lane id
- uncovered-path policy
- report transport
- activation targets for AI instruction files

Reference files:

- [adapters/work-agent.adapter.json](../../adapters/work-agent.adapter.json)
- [adapters/demo-docs-site.adapter.json](../../adapters/demo-docs-site.adapter.json)

Important distinction:

- files under `adapters/` are reference examples for other repo shapes
- the `veritas` repo dogfoods through its tracked repo-local adapter at `.veritas/repo.adapter.json`

### Graph

Defined by [schemas/veritas-graph.schema.json](../../schemas/veritas-graph.schema.json).

The graph contract covers:

- `defaultResolution`
- `nonSliceableInvariants`
- `resolverPrecedence`
- optional `resolutionRules`
- node definitions with `id`, `kind`, `label`, and `patterns`

Supported node kinds currently include:

- `product-surface`
- `shared-contract-surface`
- `verification-surface`
- `governance-surface`
- `tooling-surface`
- `delivery-surface`
- `shared-package`
- `example-surface`

### Policy pack

Defined by [schemas/veritas-policy-pack.schema.json](../../schemas/veritas-policy-pack.schema.json).

A policy pack provides:

- staged rule metadata
- rule classification
- match payloads used by the current evaluator
- ownership and rollback metadata

Reference file:

- [policy-packs/work-agent-convergence.policy-pack.json](../../policy-packs/work-agent-convergence.policy-pack.json)

### Evidence record

Defined by [schemas/veritas-evidence.schema.json](../../schemas/veritas-evidence.schema.json).

An evidence artifact records:

- where the diff came from
- which repo surfaces were matched
- which proof commands were selected
- which proof-lane objects were selected, including method and Surface claim mapping
- proof-family results when the adapter declares proof-family manifests
- a generated verification budget that shows required, candidate, advisory, move-to-test, and retiring check families
- uncovered-path status
- evaluated policy results
- adapter metadata
- policy-pack provenance

The framework currently distinguishes three evidence source kinds:

- `explicit-files`
- `branch-diff`
- `working-tree`

#### Adapter Proof-Lane Migration

Current adapters use explicit proof-lane objects:

```json
{
  "evidence": {
    "proofLanes": [
      {
        "id": "required-proof",
        "command": "npm run verify",
        "method": "validation",
        "summary": "Runs the repository verification suite."
      }
    ],
    "requiredProofLaneIds": ["required-proof"],
    "defaultProofLaneIds": ["required-proof"],
    "surfaceProofRoutes": [
      {
        "nodeIds": ["verification.tests"],
        "proofLaneIds": ["required-proof"]
      }
    ]
  }
}
```

Legacy `requiredProofLanes`, `defaultProofLanes`, and `surfaceProofLanes` command arrays are intentionally rejected by runtime validation. Migrate by assigning each command a stable `proofLanes[].id`, moving the command into `proofLanes[].command`, and replacing route command arrays with `proofLaneIds`.

Adapters can also declare family-level proof inventories:

```json
{
  "evidence": {
    "proofFamilyManifests": [
      ".veritas/proof-families/repo-guardrails.families.json"
    ]
  }
}
```

Those manifests are repo-local inventories. Veritas reports their portable summary as `proof_family_results` and `verification_budget` in the evidence artifact.

The portable manifest contract is documented in [veritas-proof-family-manifest.schema.json](../../schemas/veritas-proof-family-manifest.schema.json). Runtime validation adds usefulness rules that JSON Schema alone cannot express:

- required families need an owner,
- required families need a review trigger,
- required families cannot use unknown catch evidence,
- every family needs a lane id, either directly or through the manifest `sourceProofLaneId`.

Proof-family results include freshness fields:

- `last_reviewed`
- `evidence_basis`
- `freshness_status`

`veritas budget` is the shortest way to inspect the generated `verification_budget` without opening the full report artifact.

### Team profile

Defined by [schemas/veritas-team-profile.schema.json](../../schemas/veritas-team-profile.schema.json).

A team profile controls:

- default rollout mode
- default stage for new rules
- reviewer confidence scale
- signoff expectations
- proof requirements before promotion

### Eval draft and eval record

Defined by:

- [schemas/veritas-eval-draft.schema.json](../../schemas/veritas-eval-draft.schema.json)
- [schemas/veritas-eval-record.schema.json](../../schemas/veritas-eval-record.schema.json)

The draft captures prefilled context without inventing missing judgment. The record captures the completed operator judgment.

### Marker benchmark scenario, transcript, and comparison

Defined by:

- [schemas/veritas-marker-benchmark.schema.json](../../schemas/veritas-marker-benchmark.schema.json)
- [schemas/veritas-marker-transcript.schema.json](../../schemas/veritas-marker-transcript.schema.json)
- [schemas/veritas-marker-score.schema.json](../../schemas/veritas-marker-score.schema.json)

These benchmark artifacts support deterministic scoring for "did the right context surface at the right time" comparisons:

- the scenario defines the required marker phrases and scoring window
- the transcript captures the observed turns for one condition
- the comparison report scores `without Veritas` against `with Veritas`

### Marker benchmark suite and suite report

Defined by:

- [schemas/veritas-marker-suite.schema.json](../../schemas/veritas-marker-suite.schema.json)
- [schemas/veritas-marker-suite-report.schema.json](../../schemas/veritas-marker-suite-report.schema.json)

These artifacts support broader benchmark proof:

- the suite artifact groups multiple marker scenarios and trial pairs
- the suite report summarizes rates, latency, `pass_at_1`, `pass_at_k`, and `pass_pow_k`
- benchmark groups can contain repeated trials so reliability is measured beyond one pair

## How The Pieces Fit

The framework flow in this repo is:

1. `init` writes a starter adapter, policy pack, team profile, and local README.
2. `report` resolves files through the adapter and writes an evidence artifact.
3. `eval draft` turns that evidence into a repo-local draft artifact.
4. `eval record` turns the evidence or draft into a completed live-eval record.
5. `shadow run` orchestrates the report plus eval path and can also run proof first.

The starter guidance surface also includes `.veritas/GOVERNANCE.md`, which is a committed governance artifact rather than a disposable generated output.

## Current Safety Rails

The shipped code currently enforces these boundaries:

- evidence input for evals must come from `.veritas/evidence/`
- draft input for eval completion must come from `.veritas/eval-drafts/`
- eval output must stay under `.veritas/evals/`
- CI snippets, runtime hooks, and Codex hook artifacts are constrained to their reviewable subdirectories
- git-hook generation is constrained to `.githooks/`
- Codex hook merging accepts either `--target-hooks-file` or `--codex-home`, never both

## Current Reference Files In This Repo

Use these when you want concrete, current examples instead of abstract schema descriptions:

- adapters: [adapters/work-agent.adapter.json](../../adapters/work-agent.adapter.json), [adapters/demo-docs-site.adapter.json](../../adapters/demo-docs-site.adapter.json)
- policy pack: [policy-packs/work-agent-convergence.policy-pack.json](../../policy-packs/work-agent-convergence.policy-pack.json)
- evidence fixtures: [examples/evidence/work-agent-pass.json](../../examples/evidence/work-agent-pass.json), [examples/evidence/work-agent-fail.json](../../examples/evidence/work-agent-fail.json), [examples/evidence/work-agent-policy-gap.json](../../examples/evidence/work-agent-policy-gap.json)
- eval fixtures: [examples/evals/work-agent-team-profile.json](../../examples/evals/work-agent-team-profile.json), [examples/evals/work-agent-shadow-eval-draft.json](../../examples/evals/work-agent-shadow-eval-draft.json), [examples/evals/work-agent-shadow-eval.json](../../examples/evals/work-agent-shadow-eval.json)
- benchmark fixtures: [examples/benchmarks/migration-marker-scenario.json](../../examples/benchmarks/migration-marker-scenario.json), [examples/benchmarks/migration-marker-without-veritas.json](../../examples/benchmarks/migration-marker-without-veritas.json), [examples/benchmarks/migration-marker-with-veritas.json](../../examples/benchmarks/migration-marker-with-veritas.json), [examples/benchmarks/migration-marker-comparison.json](../../examples/benchmarks/migration-marker-comparison.json)
- suite fixtures: [examples/benchmarks/marker-suite.json](../../examples/benchmarks/marker-suite.json), [examples/benchmarks/marker-suite-report.json](../../examples/benchmarks/marker-suite-report.json)
- classification fixture: [examples/classification/work-agent-convergence-rule-families.json](../../examples/classification/work-agent-convergence-rule-families.json)
