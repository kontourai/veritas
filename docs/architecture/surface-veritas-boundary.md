# Surface-Veritas Boundary

Veritas is the repo and AI-agent governance product. Surface is the portable trust/evidence substrate underneath it.

## Boundary Rule

Portable truth concepts go to Surface; repo and agent workflow mechanics stay in Veritas.

Veritas keeps developer-native concepts when they help agents decide what to run, inspect, or fix. Those concepts must either map to Surface primitives or be explicitly marked Veritas-local.

## Foundation Contract

Surface owns portable trust primitives:

- subjects and claims
- evidence
- verification policies
- verification events
- freshness and status
- conflict and fault-line generation
- proof requirements
- owner and confidence basis
- generated trust reports

Veritas owns the developer-governance product layer:

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
| policy pack | verification policy provenance | Surface-mapped metadata |
| move-to-test / retire / upstream-abstraction | lifecycle disposition | Veritas-local until another domain needs the same lifecycle |

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
      "events": []
    }
  }
}
```

`surface.input` must not contain generated Surface report fields such as `id`, `generatedAt`, `summary`, `faultLines`, or `proofRequirementsByClaimId`. Surface generates those fields when it builds the trust report.

## Drift Prevention

Top-level evidence schema fields declare `x_surface_mapping`.

Allowed values:

- `mapped`
- `veritas-local`
- `transitional`
- `deprecated`

Mapped fields also declare `x_surface_targets`, such as `claim`, `evidence`, `policy`, `event`, `metadata`, or `report-input`.

Reference tests fail when new top-level evidence fields lack this classification.

The same rule applies to docs: first-contact Veritas docs must describe Surface as the foundation and Veritas as the product layer. That keeps future contributors from accidentally presenting Veritas as an independent trust substrate.
