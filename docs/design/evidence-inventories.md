# Evidence Check Inventories

This document describes the current artifact fields behind **Evidence Checks**, **Readiness Coverage**, and **Standards Feedback**.

## Problem

Brownfield repos often start with custom verification scripts that mix product tests, migration checks, policy checks, source-shape assertions, and temporary guardrails.

One pass/fail bit hides too much. Veritas needs a way to show which evidence checks are required, advisory, stale, retiring, or candidates for stronger enforcement.

## Current Artifact Shape

Evidence artifacts include `evidence_inventory_results` when the current repo map declares evidence-check inventory manifests:

```json
{
  "evidence_inventory_results": [
    {
      "id": "repo-governance",
      "lane_id": "repo-governance",
      "source_evidence_check_id": "repo-guardrails",
      "manifest_path": ".veritas/evidence-inventories/repo-guardrails.items.json",
      "disposition": "required",
      "blocking_status": "required",
      "verification_weight": "blocking",
      "selected": true,
      "owner": "repo-core",
      "recent_catch_evidence": "active standards evaluation",
      "review_trigger": "review when upstream requirement covers this item",
      "freshness_status": "current"
    }
  ]
}
```

These fields are current schema names only. User-facing reports should explain them as evidenceChecks, freshness, and readiness coverage.

## Dispositions

- `required`: maps to Require.
- `candidate`: observed and trended before stronger enforcement.
- `advisory`: guidance or visibility only.
- `move-to-test`: product behavior that should become unit, integration, or E2E coverage.
- `upstream-abstraction`: reusable verification shape that belongs in Veritas.
- `retire`: historical source-shape or migration-only check.

Unknown catch evidence should default to candidate or advisory, not required.

## Readiness Coverage

Reports currently include `readiness_coverage`, a generated summary of selected checks, grouped checks, required/candidate/advisory/retiring counts, stale checks, missing review triggers, and cleanup recommendations.

Use:

```bash
veritas readiness --check coverage --working-tree
```

as the current command for readiness coverage. Future product surfaces should call this readiness coverage directly.
