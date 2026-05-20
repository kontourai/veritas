# Surface-Veritas Boundary

Veritas is the repo and AI-agent governance product. Surface is the portable trust/evidence substrate underneath it. They are separate products: Veritas builds on Surface, and Surface does not depend on Veritas runtime code.

## Boundary Rule

Portable truth concepts go to Surface; repo and agent workflow mechanics stay in Veritas.

Veritas keeps developer-native concepts when they help agents decide what to run, inspect, or fix. Those concepts must either map to Surface primitives or be explicitly marked Veritas-local.

Dependency direction is one-way. Veritas docs may link to Surface docs and Veritas code may use Surface contracts, but Surface should remain the base product and should not import Veritas as a runtime dependency.

Veritas owns the Veritas-to-Surface adapter. Surface exposes generic adapter and policy helpers, schema validation, and report generation; it does not ship first-class Veritas mapping code.

## Foundation Contract

Surface owns portable trust primitives:

- subjects and claims
- evidence
- verification policies
- verification events
- collections, controls, and validation strategies
- freshness and status
- conflict and fault-line generation
- proof requirements
- owner and confidence basis
- generated trust reports

Veritas owns its repo-governance product mechanics:

- repo adapters and graph surfaces
- policy packs
- proof lanes and proof-family manifests
- verification budgets
- shadow runs and lint-style agent feedback
- eval drafts, eval records, and local improvement history

Any new Veritas abstraction must choose one of three paths:

1. Map to existing Surface primitives and document the mapping.
2. Stay Veritas-local and document why it is workflow-specific.
3. Become a candidate Surface primitive only after it repeats outside developer-governance workflows.

## Mapping

| Veritas concept | Surface concept | Boundary |
| --- | --- | --- |
| affected repo node | claim subject | Surface-mapped |
| selected proof lane | verification policy, evidence, event | Surface-mapped |
| proof-family result | claim, evidence, event, metadata | Surface-mapped |
| verification budget | budget claim/evidence and report metadata | Surface-mapped |
| policy result | claim, evidence, event, fault-line hint | Surface-mapped |
| shadow run | evidence-producing eval run | Veritas producer, Surface input |
| policy pack | Surface collection/framework plus source of governance claims about integrity, freshness, drift, and attestation | Surface-mapped state |
| repo adapter | source of governance claims about integrity and applicability | Surface-mapped state |
| team profile | source of governance claims about integrity and attestation | Surface-mapped state |
| move-to-test / retire / upstream-abstraction | lifecycle disposition | Veritas-local until another domain needs the same lifecycle |

Policy packs, repo adapters, and team profiles are Veritas artifacts that project Surface state. The artifact mechanics stay in Veritas: file layout, graph routing, policy-pack rule kinds, and team ownership conventions remain repo-governance vocabulary. At the Surface boundary, Veritas projects concrete claims, evidence, events, and collections about those artifacts: current content hash, whether that hash matches the active human attestation, whether the adapter applied cleanly to the changed paths, whether policy rules passed, and whether attestations are current, stale, missing, or drifted.

This keeps the one-way dependency intact. Surface receives normal claims, evidence, policies, events, and collections; it does not need Veritas-specific runtime code to understand the trust report.

## Artifact Contract

Veritas evidence artifacts include `surface.input`, which is a Surface `TrustInput` projection:

```json
{
  "surface": {
    "input": {
      "schemaVersion": 2,
      "source": "veritas:<run_id>",
      "claims": [],
      "evidence": [],
      "policies": [],
      "events": [],
      "collections": []
    }
  }
}
```

`surface.input` must not contain generated Surface report fields such as `id`, `generatedAt`, `summary`, `faultLines`, or `proofRequirementsByClaimId`. Surface generates those fields when it builds the trust report.

At emission time, Veritas validates this projection with Surface's `validateTrustInput`. Validation failures are runtime/configuration errors: Veritas writes the rejected input under `.veritas/external/surface-validation-failures/` and exits with code 2. `VERITAS_SKIP_SURFACE_VALIDATION=1` exists only as an emergency bypass.

## Drift Prevention

Top-level evidence schema fields declare `x_surface_mapping`.

Allowed values:

- `mapped`
- `veritas-local`
- `transitional`
- `deprecated`

Mapped fields also declare `x_surface_targets`, such as `claim`, `evidence`, `policy`, `event`, `metadata`, or `report-input`.

Reference tests fail when new top-level evidence fields lack this classification.

The same rule applies to docs: first-contact Veritas docs must describe Surface as the foundation and Veritas as a separate product built on it. That keeps future contributors from presenting Veritas as an independent trust substrate or presenting Surface and Veritas as one combined product.
