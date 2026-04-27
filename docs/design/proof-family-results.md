# Proof Family Results

Proof lanes can hide too much behind one pass/fail bit. Brownfield repos often start with custom verification scripts that mix policy checks, product behavior checks, temporary migration tombstones, and repo-specific source-shape assertions.

Veritas should support the reusable shape of that evidence without absorbing one repo's local assertions.

## Design Goal

Expose family-level proof evidence so operators can see:

- which family failed,
- whether the family is required, candidate, advisory, or retiring,
- who owns it,
- what changed file or trust boundary it protects,
- when it should be promoted, softened, moved to tests, or retired.

## Non-Goals

- Do not add repo-specific modules, helper names, or product file paths to Veritas core.
- Do not make every custom verification check a framework policy.
- Do not bypass normal product tests. Veritas should select and report tests, not replace them.

## Artifact Shape

Evidence artifacts include `proof_family_results` when the adapter declares proof-family manifests:

```json
{
  "proof_family_results": [
    {
      "id": "repo-governance",
      "lane_id": "repo-governance",
      "source_proof_lane_id": "repo-guardrails",
      "manifest_path": ".veritas/proof-families/repo-guardrails.families.json",
      "disposition": "required",
      "blocking_status": "required",
      "verification_weight": "blocking",
      "selected": true,
      "destination": "veritas-policy",
      "owner": "repo-core",
      "recent_catch_evidence": "active policy evaluation",
      "regression_severity": "high",
      "false_positive_risk": "low",
      "replacement_test_available": "none",
      "review_trigger": "review when upstream policy covers this family",
      "last_reviewed": "2026-04-26",
      "evidence_basis": "migration proof",
      "freshness_status": "current",
      "rationale": "Protects the repository trust contract."
    }
  ]
}
```

Adapters declare manifests with `evidence.proofFamilyManifests`:

```json
{
  "evidence": {
    "proofFamilyManifests": [
      ".veritas/proof-families/repo-guardrails.families.json"
    ]
  }
}
```

The manifest stays repo-local because it describes a migration inventory. Veritas owns the portable report shape: selected status, owner, disposition, verification weight, catch evidence, false-positive risk, replacement-test availability, review trigger, and freshness status.

Repos may still write sidecar artifacts under `.veritas/evidence/proof-families/` when they want command-level findings. The report-level `proof_family_results` field is the durable summary that other tools should consume.

## Dispositions

- `required`: blocks promotion or check-in.
- `candidate`: reported and trended, but not blocking by default.
- `advisory`: informational.
- `move-to-test`: product behavior that should become unit, integration, or E2E coverage.
- `upstream-abstraction`: reusable verification shape that belongs in Veritas.
- `retire`: historical source-shape or migration-only check.

Unknown catch evidence should default to `candidate` or `advisory`, not `required`.

Runtime validation enforces the promotion rule for declared manifests: required families need an owner, review trigger, lane id, and non-unknown catch evidence. This keeps broad brownfield inventories from becoming permanent blockers by accident.

## Brownfield Use

During brownfield adoption:

1. inventory existing custom verification scripts,
2. group checks into proof families,
3. assign each family a disposition and owner,
4. keep a small required governance lane,
5. report candidate/advisory families separately,
6. move product behavior checks into normal tests,
7. retire migration tombstones when their review trigger fires.

This lets Veritas preserve safety while avoiding a permanent wrapper around bespoke lint scripts.

## Verification Budget

Reports also include `verification_budget`, a generated summary of:

- proof lane count,
- selected proof lane count,
- proof family count,
- required/candidate/advisory/move-to-test/retiring family counts,
- families with unknown catch evidence, retirement status, or missing review triggers,
- families with stale or review-needed freshness status,
- a recommendation for whether to promote checks or clean up stale ones first.

This keeps the default question concrete: "what are we checking, why, what can block, and what should be deleted?"

Use `veritas budget --working-tree` for the short operator view, or `veritas budget --format json --working-tree` for CI or UI consumption.
