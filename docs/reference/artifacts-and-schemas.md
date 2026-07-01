# Artifacts and Schemas

This page ties current files and schemas to the Veritas product model.

Some schema and path names predate the current product vocabulary. This reference keeps exact current file and field names where accuracy requires them. Planned renames are tracked in [Migration Guide](../MIGRATING.md).

If you want command syntax, use [CLI Reference](cli.md). If you want sample payloads, use [Examples](examples.md).

## Repo Areas

- `bin/` contains the public CLI entrypoints.
- `src/index.mjs` contains implementation logic and exported helpers.
- `schemas/` contains the JSON schema contracts.
- `repo-maps/` contains current reference Repo Map examples.
- `repo-standards/` contains current reference Repo Standards examples.
- `examples/` contains canonical example artifacts.
- `examples/benchmarks/` contains canonical marker-benchmark scenarios, session logs, and scored comparisons.
- `tests/` exercises the product core and the shipped CLI surfaces.

## Repo-Local Generated Artifacts

These are the paths the current CLI writes into a target repo.

### Starter kit from `init`

- `.veritas/README.md`
- `.veritas/repo-map.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/authority/default.authority-settings.json`
- `.veritas/attestations/`
- `.kontourai/veritas/evidence/`
- `AGENTS.md` and `CLAUDE.md` governance blocks

### Evidence and standards feedback capture

- `.veritas/attestations/<id>.attestation.json`
- `.veritas/attestations/HEAD`
- `.veritas/attestations/PENDING`
- `.kontourai/veritas/evidence/<run-id>.json`
- `.kontourai/veritas/claims/<claim-id>.input.json`
- `.surface/runs/<run-id>.console.json`
- `.surface/runs/latest.json`
- `.kontourai/veritas/standards-feedback-drafts/<run-id>.json`
- `.kontourai/veritas/standards-feedback/<run-id>.json`
- `.kontourai/veritas/standards-feedback/history.jsonl`

### Suggested wiring from `apply`

- `.veritas/snippets/ci-snippet.yml`
- `.githooks/post-commit`
- `.githooks/pre-push`
- `.veritas/hooks/agent-runtime.sh`
- `.veritas/hooks/stop.sh`
- `.veritas/runtime/codex-hooks.json`

The CLI intentionally refuses to write these artifacts outside their reviewable directories unless the path class itself is allowed.

## Canonical vs Derived

Canonical records:

- evidence/report artifacts under `.kontourai/veritas/evidence/`
- standards feedback drafts under `.kontourai/veritas/standards-feedback-drafts/`
- standards feedback records under `.kontourai/veritas/standards-feedback/`

Derived read-model artifacts may exist on top of those records. Current example:

- operational summaries under `.kontourai/veritas/repo-conformance/`

Derived artifacts are useful summaries, but they should not become second sources of truth.

Recent governance additions follow that split:

- standards feedback artifacts now carry a derived `governance` object so governance-touching review outcomes can be measured alongside the core outcome fields
- operational summaries carry both the per-run `governance_surface` classification and a derived `governance_trend` summary from local history

## Reference Artifact Types

### Repo Map Schema

Defined by [schemas/veritas-repo-map.schema.json](../../schemas/veritas-repo-map.schema.json).

The current schema owns:

- graph nodes and path mapping
- default and rule-based workstream resolution
- explicit evidence-check objects and routing by check id
- uncovered-path policy
- report transport
- activation targets for AI instruction files

Reference files:

- [repo-maps/work-agent.repo-map.json](../../repo-maps/work-agent.repo-map.json)
- [repo-maps/demo-docs-site.repo-map.json](../../repo-maps/demo-docs-site.repo-map.json)

Important distinction:

- files under `repo-maps/` are reference examples for other repo shapes
- the `veritas` repo dogfoods through its tracked repo-local map at `.veritas/repo-map.json`

### Attestation

Defined by [schemas/veritas-attestation.schema.json](../../schemas/veritas-attestation.schema.json).

Attestations are immutable authority-backed records for protected standards hashes:

- `.veritas/repo-map.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/authority/default.authority-settings.json`

The active pointer lives at `.veritas/attestations/HEAD` as JSON with `currentAttestationId`. New `policy-change` attestations supersede older records by setting `priorAttestationId`; old records stay tracked for auditability.

New attestation write paths require `metadata.approvalRef`, supplied through `--approval-ref`, to point at the explicit human approval that authorized the record. Existing historical attestations without this field remain readable, but agents must not create new authority-backed attestations without a durable approval reference.

Authority settings may also constrain approval references with `review_preferences.attestation_approval_ref_policy`. Supported modes are `reference-only`, `prefix`, `resolved`, and `resolved-strict`. Prefix policies let a repo require references such as `servicenow:change/CHG12345` or `github:pull-request/123` before an attestation can be recorded. Resolved policies require a resolver-backed approved result before Veritas writes the attestation.

Resolver-backed approval metadata lives under `metadata.approvalResolution`. Veritas records the normalized resolver result so later readers can inspect provider, authority reference, status, approver, approval time, expiry, scope, evidence hash, resolution time, and failure reason. The external approval system remains the source of authority; Veritas records the resolver observation and binds it to the attestation.

Offline approval records live under `.veritas/authority/approval-records/` and are defined by [schemas/veritas-approval-record.schema.json](../../schemas/veritas-approval-record.schema.json). The built-in offline resolver supports `veritas-approval:<id>` refs, which resolve to `<id>.approval.json`, and `file:.veritas/authority/approval-records/<file>` refs for explicit repo-local paths. Resolved policy modes reject missing, rejected, expired, or out-of-scope records before Veritas writes attestation files.

### Repo Standards Schema

Defined by [schemas/veritas-repo-standards.schema.json](../../schemas/veritas-repo-standards.schema.json).

Each Requirement carries a canonical `enforcementLevel` (the Enforcement Level from CONTEXT.md): `"Observe"` records evidence only, `"Guide"` adds just-in-time agent-facing correction without blocking merge readiness, and `"Require"` must be satisfied or accepted by exception. A derived `enforcement` flag (`"deny"` or `"advisory"`) controls only the runtime PreToolUse hard gate: it is not authored, and defaults from classification (`hard-invariant` → `deny`, otherwise `advisory`). Deny requirements are eligible for PreToolUse blocking in supported runtime integrations; advisory requirements remain generated evidence feedback. The content evidence checks (`forbidden-pattern`, `required-pattern`, `header-required`, `vocabulary-consistency`) emit findings as readiness evidence; they are governed Requirements, not a generic-lint surface.

### Graph

Defined by [schemas/veritas-graph.schema.json](../../schemas/veritas-graph.schema.json).

The Repo Map graph contract covers:

- `defaultResolution`
- `nonSliceableInvariants`
- `resolverPrecedence`
- optional `resolutionRules`
- node definitions with `id`, `kind`, `label`, and `patterns`

Supported node kinds currently include:

- `product-area`
- `shared-contract-area`
- `verification-area`
- `protected-area`
- `tooling-area`
- `delivery-area`
- `shared-package`
- `example-area`

Each node may declare:

- `owners`: array of owner ids who control the work area
- `boundary`: `strict` (requires owner approval for changes) or `advisory` (visible but not enforced)
- `boundaryAllow`: optional allowlist of actor ids or patterns allowed to modify strict work areas

### Repo Standards File

Defined by [schemas/veritas-repo-standards.schema.json](../../schemas/veritas-repo-standards.schema.json).

A current Repo Standards file provides:

- Enforcement Level metadata (`Observe`/`Guide`/`Require`)
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
- `vocabulary-consistency`
- `primitive-first-governance`
- `work-area-boundary`

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

`vocabulary-consistency` checks matched files for pre-glossary or ambiguous product terms and reports the preferred Veritas vocabulary:

```json
{
  "id": "canonical-veritas-vocabulary",
  "kind": "vocabulary-consistency",
  "match": {
    "files": ["README.md", "docs/**/*.md", "!docs/reference/**"],
    "terms": [
      {
        "term": "eval",
        "pattern": "\\bevals?\\b",
        "prefer": "Standards Feedback or Standards Recommendation"
      }
    ]
  }
}
```

Each term may provide `term`, `pattern` or `regex`, `flags`, `prefer`, and optional `allowContexts` regexes for local exceptions.

`work-area-boundary` has no path payload of its own; it reads changed files, the Repo Map graph, and an explicit actor. If `--actor` or `VERITAS_ACTOR` is missing, the requirement returns an error result and fails closed.

`primitive-first-governance` documents and evaluates the repo-local pattern that repeatable governance should be represented through Veritas primitives instead of living only in a helper script, local command, or review-memory checklist. Use it when a repo wants Change Guidance and Readiness Report feedback for governance behavior that should be enforceable through Repo Standards Requirements, Repo Map Evidence Checks, Repo Conformance, Generated Evidence, Standards Feedback, Standards Recommendations, or Protected Standards.

The match shape is explicit: each candidate selects files, looks for a JavaScript regular expression, and names at least one Veritas primitive that represents that governance behavior. Package script inventory can also classify quality and governance scripts by name or command pattern, then require each matching script to be routed through a Repo Map Evidence Check, represented by a Repo Standards Requirement, or explicitly exempted as a non-governance helper with rationale.

```json
{
  "id": "repeatable-governance-uses-veritas-primitives",
  "kind": "primitive-first-governance",
  "classification": "promotable-policy",
  "enforcementLevel": "Guide",
  "message": "Repeatable repo governance checks should be represented by Veritas primitives before they become local helper scripts.",
  "match": {
    "candidates": [
      {
        "files": ["package.json"],
        "pattern": "\"veritas:vocab:check\"\\s*:",
        "representedBy": [
          {
            "kind": "evidence-check",
            "id": "vocabulary-consistency"
          }
        ]
      }
    ],
    "packageScripts": {
      "file": "package.json",
      "namePatterns": [
        "^(veritas:vocab:check|quality:check|governance:check)$"
      ],
      "commandPatterns": [
        "(veritas readiness|scripts/check-veritas-vocabulary\\.mjs)"
      ],
      "helperExemptions": [
        {
          "name": "docs:pages:build",
          "rationale": "Docs site build helper; it produces site output and does not decide Requirement satisfaction."
        }
      ]
    }
  }
}
```

`candidates[].files` uses Veritas path matching. `candidates[].pattern` is passed to JavaScript `RegExp` and is tested against each matched file. `candidates[].representedBy` accepts references with `kind: "evidence-check"` and a Repo Map `evidenceChecks[].id`, or `kind: "repo-standards-rule"` and another Repo Standards Requirement `id`. The primitive-first Requirement does not count itself as a satisfying `repo-standards-rule` reference.

`packageScripts.file` points to the package manifest to inspect. `namePatterns[]` and `commandPatterns[]` are JavaScript regular expressions that identify scripts likely to enforce quality or governance. Matching scripts are represented when the current Repo Map has an Evidence Check whose `command` runs `npm run <script-name>`, or when the script is covered by a configured primitive reference. `helperExemptions[]` names scripts that are intentionally not governance primitives; each exemption should include a terse rationale that explains why the command does not decide Requirement satisfaction, merge readiness, Repo Conformance, Protected Standards integrity, authority, evidence freshness, or Change Guidance.

When a candidate pattern is present but none of its `representedBy` references exists in the current Repo Map or Repo Standards file, or when a matching package script is not routed or exempted, the policy result fails or warns according to the Requirement's Enforcement Level. Findings use `kind: "primitive-first-governance"` and include the artifact path, line, matched pattern or script name, and required primitive references. This makes the bypass visible in Generated Evidence and Readiness Reports without promoting the Requirement to Require before Standards Feedback shows the signal is reliable.

This kind is for governance-enforcing behavior, not for every script. Ordinary helper scripts may build docs, run tests, format code, publish packages, or support developer convenience without becoming governance primitives. A script becomes governance-enforcing when it decides whether repo standards, merge readiness, repo conformance, protected standards integrity, authority, evidence freshness, or change guidance are satisfied. Governance-enforcing scripts should be expressed directly as Repo Standards Requirements when possible; when the behavior must run as a command, route it as an Evidence Check adapter behind the Repo Map so Veritas can select it, record evidence, and explain the result.

The canonical copyable adapter example in this repo is `npm run veritas:vocab:check`. It is a package script, but the governance boundary is the Repo Map Evidence Check id `vocabulary-consistency`:

```json
{
  "id": "vocabulary-consistency",
  "command": "npm run veritas:vocab:check",
  "method": "validation",
  "summary": "Checks docs and product copy for canonical Veritas vocabulary."
}
```

When adding a new quality or governance script, choose one of these outcomes deliberately:

- Prefer a direct Repo Standards Requirement when the behavior can be evaluated from repo files and should produce Change Guidance.
- Use a Repo Map Evidence Check when the behavior must run a command; give the check a stable id and route it through the relevant Work Area evidence settings.
- Add an explicit `helperExemptions[]` entry only for non-governance helpers, with rationale.

Generated Evidence paths such as `.kontourai/veritas/evidence/**` and `.kontourai/veritas/repo-conformance/**` are outputs of readiness and conformance runs. They can show whether a Requirement passed, warned, failed, or produced a Standards Recommendation, but they are not governance source and should not be used to replace Repo Map or Repo Standards configuration.

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

Evidence Checks are the adapter boundary for runnable governance behavior. If a script enforces repeatable governance, keep the script small and route it through a Repo Map `evidenceChecks[]` entry with a stable id, method, and summary. For example, this repo routes `npm run veritas:vocab:check` through Evidence Check id `vocabulary-consistency`. Then select that id through `requiredEvidenceCheckIds`, `defaultEvidenceCheckIds`, or `evidenceCheckRoutes` as appropriate for the Work Area. This keeps the result available to Merge Readiness, Repo Conformance, Generated Evidence, Standards Feedback, and Change Guidance.

Do not confuse that with ordinary helper scripts. A command that only builds the docs site, formats files, runs a local convenience workflow, or wraps a test runner is not automatically a governance primitive. It needs Evidence Check routing when it is the thing Veritas relies on to decide whether a Requirement is satisfied, missing, stale, failing, advisory, or accepted by exception.

Evidence Checks may optionally declare an external tool artifact. Veritas reads the artifact after the check has run, records a normalized `external_tool_results` entry, and maps the verdict into `trust.bundle`.

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
    "artifactPath": ".kontourai/veritas/external/fallow-audit.json"
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

#### Surface TrustBundle and report blocks

Every new evidence artifact also includes a `trust.bundle` block. That block is the portable Surface `TrustBundle` projection of the Veritas readiness check, not a generated Surface `TrustReport`.

Veritas owns the repo-specific producer fields. Surface owns generated report fields such as `id`, `generatedAt`, `summary`, `transparencyGaps`, and `evidenceRequirementsByClaimId`. Those report-only fields must not appear under `trust.bundle`.

When the attestation gate runs, the evidence record includes `governance_state`. This maps protected-standards integrity, Repo Map applicability, authority currency, and freshness into Surface-format state. The raw Repo Map object remains Veritas-local producer metadata.

Readiness verdicts are exposed through a Surface claim with `claimType: "software-readiness-verdict"` on `surface: "veritas.readiness"` and `subjectType: "repository-change"`. The claim and its evidence include `metadata.integrity` with `sourceRef`, `sourceKind`, `sourceScope`, changed file refs, and protected config refs. The verdict may also include `derivedFrom` and `derivationEdges` that reference the blocking requirement or policy-result claims used to decide merge readiness, allowing Surface report generation to cap the verdict at the weakest blocking Requirement result. Advisory policy results remain visible as claims, claim-group requirements, and metadata, but are not readiness derivation inputs. When the installed Surface package supports first-class `authorityTrace`, the artifact includes top-level `trust.bundle.authorityTrace`. Readiness events carry authority by linking to the authority-traced evidence ids.

After validation, Veritas calls Surface's public `buildTrustReport` API and persists a compact `trust.report` summary beside the input. The report summary includes per-claim derived status, summary counts, and transparency gaps. `veritas readiness` prints WARN feedback for Surface-derived `stale` and `disputed` claims, and `veritas explain <rule>` includes the latest Surface status and gaps for that rule when an evidence record is available.

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
| `producer`, `repo_map`, `record_schema_version` | Veritas-local producer/runtime metadata | Veritas-local |
| `trust` | Embedded Surface projection and generated compact report summary | Surface-mapped |
| `trust.bundle` | Embedded Surface `TrustBundle` projection consumed by Surface repo-maps and tests | Surface-mapped |
| `trust.report` | Compact Surface `TrustReport` summary generated from `trust.bundle` | Surface-generated |

The schema enforces this boundary with `x_surface_mapping` metadata on top-level evidence properties. Allowed classifications are `mapped`, `veritas-local`, `transitional`, and `deprecated`. Fields marked `mapped` must also declare `x_surface_targets`, such as `claim`, `evidence`, `policy`, `event`, `metadata`, or `report-input`.

#### Per-Claim Surface Input Slices

When `trust.bundle` is present, Veritas also writes one local slice per claim under `.kontourai/veritas/claims/*.input.json`. These files are derived and gitignored. They are intentionally not Surface `TrustReport` files.

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

When `trust.bundle` and `trust.report` are present, Veritas writes `.surface/runs/<run-id>.console.json` plus `.surface/runs/latest.json`. These files are derived and gitignored. They are the Veritas-side integration contract for the Surface Console and analytics layer.

The read model has `kind: "surface-console-read-model"` and `contract: "surface.analytics-compatible"`. Those are current implementation values. It includes:

- `producer`: Veritas readiness check id, source ref, evidence artifact path, and per-claim input slice paths
- `summary`: claim/evidence/policy/event/gap counts and Console aggregates by status, claim type, producer namespace, domain, policy, evidence type, method, reviewer authority, impact level, and gap type
- `analytics`: a Surface-format analytics projection shaped like Surface's `buildTrustAnalyticsProjection(report)` output, including coverage, stale/disputed queues, requirement gaps, action queues, and attestation validity
- `standardsFeedbackSummary`: populated by `veritas feedback record`; carries the generic Surface `StandardsFeedbackSummary` shape (`reviewed`, `outcome`, `confidence`, `falsePositiveCount`, `missedIssueCount`, `timeToResolutionMinutes`, `notes`, `metadata`). `null` until a standards feedback record is written for the run.
- `claims`: one Console row per Surface claim with derived status from `trust.report`, provenance ids, confidence fields, gap ids, evidence methods, and metadata
- `policies`: policy summaries with claim counts, status counts, required evidence/methods, review authority, and gap counts
- `graph`: normalized nodes and edges for subjects, claims, policies, evidence, events, derived-from links, and transparency gaps

The Surface Console read model is intentionally derived from portable Surface input/report data. It may include Veritas producer metadata, but Surface Console code should not need to import Veritas requirement evaluation, Repo Standards mechanics, Repo Maps, or evidence-check routing logic.

### Repo Standards Settings Schema

Defined by [schemas/veritas-authority-settings.schema.json](../../schemas/veritas-authority-settings.schema.json).

The current file controls settings that belong to Repo Standards:

- default rollout mode
- default Enforcement Level for new requirements
- reviewer confidence scale
- signoff expectations
- evidence requirements before a requirement becomes mandatory

### Standards feedback draft and record

Defined by:

- [schemas/veritas-standards-feedback-draft.schema.json](../../schemas/veritas-standards-feedback-draft.schema.json)
- [schemas/veritas-standards-feedback.schema.json](../../schemas/veritas-standards-feedback.schema.json)
- [schemas/veritas-recommendation.schema.json](../../schemas/veritas-recommendation.schema.json)

The draft captures prefilled context without inventing missing judgment. The record captures the completed operator judgment. Recommendation artifacts capture feedback-derived requirement and work-area recommendations awaiting review.

Requirement results may include optional machine-readable `actions`. These actions are remediation hints for agents and reviewers. They are not auto-fixes unless a future tool explicitly implements them.

### Marker benchmark scenario, session log, and comparison

Defined by:

- [schemas/veritas-marker-benchmark.schema.json](../../schemas/veritas-marker-benchmark.schema.json)
- [schemas/veritas-marker-session-log.schema.json](../../schemas/veritas-marker-session-log.schema.json)
- [schemas/veritas-marker-score.schema.json](../../schemas/veritas-marker-score.schema.json)

These benchmark artifacts support deterministic scoring for "did the right context surface at the right time" comparisons:

- the scenario defines the required marker phrases and scoring window
- the session log captures the observed turns for one condition
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
3. `standards feedback draft` turns that evidence into a repo-local standards-feedback draft artifact.
4. `standards feedback record` turns the evidence or draft into a completed standards-feedback record.
5. `readiness` orchestrates the report plus feedback path and can also run evidence checks first.

The starter guidance surface also includes `.veritas/GOVERNANCE.md`, which is a committed governance artifact rather than a disposable generated output.

## Current Safety Rails

The shipped code currently enforces these boundaries:

- evidence input for standards feedback must come from `.kontourai/veritas/evidence/`
- draft input for standards feedback completion must come from `.kontourai/veritas/standards-feedback-drafts/`
- standards feedback output must stay under `.kontourai/veritas/standards-feedback/`
- CI snippets, runtime hooks, and Codex hook artifacts are constrained to their reviewable subdirectories
- git-hook generation is constrained to `.githooks/`
- Codex hook merging accepts either `--target-hooks-file` or `--codex-home`, never both

## Current Reference Files In This Repo

Use these when you want concrete, current examples instead of abstract schema descriptions:

- Repo Map examples: [repo-maps/work-agent.repo-map.json](../../repo-maps/work-agent.repo-map.json), [repo-maps/demo-docs-site.repo-map.json](../../repo-maps/demo-docs-site.repo-map.json)
- Repo Standards example: [repo-standards/work-agent-convergence.repo-standards.json](../../repo-standards/work-agent-convergence.repo-standards.json)
- evidence examples: [examples/evidence/work-agent-pass.json](../../examples/evidence/work-agent-pass.json), [examples/evidence/work-agent-fail.json](../../examples/evidence/work-agent-fail.json), [examples/evidence/work-agent-policy-gap.json](../../examples/evidence/work-agent-policy-gap.json)
- external tool example: [examples/evidence/fallow-advisory.json](../../examples/evidence/fallow-advisory.json)
- standards-feedback examples: [examples/standards-feedback/work-agent-authority-settings.json](../../examples/standards-feedback/work-agent-authority-settings.json), [examples/standards-feedback/work-agent-observe-standards-feedback-draft.json](../../examples/standards-feedback/work-agent-observe-standards-feedback-draft.json), [examples/standards-feedback/work-agent-observe-standards-feedback.json](../../examples/standards-feedback/work-agent-observe-standards-feedback.json)
- benchmark examples: [examples/benchmarks/migration/scenario.json](../../examples/benchmarks/migration/scenario.json), [examples/benchmarks/migration/without-veritas.json](../../examples/benchmarks/migration/without-veritas.json), [examples/benchmarks/migration/with-veritas.json](../../examples/benchmarks/migration/with-veritas.json), [examples/benchmarks/migration/comparison.json](../../examples/benchmarks/migration/comparison.json)
- suite examples: [examples/benchmarks/suites/context-surfacing-suite.json](../../examples/benchmarks/suites/context-surfacing-suite.json), [examples/benchmarks/suites/context-surfacing-suite-report.json](../../examples/benchmarks/suites/context-surfacing-suite-report.json)
- classification example: [examples/classification/work-agent-convergence-rule-groups.json](../../examples/classification/work-agent-convergence-rule-groups.json)
