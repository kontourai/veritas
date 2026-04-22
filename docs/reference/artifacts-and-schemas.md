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
- `tests/` exercises the framework and the shipped CLI surfaces.

## Repo-Local Generated Artifacts

These are the paths the framework writes into a target repo.

### Starter kit from `init`

- `.veritas/README.md`
- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`
- `.veritas/team/default.team-profile.json`
- `.veritas/evidence/`

### Evidence and eval capture

- `.veritas/evidence/<run-id>.json`
- `.veritas/eval-drafts/<run-id>.json`
- `.veritas/evals/<run-id>.json`

### Suggested wiring from `apply`

- `.veritas/snippets/ci-snippet.yml`
- `.githooks/post-commit`
- `.veritas/hooks/agent-runtime.sh`
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

## Reference Artifact Types

### Adapter

Defined by [schemas/veritas-adapter.schema.json](../../schemas/veritas-adapter.schema.json).

An adapter owns:

- graph nodes and path mapping
- default and rule-based workstream resolution
- proof-lane routing
- uncovered-path policy
- report transport

Reference files:

- [adapters/work-agent.adapter.json](../../adapters/work-agent.adapter.json)
- [adapters/demo-docs-site.adapter.json](../../adapters/demo-docs-site.adapter.json)

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
- uncovered-path status
- evaluated policy results
- adapter metadata
- policy-pack provenance

The framework currently distinguishes three evidence source kinds:

- `explicit-files`
- `branch-diff`
- `working-tree`

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

## How The Pieces Fit

The framework flow in this repo is:

1. `init` writes a starter adapter, policy pack, team profile, and local README.
2. `report` resolves files through the adapter and writes an evidence artifact.
3. `eval draft` turns that evidence into a repo-local draft artifact.
4. `eval record` turns the evidence or draft into a completed live-eval record.
5. `shadow run` orchestrates the report plus eval path and can also run proof first.

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
- classification fixture: [examples/classification/work-agent-convergence-rule-families.json](../../examples/classification/work-agent-convergence-rule-families.json)
