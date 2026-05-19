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
- `.veritas/attestations/`
- `.veritas/evidence/`
- `AGENTS.md` and `CLAUDE.md` governance blocks

### Evidence and eval capture

- `.veritas/attestations/<id>.attestation.json`
- `.veritas/attestations/HEAD`
- `.veritas/attestations/PENDING`
- `.veritas/evidence/<run-id>.json`
- `.veritas/claims/<claim-id>.input.json`
- `.veritas/surface-dashboard/<run-id>.dashboard.json`
- `.veritas/surface-dashboard/latest.json`
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

### Attestation

Defined by [schemas/veritas-attestation.schema.json](../../schemas/veritas-attestation.schema.json).

Attestations are immutable human approval records for Zone 1 governance hashes:

- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`
- `.veritas/team/default.team-profile.json`

The active pointer lives at `.veritas/attestations/HEAD` as JSON with `currentAttestationId`. New `policy-change` attestations supersede older records by setting `priorAttestationId`; old records stay tracked for auditability.

### Policy Pack

Defined by [schemas/veritas-policy-pack.schema.json](../../schemas/veritas-policy-pack.schema.json).

Rules may include `enforcement: "deny"` or `enforcement: "lint"`. If omitted, `hard-invariant` rules default to deny and all other classifications default to lint. Deny rules are eligible for PreToolUse blocking in supported runtime adapters; lint rules remain shadow-run feedback.

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

Each node may declare:

- `owners`: array of owner ids who control the surface
- `boundary`: `strict` (requires owner approval for changes) or `advisory` (visible but not enforced)
- `crossSurfaceAllow`: optional allowlist of actor ids or patterns allowed to modify strict surfaces

### Policy pack

Defined by [schemas/veritas-policy-pack.schema.json](../../schemas/veritas-policy-pack.schema.json).

A policy pack provides:

- staged rule metadata
- rule classification (via required `kind` discriminator)
- match payloads used by the current evaluator
- per-rule `explain` blocks (`summary`, `mustDo`, `mustNotDo`, `exampleGood`, `exampleBad`, `contextLinks`)
- ownership and rollback metadata

Supported rule kinds:

- `required-artifacts`
- `governance-block`
- `diff-required`
- `forbidden-pattern`
- `required-pattern`
- `header-required`
- `cross-surface-write`

Reference file:

- [policy-packs/work-agent-convergence.policy-pack.json](../../policy-packs/work-agent-convergence.policy-pack.json)

#### Rule Match Examples

`forbidden-pattern`, `required-pattern`, and `header-required` combine file glob selection with content regex checks:

```json
{
  "id": "no-console-log-in-src",
  "kind": "forbidden-pattern",
  "match": {
    "files": ["src/**/*.mjs", "!src/vendor/**"],
    "pattern": "console\\.log"
  }
}
```

`match.files` uses Veritas path matching. `match.pattern` is passed to JavaScript `RegExp`, so regex features belong there, not in the glob list. For example, `@stallion-ai/shared(?!/)` rejects the package root import while allowing subpaths such as `@stallion-ai/shared/contracts`.

`cross-surface-write` has no path payload of its own; it reads changed files, the adapter graph, and an explicit actor. If `--actor` or `VERITAS_ACTOR` is missing, the rule returns an error result and fails closed.

### Evidence record

Defined by [schemas/veritas-evidence.schema.json](../../schemas/veritas-evidence.schema.json).

An evidence artifact records:

- where the diff came from
- which repo surfaces were matched
- which proof commands were selected
- which proof-lane objects were selected, including method and Surface claim mapping
- proof-family results when the adapter declares proof-family manifests
- a generated verification budget that shows required, candidate, advisory, move-to-test, and retiring check families
- optional external tool results from proof lanes, such as Fallow audit JSON (advisory or blocking)
- affected-node details (ownership, boundary type, surface classification)
- file-node details (which graph nodes each changed file belongs to)
- uncovered-path status
- evaluated policy results
- `derivedFrom` chains on proof-family claims, external-tool claims, and verification-budget claims for Surface derivation ceilings
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

Proof lanes may optionally declare an external tool artifact. Veritas reads the artifact after the proof lane has run, records a normalized `external_tool_results` entry, and maps the verdict into `surface.input`.

```json
{
  "id": "fallow-advisory",
  "command": "npm run veritas:fallow:advisory",
  "method": "auditability",
  "summary": "Runs Fallow audit as advisory codebase-intelligence evidence.",
  "externalTool": {
    "tool": "fallow",
    "format": "fallow-audit-json",
    "blocking": false,
    "artifactPath": ".veritas/external/fallow-audit.json"
  }
}
```

External tool artifacts must stay under `.veritas/`. Use advisory mode for existing repos until findings are cleaned up or baselined.

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

`veritas run --check budget` is the shortest way to inspect the generated `verification_budget` without opening the full report artifact.

#### Surface TrustInput and report blocks

Every new evidence artifact also includes a `surface.input` block. That block is the portable Surface `TrustInput` projection of the Veritas run, not a generated Surface `TrustReport`.

Veritas owns the repo-specific producer fields. Surface owns generated report fields such as `id`, `generatedAt`, `summary`, `faultLines`, and `proofRequirementsByClaimId`. Those report-only fields must not appear under `surface.input`.

When the attestation gate runs, the evidence record includes `governance_state`. This is the additive compatibility point for policy-pack, adapter, team-profile, and human-attestation state. The raw adapter object remains Veritas-local producer metadata; `governance_state` is mapped because it describes evaluated artifact integrity, adapter applicability, attestation currency, and drift.

After validation, Veritas calls Surface's public `buildTrustReport` API and persists a compact `surface.report` summary beside the input. The report summary includes per-claim derived status, summary counts, and fault lines. `shadow run` prints WARN feedback for Surface-derived `stale` and `disputed` claims, and `veritas explain <rule>` includes the latest Surface status and fault lines for that rule when an evidence record is available.

| Evidence field | Surface mapping | Classification |
| --- | --- | --- |
| `run_id`, `timestamp`, `source_ref`, `source_kind`, `source_scope` | Surface input source, claim/evidence/event timestamps, integrity refs, and evidence metadata | Surface-mapped |
| `resolved_phase`, `resolved_workstream`, `matched_artifacts`, `affected_lanes`, `files`, `unresolved_files` | Claim and evidence metadata that explains why Veritas selected the surface | Surface-mapped |
| `affected_nodes` | `Claim`, `Evidence`, and `VerificationEvent` records on `veritas.affected-surface` | Surface-mapped |
| `affected_node_details`, `file_nodes` | Surface ownership and boundary metadata for matched files | Surface-mapped |
| `selected_proof_commands`, `selected_proof_lanes`, `proof_resolution_source` | `Claim`, `Evidence`, `VerificationPolicy`, and `VerificationEvent` records on `veritas.proof-lanes` | Surface-mapped |
| `uncovered_path_result`, `baseline_ci_fast_passed` | Proof-lane claim status, verification events, and metadata for proof confidence | Surface-mapped |
| `proof_family_results` | `Claim`, `Evidence`, `VerificationEvent`, and metadata records on `veritas.proof-families` | Surface-mapped |
| `verification_budget` | A budget claim/evidence pair plus metadata used by Surface report generation | Surface-mapped |
| `external_tool_results` | External tool verdict claims, evidence, events, and metadata for advisory/blocking proof lanes | Surface-mapped |
| `policy_pack`, `policy_results` | Policy-result claims, evidence, events, and policy-violation fault-line hints | Surface-mapped |
| `governance_state` | Governance artifact and attestation-currency claims, evidence, and events | Surface-mapped |
| `recommendations`, `false_positive_review`, `promotion_candidate`, `override_or_bypass`, `owner`, `promotion_allowed` | Surface metadata and confidence context | Surface-mapped |
| `framework`, `adapter`, `framework_version` | Veritas-local producer/runtime metadata | Veritas-local |
| `surface` | Embedded Surface projection and generated compact report summary | Surface-mapped |
| `surface.input` | Embedded Surface `TrustInput` projection consumed by Surface adapters and tests | Surface-mapped |
| `surface.report` | Compact Surface `TrustReport` summary generated from `surface.input` | Surface-generated |

The schema enforces this boundary with `x_surface_mapping` metadata on top-level evidence properties. Allowed classifications are `mapped`, `veritas-local`, `transitional`, and `deprecated`. Fields marked `mapped` must also declare `x_surface_targets`, such as `claim`, `evidence`, `policy`, `event`, `metadata`, or `report-input`.

#### Per-Claim Surface Input Slices

When `surface.input` is present, Veritas also writes one local slice per claim under `.veritas/claims/*.input.json`. These files are derived and gitignored. They are intentionally not Surface `TrustReport` files.

Each slice has this shape:

```json
{
  "schemaVersion": 2,
  "source": "veritas:<run-id>",
  "generatedAt": "2026-05-09T00:00:00.000Z",
  "claim": {},
  "evidence": [],
  "events": [],
  "policy": {}
}
```

The `evidence` and `events` arrays are filtered to the single `claim.id`, and `policy` is the matching `verificationPolicyId` policy or `null`. Use these files for local inspection, per-claim validation, and focused debugging. Use Surface itself to generate full `TrustReport` artifacts.

#### Surface Dashboard Read Model

When `surface.input` and `surface.report` are present, Veritas writes `.veritas/surface-dashboard/<run-id>.dashboard.json` plus `.veritas/surface-dashboard/latest.json`. These files are derived and gitignored. They are the Veritas-side integration contract for the Surface dashboard and analytics layer.

The read model has `kind: "surface-dashboard-read-model"` and `contract: "surface.analytics-compatible"`. It includes:

- `producer`: Veritas run id, source ref, evidence artifact path, and per-claim input slice paths
- `summary`: claim/evidence/policy/event/fault-line counts and dashboard aggregates by status, claim type, surface, domain, policy, evidence type, method, reviewer authority, impact level, and fault-line type
- `analytics`: a Surface-compatible analytics projection shaped like Surface's `buildTrustAnalyticsProjection(report)` output, including coverage, stale/disputed queues, proof gaps, action queues, and attestation validity
- `claims`: one dashboard row per Surface claim with derived status from `surface.report`, provenance ids, confidence fields, fault-line ids, evidence methods, and metadata
- `policies`: policy summaries with claim counts, status counts, required evidence/methods, review authority, and fault-line counts
- `graph`: normalized nodes and edges for subjects, claims, policies, evidence, events, derived-from links, and fault lines

The dashboard read model is intentionally derived from portable Surface input/report data. It may include Veritas producer metadata, but Surface dashboards should not need to import Veritas rules, policy-pack mechanics, repo adapters, or proof-lane routing logic.

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
- [schemas/veritas-proposal.schema.json](../../schemas/veritas-proposal.schema.json)

The draft captures prefilled context without inventing missing judgment. The record captures the completed operator judgment.
Proposal artifacts capture eval-derived rule and surface-node recommendations awaiting human review.

Policy results may include optional machine-readable `actions`. These actions are remediation hints for agents and reviewers. They are not auto-fixes unless a future tool explicitly implements them.

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
- external tool fixture: [examples/evidence/fallow-advisory.json](../../examples/evidence/fallow-advisory.json)
- eval fixtures: [examples/evals/work-agent-team-profile.json](../../examples/evals/work-agent-team-profile.json), [examples/evals/work-agent-shadow-eval-draft.json](../../examples/evals/work-agent-shadow-eval-draft.json), [examples/evals/work-agent-shadow-eval.json](../../examples/evals/work-agent-shadow-eval.json)
- benchmark fixtures: [examples/benchmarks/migration-marker-scenario.json](../../examples/benchmarks/migration-marker-scenario.json), [examples/benchmarks/migration-marker-without-veritas.json](../../examples/benchmarks/migration-marker-without-veritas.json), [examples/benchmarks/migration-marker-with-veritas.json](../../examples/benchmarks/migration-marker-with-veritas.json), [examples/benchmarks/migration-marker-comparison.json](../../examples/benchmarks/migration-marker-comparison.json)
- suite fixtures: [examples/benchmarks/marker-suite.json](../../examples/benchmarks/marker-suite.json), [examples/benchmarks/marker-suite-report.json](../../examples/benchmarks/marker-suite-report.json)
- classification fixture: [examples/classification/work-agent-convergence-rule-families.json](../../examples/classification/work-agent-convergence-rule-families.json)
