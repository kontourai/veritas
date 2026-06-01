# Veritas and Surface

Veritas is the repo and AI-agent governance product. Surface is the transparency layer Veritas is built with.

Most Veritas users should not need to choose between them, configure Surface directly, or learn Surface vocabulary first. Use Veritas when the job is repo standards, change boundaries, evidenceChecks, merge readiness, repo conformance, or change guidance.

## Use Veritas For Repo Governance

Use Veritas when you want to:

- define repo standards
- map work areas and change boundaries
- give developers and agents just-in-time change guidance
- evaluate merge readiness for a change
- track repo conformance for standing requirements
- protect the standards that define what good looks like
- improve standards from observed outcomes

Veritas may emit Surface-format trust state underneath, but that is an implementation and interoperability detail for normal repo governance workflows.

## Use Surface For Product Transparency

Use [Surface](https://github.com/kontourai/surface) directly when you are building a different product that needs to expose claims, evidence, freshness, conflicts, transparency gaps, trust panels, or portable trust snapshots.

Surface does not know what a repo, work area, boundary crossing, or merge readiness result is. Those are Veritas concepts.

## How They Relate

Veritas owns the repo-native workflow:

- repo standards
- repo maps
- requirements
- evidenceChecks
- verification authorities
- attestations and exceptions
- readiness reports
- repo conformance
- standards feedback and recommendations

Surface owns portable transparency primitives:

- claims
- evidence
- policies
- events
- freshness
- conflicts
- transparency gaps
- trust snapshots and reports

At the boundary, Veritas acts as a Surface producer. It turns requirement evaluations, evidenceChecks, attestations, exceptions, and readiness outcomes into Surface-format claims and evidence. Surface can then derive status, freshness, conflicts, and gaps without importing Veritas readiness runtime code.

For readiness integrations, the stable artifact path is the `reportArtifactPath` returned by `veritas readiness --format json`. Consumers should query the artifact's `surface.input.claims[]` or generated `surface.report.claims[]` for `claimType: "software-readiness-verdict"` rather than parse Veritas readiness internals. Authority trace and integrity scope live in Surface trust state when supported and are mirrored in claim/evidence metadata for older Surface 0.4 consumers, with readiness events linked to that evidence, so Flow and other consumers can attach the portable trust state without importing Veritas code.

The public product signal is **Built with Surface**. The Veritas product experience should still use Veritas vocabulary.
