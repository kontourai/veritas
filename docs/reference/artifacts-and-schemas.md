# Artifacts and Schemas

This page ties current files and schemas to the Veritas product model.

Some schema and path names predate the current product vocabulary. This reference keeps exact current file and field names where accuracy requires them. Planned renames are tracked in [Migration Guide](../MIGRATING.md).

If you want command syntax, use [CLI Reference](cli.md). If you want sample payloads, use [Example Fixtures](examples.md).

## Repo Areas

- `bin/` contains the public CLI entrypoints.
- `src/index.mjs` contains implementation logic and exported helpers.
- `schemas/` contains the JSON schema contracts.
- `adapters/` contains current reference Repo Map examples.
- `repo-standards/` contains current reference Repo Standards examples.
- `examples/` contains canonical example artifacts.
- `examples/benchmarks/` contains canonical marker-benchmark scenarios, transcripts, and scored comparisons.
- `tests/` exercises the framework and the shipped CLI surfaces.

## Repo-Local Generated Artifacts

These are the paths the current CLI writes into a target repo.

### Starter kit from `init`

- `.veritas/README.md`
- `.veritas/repo.adapter.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/team/default.team-profile.json`
- `.veritas/attestations/`
- `.veritas/evidence/`
- `AGENTS.md` and `CLAUDE.md` governance blocks

### Evidence and standards feedback capture

- `.veritas/attestations/<id>.attestation.json`
- `.veritas/attestations/HEAD`
- `.veritas/attestations/PENDING`
- `.veritas/evidence/<run-id>.json`
- `.veritas/claims/<claim-id>.input.json`
- `.surface/runs/<run-id>.console.json`
- `.surface/runs/latest.json`
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
- standards feedback drafts under `.veritas/eval-drafts/`
- standards feedback records under `.veritas/evals/`

Derived read-model artifacts may exist on top of those records. Current example:

- operational summaries under `.veritas/checkins/`

Derived artifacts are useful summaries, but they should not become second sources of truth.

Recent governance additions follow that split:

- standards feedback artifacts now carry a derived `governance` object so governance-touching review outcomes can be measured alongside the core outcome fields
- operational summaries carry both the per-run `governance_surface` classification and a derived `governance_trend` summary from local history

## Reference Artifact Types

### Repo Map Schema

Defined by [schemas/veritas-adapter.schema.json](../../schemas/veritas-adapter.schema.json).

The current schema owns:

- graph nodes and path mapping
- default and rule-based workstream resolution
- explicit evidence-check objects and routing by check id
- uncovered-path policy
- report transport
- activation targets for AI instruction files

Reference files:

- [adapters/work-agent.adapter.json](../../adapters/work-agent.adapter.json)
- [adapters/demo-docs-site.adapter.json](../../adapters/demo-docs-site.adapter.json)

Important distinction:

- files under `adapters/` are reference examples for other repo shapes
- the `veritas` repo dogfoods through its tracked repo-local map at `.veritas/repo.adapter.json`

### Attestation

Defined by [schemas/veritas-attestation.schema.json](../../schemas/veritas-attestation.schema.json).

Attestations are immutable authority-backed records for protected standards hashes:

- `.veritas/repo.adapter.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/team/default.team-profile.json`

The active pointer lives at `.veritas/attestations/HEAD` as JSON with `currentAttestationId`. New `policy-change` attestations supersede older records by setting `priorAttestationId`; old records stay tracked for auditability.

### Repo Standards Schema

Defined by [schemas/veritas-repo-standards.schema.json](../../schemas/veritas-repo-standards.schema.json).

Requirements may include `enforcement: "deny"` or `enforcement: "lint"` in the current schema. If omitted, `hard-invariant` requirements default to deny and all other classifications default to lint. Deny requirements are eligible for PreToolUse blocking in supported runtime integrations; lint requirements remain generated evidence feedback.

### Graph

Defined by [schemas/veritas-graph.schema.json](../../schemas/veritas-graph.schema.json).

The Repo Map graph contract covers:

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

- `owners`: array of owner ids who control the work area
- `boundary`: `strict` (requires owner approval for changes) or `advisory` (visible but not enforced)
- `crossSurfaceAllow`: optional allowlist of actor ids or patterns allowed to modify strict surfaces

### Repo Standards File

Defined by [schemas/veritas-repo-standards.schema.json](../../schemas/veritas-repo-standards.schema.json).

A current Repo Standards file provides:

- staged requirement metadata
- requirement classification (via required `kind` discriminator)
- match payloads used by the current evaluator
- per-requirement `explain` blocks (`summary`, `mustDo`, `mustNotDo`, `exampleGood`, `exampleBad`, `contextLinks`)
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

- [repo-standards/work-agent-convergence.repo-standards.json](../../repo-standards/work-agent-convergence.repo-standards.json)

#### Requirement Match Examples

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

`cross-surface-write` has no path payload of its own; it reads changed files, the Repo Map graph, and an explicit actor. If `--actor` or `VERITAS_ACTOR` is missing, the requirement returns an error result and fails closed.

### Evidence record

Defined by [schemas/veritas-evidence.schema.json](../../schemas/veritas-evidence.schema.json).

An evidence artifact records:

- where the diff came from
- which work areas were matched
- which evidenceCheck commands were selected
- which evidence-check objects were selected, including method and Surface claim mapping
- evidence-check inventory results when the current Repo Map declares inventory manifests
- generated readiness coverage that shows required, candidate, advisory, move-to-test, and retiring check groups
- optional external tool results from evidenceChecks, such as Fallow audit JSON (advisory or blocking)
- affected-node details (ownership, boundary type, work-area classification)
- file-node details (which graph nodes each changed file belongs to)
- uncovered-path status
- evaluated policy results
- `derivedFrom` chains on inventory claims, external-tool claims, and readiness-coverage claims for Surface derivation ceilings
- Repo Map metadata
- Repo Standards provenance

The current implementation distinguishes three evidence source kinds:

- `explicit-files`
- `branch-diff`
- `working-tree`

#### Repo Map Evidence Check Configuration

Current Repo Map files use explicit check objects. `runner` defaults to `bash`; bash checks require `command`.

```json
{
  "evidence": {
	    "evidenceChecks": [
	      {
	        "id": "required-evidence-check",
	        "command": "npm run verify",
        "method": "validation",
        "summary": "Runs the repository verification suite."
      }
    ],
    "requiredEvidenceCheckIds": ["required-evidence-check"],
    "defaultEvidenceCheckIds": ["required-evidence-check"],
    "evidenceCheckRoutes": [
      {
        "componentIds": ["verification.tests"],
        "evidenceCheckIds": ["required-evidence-check"]
      }
    ]
  }
}
```

MCP checks use `runner: "mcp"` with a stdio server definition, tool name, and optional JSON input. Current routing still refers to `evidenceChecks[].id`, so bash and MCP checks can be mixed in `requiredEvidenceCheckIds`, `defaultEvidenceCheckIds`, and `evidenceCheckRoutes`.

```json
{
  "id": "dep-scan",
  "runner": "mcp",
  "server": { "command": "npx", "args": ["-y", "@acme/dep-scanner"] },
  "tool": "scan",
  "input": { "depth": 2 },
  "method": "auditability"
}
```

Removed command array fields such as `requiredEvidenceCheckCommands`, `defaultEvidenceCheckCommands`, and `surfaceEvidenceCheckCommands` are intentionally rejected by runtime validation. Migrate by assigning each check a stable `evidenceChecks[].id`, moving bash commands into `evidenceChecks[].command`, and replacing route command arrays with `evidenceCheckIds`.

Evidence Checks may optionally declare an external tool artifact. Veritas reads the artifact after the check has run, records a normalized `external_tool_results` entry, and maps the verdict into `surface.input`.

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

Selected check records include `runner`, `label`, and an optional `evidence_check_result`. Bash results carry `exitCode`, `signal`, `stdout`, and `stderr`; MCP results carry `content` and `isError`. Both runners include `id`, `passed`, and `durationMs`.

Repo Maps can also declare grouped evidence-check inventories:

```json
{
  "evidence": {
    "evidenceInventoryManifests": [
      ".veritas/evidence-inventories/repo-guardrails.inventory.json"
    ]
  }
}
```

Those manifests are repo-local inventories. Veritas reports their portable summary as `evidence_inventory_results` and `readiness_coverage` in the evidence artifact.

The portable manifest contract is documented in [veritas-evidence-inventory-manifest.schema.json](../../schemas/veritas-evidence-inventory-manifest.schema.json). Runtime validation adds usefulness rules that JSON Schema alone cannot express:

- required inventory items need an owner,
- required inventory items need a review trigger,
- required inventory items cannot use unknown catch evidence,
- every inventory item needs an evidenceCheck id, either directly or through the manifest `sourceEvidenceCheckId`.

Evidence-check inventory results include freshness fields:

- `last_reviewed`
- `evidence_basis`
- `freshness_status`

`veritas readiness --check coverage` is the shortest current command to inspect readiness coverage without opening the full report artifact.

#### Surface TrustInput and report blocks

Every new evidence artifact also includes a `surface.input` block. That block is the portable Surface `TrustInput` projection of the Veritas readiness check, not a generated Surface `TrustReport`.

Veritas owns the repo-specific producer fields. Surface owns generated report fields such as `id`, `generatedAt`, `summary`, `transparencyGaps`, and `evidenceRequirementsByClaimId`. Those report-only fields must not appear under `surface.input`.

When the attestation gate runs, the evidence record includes `governance_state`. This maps protected-standards integrity, Repo Map applicability, authority currency, and freshness into Surface-format state. The raw Repo Map object remains Veritas-local producer metadata.

Readiness verdicts are exposed through a Surface claim with `claimType: "software-readiness-verdict"` on `surface: "veritas.readiness"` and `subjectType: "repository-change"`. The claim and its evidence include `metadata.integrity` with `sourceRef`, `sourceKind`, `sourceScope`, changed file refs, and protected config refs. When the installed Surface package supports first-class `authorityTrace`, the artifact includes top-level `surface.input.authorityTrace`; Veritas also mirrors the same authority context in claim/evidence `metadata.authorityTrace` for older Surface 0.4 consumers. Readiness events carry authority by linking to the authority-traced evidence ids.

After validation, Veritas calls Surface's public `buildTrustReport` API and persists a compact `surface.report` summary beside the input. The report summary includes per-claim derived status, summary counts, and transparency gaps. `veritas readiness` prints WARN feedback for Surface-derived `stale` and `disputed` claims, and `veritas explain <rule>` includes the latest Surface status and gaps for that rule when an evidence record is available.

| Evidence field | Surface mapping | Classification |
| --- | --- | --- |
| `run_id`, `timestamp`, `source_ref`, `source_kind`, `source_scope` | Surface input source, claim/evidence/event timestamps, integrity refs, and evidence metadata | Surface-mapped |
| `integrity` | Source anchor, file fingerprints, and producer configuration hashes attached to claims/evidence so verified status can be traced to concrete inputs | Surface-mapped |
| `resolved_phase`, `resolved_workstream`, `matched_artifacts`, `triggered_evidence_checks`, `files`, `unresolved_files` | Claim and evidence metadata that explains why Veritas selected the surface | Surface-mapped |
| `components` | `Claim`, `Evidence`, and `VerificationEvent` records on `veritas.affected-surface` | Surface-mapped |
| `component_details`, `file_nodes` | Surface ownership and boundary metadata for matched files | Surface-mapped |
| `selected_evidence_check_ids`, `selected_evidence_check_labels`, `selected_evidence_checks`, `evidence_check_resolution_source` | `Claim`, `Evidence`, `VerificationPolicy`, and `VerificationEvent` records on `veritas.evidence-checks` | Surface-mapped |
| `uncovered_path_result`, `baseline_ci_fast_passed` | Evidence Check claim status, verification events, and metadata for evidenceCheck confidence | Surface-mapped |
| `evidence_inventory_results` | `Claim`, `Evidence`, `VerificationEvent`, and metadata records on `veritas.evidence-inventories` | Surface-mapped |
| `readiness_coverage` | A readiness coverage claim/evidence pair plus metadata used by Surface report generation | Surface-mapped |
| readiness verdict projection | A `software-readiness-verdict` claim, evidence, and event with integrity scope and authority trace metadata | Surface-mapped |
| `external_tool_results` | External tool verdict claims, evidence, events, and metadata for advisory/blocking evidenceChecks | Surface-mapped |
| `repo_standards`, `policy_results` | Policy-result claims, evidence, events, and policy-violation transparency gap hints | Surface-mapped |
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

#### Surface Console Read Model

When `surface.input` and `surface.report` are present, Veritas writes `.surface/runs/<run-id>.console.json` plus `.surface/runs/latest.json`. These files are derived and gitignored. They are the Veritas-side integration contract for the Surface Console and analytics layer.

The read model has `kind: "surface-console-read-model"` and `contract: "surface.analytics-compatible"`. Those are current implementation values. It includes:

- `producer`: Veritas readiness check id, source ref, evidence artifact path, and per-claim input slice paths
- `summary`: claim/evidence/policy/event/gap counts and Console aggregates by status, claim type, producer namespace, domain, policy, evidence type, method, reviewer authority, impact level, and gap type
- `analytics`: a Surface-format analytics projection shaped like Surface's `buildTrustAnalyticsProjection(report)` output, including coverage, stale/disputed queues, requirement gaps, action queues, and attestation validity
- `evalSummary`: populated by `veritas eval record`; carries the generic Surface `EvalSummary` shape (`reviewed`, `outcome`, `confidence`, `falsePositiveCount`, `missedIssueCount`, `timeToResolutionMinutes`, `notes`, `metadata`). `null` until an eval record is written for the run.
- `claims`: one Console row per Surface claim with derived status from `surface.report`, provenance ids, confidence fields, gap ids, evidence methods, and metadata
- `policies`: policy summaries with claim counts, status counts, required evidence/methods, review authority, and gap counts
- `graph`: normalized nodes and edges for subjects, claims, policies, evidence, events, derived-from links, and transparency gaps

The Surface Console read model is intentionally derived from portable Surface input/report data. It may include Veritas producer metadata, but Surface Console code should not need to import Veritas requirement evaluation, Repo Standards mechanics, Repo Maps, or evidence-check routing logic.

### Repo Standards Settings Schema

Defined by [schemas/veritas-team-profile.schema.json](../../schemas/veritas-team-profile.schema.json).

The current file controls settings that belong to Repo Standards:

- default rollout mode
- default stage for new requirements
- reviewer confidence scale
- signoff expectations
- evidence requirements before a requirement becomes mandatory

### Standards feedback draft and record

Defined by:

- [schemas/veritas-eval-draft.schema.json](../../schemas/veritas-eval-draft.schema.json)
- [schemas/veritas-eval-record.schema.json](../../schemas/veritas-eval-record.schema.json)
- [schemas/veritas-recommendation.schema.json](../../schemas/veritas-recommendation.schema.json)

The draft captures prefilled context without inventing missing judgment. The record captures the completed operator judgment. Recommendation artifacts capture feedback-derived requirement and work-area recommendations awaiting review.

Requirement results may include optional machine-readable `actions`. These actions are remediation hints for agents and reviewers. They are not auto-fixes unless a future tool explicitly implements them.

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

These artifacts support broader benchmark evidenceCheck:

- the suite artifact groups multiple marker scenarios and trial pairs
- the suite report summarizes rates, latency, `pass_at_1`, `pass_at_k`, and `pass_pow_k`
- benchmark groups can contain repeated trials so reliability is measured beyond one pair

## How The Pieces Fit

The current implementation flow in this repo is:

1. `init` writes starter Repo Map, Repo Standards, settings, and local README artifacts.
2. `report` resolves files through the Repo Map and writes an evidence artifact.
3. `eval draft` turns that evidence into a repo-local standards-feedback draft artifact.
4. `eval record` turns the evidence or draft into a completed standards-feedback record.
5. `readiness` orchestrates the report plus feedback path and can also run evidence checks first.

The starter guidance surface also includes `.veritas/GOVERNANCE.md`, which is a committed governance artifact rather than a disposable generated output.

## Current Safety Rails

The shipped code currently enforces these boundaries:

- evidence input for standards feedback must come from `.veritas/evidence/`
- draft input for eval completion must come from `.veritas/eval-drafts/`
- standards feedback output must stay under `.veritas/evals/`
- CI snippets, runtime hooks, and Codex hook artifacts are constrained to their reviewable subdirectories
- git-hook generation is constrained to `.githooks/`
- Codex hook merging accepts either `--target-hooks-file` or `--codex-home`, never both

## Current Reference Files In This Repo

Use these when you want concrete, current examples instead of abstract schema descriptions:

- Repo Map examples: [adapters/work-agent.adapter.json](../../adapters/work-agent.adapter.json), [adapters/demo-docs-site.adapter.json](../../adapters/demo-docs-site.adapter.json)
- Repo Standards example: [repo-standards/work-agent-convergence.repo-standards.json](../../repo-standards/work-agent-convergence.repo-standards.json)
- evidence fixtures: [examples/evidence/work-agent-pass.json](../../examples/evidence/work-agent-pass.json), [examples/evidence/work-agent-fail.json](../../examples/evidence/work-agent-fail.json), [examples/evidence/work-agent-policy-gap.json](../../examples/evidence/work-agent-policy-gap.json)
- external tool fixture: [examples/evidence/fallow-advisory.json](../../examples/evidence/fallow-advisory.json)
- standards-feedback fixtures: [examples/evals/work-agent-team-profile.json](../../examples/evals/work-agent-team-profile.json), [examples/evals/work-agent-observe-eval-draft.json](../../examples/evals/work-agent-observe-eval-draft.json), [examples/evals/work-agent-observe-eval.json](../../examples/evals/work-agent-observe-eval.json)
- benchmark fixtures: [examples/benchmarks/migration-marker-scenario.json](../../examples/benchmarks/migration-marker-scenario.json), [examples/benchmarks/migration-marker-without-veritas.json](../../examples/benchmarks/migration-marker-without-veritas.json), [examples/benchmarks/migration-marker-with-veritas.json](../../examples/benchmarks/migration-marker-with-veritas.json), [examples/benchmarks/migration-marker-comparison.json](../../examples/benchmarks/migration-marker-comparison.json)
- suite fixtures: [examples/benchmarks/marker-suite.json](../../examples/benchmarks/marker-suite.json), [examples/benchmarks/marker-suite-report.json](../../examples/benchmarks/marker-suite-report.json)
- classification fixture: [examples/classification/work-agent-convergence-rule-groups.json](../../examples/classification/work-agent-convergence-rule-groups.json)
