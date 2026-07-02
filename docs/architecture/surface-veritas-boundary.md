# Surface-Veritas Boundary

Veritas is the repo and AI-agent governance product. Surface is the product-neutral transparency layer Veritas is built with. The dependency direction is one-way: Veritas may use Surface contracts and APIs. Surface does not depend on Veritas readiness runtime code.

## Boundary Rule

Veritas owns repo-native governance. Surface owns portable transparency.

Veritas callers should cross this boundary through the Built with Surface producer module. The producer accepts Veritas records and returns portable Surface state; callers should not assemble Surface claims, validation, and trust-report summaries independently.

Normal Veritas users should think in Veritas terms: repo standards, repo maps, requirements, evidenceChecks, verification authorities, merge readiness, readiness reports, repo conformance, and standards feedback. Surface terms should appear only when documenting interoperability, generated trust state, or Surface APIs.

## Veritas Owns

- Repo Standards
- Standards Files and Repo Standards Templates
- Repo Maps
- Work Areas, Change Boundaries, Boundary Crossings, and Protected Areas
- Requirements and Requirement Applicability
- Evidence Checks
- Verification Authorities and Authority Evidence
- Attestations and Exceptions
- Enforcement Levels: Observe, Guide, Require
- Change Guidance
- Readiness Reports, Merge Readiness, and Readiness Coverage
- Repo Conformance
- Protected Standards, Standards Growth, and Generated Evidence
- Standards Feedback and Standards Recommendations

## Surface Owns

- Claims and subjects
- Evidence and evidence trace
- Policies and events
- Authority trace
- Integrity references
- Freshness, Changed Since Verified, and Expired Verification
- Conflicts and Transparency Gaps
- Trust snapshots and trust reports
- Open trust format and producer extensions

## Mapping

| Veritas concept | Surface concept | Boundary |
| --- | --- | --- |
| Requirement evaluation | Claim, evidence, policy, event | Surface-mapped |
| Evidence Check result | Evidence and verification event | Surface-mapped |
| Verification Authority | Authority trace, verifier metadata, policy context | Surface-mapped |
| Authority Evidence | Evidence trace, integrity reference, authority trace | Surface-mapped |
| Attestation | Evidence with authority and integrity context | Surface-mapped |
| Exception | Authority-backed evidence plus accepted-risk metadata | Surface-mapped |
| Evidence Freshness | Freshness, Changed Since Verified, Expired Verification | Surface-mapped |
| Merge Readiness | Derived readiness verdict claim | Veritas-owned outcome, Surface-mapped state |
| Readiness Coverage | Claim status, evidence, gaps, conflicts, freshness | Surface-mapped state |
| Repo Conformance | Standing claims and evidence about repo-wide requirements | Surface-mapped state |
| Repo Standards / Repo Map integrity | Claims and evidence about protected standards | Surface-mapped state |
| Standards Recommendation | Proposed claim and supporting evidence | Surface-mapped state |
| Change Guidance | Veritas-local guidance, optionally exposed as metadata | Veritas-local |
| Repo Map routing mechanics | Producer metadata | Veritas-local |

## Artifact Contract

Current Veritas evidence artifacts include a `trust.bundle` block, which is a Surface `TrustBundle` projection:

```json
{
  "trust": {
    "bundle": {
      "schemaVersion": 5,
      "source": "veritas:<run_id>",
      "claims": [],
      "evidence": [],
      "policies": [],
      "events": [],
      "claimGroups": []
    }
  }
}
```

The `trust` block name is product-neutral by design: Surface is the reference implementation of the trust format, not its namespace.

`trust.bundle` must not contain generated Surface report fields such as `id`, `generatedAt`, `summary`, `transparencyGaps`, or `evidenceRequirementsByClaimId`. Surface generates those fields when it builds a trust report.

Veritas validates this projection with Surface's public validation API (`validateTrustBundle`). Validation failures are runtime/configuration errors. `VERITAS_SKIP_SURFACE_VALIDATION=1` exists only as an emergency bypass.

Readiness runs also project merge readiness as a portable Surface claim:

- `claimType: "software-readiness-verdict"`
- `facet: "veritas.readiness"`
- `subjectType: "repository-change"`
- `subjectId`: a stable producer/source id derived from the adapter or Repo Standards name plus the run source ref
- `currentIntegrityRef`: the run source integrity ref

The Veritas meaning is still merge readiness: the verdict summarizes whether the change satisfies the applicable Requirements with the available evidence, authority, exceptions, and freshness. At the Surface boundary, that verdict can be represented as a claim derived from requirement or policy-result claims. Blocking Requirements should be linked as blocking inputs, so a rejected, stale, or disputed blocking result can limit the generated readiness verdict instead of being hidden behind a producer summary.

Interoperability fields such as `derivedFrom`, `derivationEdges`, `TrustBundle`, and `buildTrustReport` belong in this boundary contract, not in first-contact Veritas guidance. Readiness derivation links only include blocking policy-result claims; advisory results remain represented as claims and requirement metadata without capping the readiness verdict. Tests currently exercise this behavior with in-code passing, advisory-failed, and blocked fixtures: the passing fixture keeps merge readiness verified, the advisory-failed fixture keeps readiness verified while preserving the rejected advisory claim, and the blocked fixture includes a rejected blocking Requirement and Surface report generation downgrades the readiness verdict. No durable JSON fixture path exists for those fixtures.

Downstream systems, including Flow, should locate readiness by querying `trust.bundle.claims[]` or generated `trust.report.claims[]` for that claim type, subject, producer metadata, integrity scope, and authority trace. They must not import Veritas source modules or parse Veritas-only readiness fields as their integration contract.

Surface `^0.6.0` supports first-class top-level `authorityTrace`. Veritas emits readiness authority as top-level `TrustBundle` state. Readiness events link to the authority-traced evidence by `evidenceIds`.

## Product Language Rule

First-contact Veritas docs should not lead with `trust.bundle`, TrustBundle, TrustReport, transparency gaps, claimGroups, or pre-glossary implementation names for standards, maps, checks, feedback, recommendations, readiness coverage, operational summaries, or protected standards.

Use the canonical terms from the glossary: Repo Standards, Repo Map, Work Area, Requirement, Evidence Check, Readiness Coverage, Standards Feedback, Standards Recommendation, Protected Standards, Standards Growth, and Generated Evidence.

When documenting current schemas or CLI syntax, name the current field or flag explicitly only where accuracy requires it. Do not present pre-glossary names as a public surface to preserve.
