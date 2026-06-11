# Schema Evolution Policy

Veritas ships multiple JSON schemas because Repo Maps, Repo Standards, evidence artifacts, standards-feedback artifacts, and benchmark examples are all part of the product contract.

This document defines how those contracts evolve.

## [shipped] Versioning Rule

Veritas uses two layers of versioning:

- schema documents should carry a stable `$id`
- artifacts should carry an explicit version field such as `version` or `schema_version`

Breaking contract changes require both:

- a new artifact version in the payload
- a matching schema update that reflects that version

## [shipped] Schema Change Rule

Additive changes may stay within the current major artifact version when:

- existing required keys stay required
- existing meanings do not change
- older producers remain valid against the updated schema

Breaking changes require a new artifact version when:

- a required field is removed or renamed
- a field changes meaning
- a type becomes narrower in a way that invalidates old artifacts

## [shipped] Deprecation Rule

When a new major schema version is introduced:

- the previous major version should remain documented for at least one release cycle
- migration notes should explain how to move from the old artifact shape to the new one
- verification fixtures should include at least one artifact for the new version before the old one is dropped

## [shipped] Operator Guidance

- prefer explicit artifact versions over implicit interpretation
- do not reuse an old version number for a new contract
- update the relevant design/reference docs at the same time as the schema

## [shipped] Contract: Evidence Check Inventories

Brownfield repos may need grouped evidence before every individual check becomes a reusable Veritas requirement. The evidence schema supports this with `evidence_inventory_results` and `readiness_coverage` fields, populated from Repo Map inventory manifests.

When evolving these fields:

- keep existing evidence-check command results valid,
- document candidate/advisory/required disposition semantics,
- keep repo-specific assertions inside repo-local manifests,
- add fixtures that prove old evidence remains valid and new item-level evidence renders correctly.
