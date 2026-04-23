# Schema Evolution Policy

Veritas ships multiple JSON schemas because adapters, policy packs, evidence artifacts, eval artifacts, and benchmark fixtures are all part of the framework contract.

This document defines how those contracts evolve.

## Versioning Rule

Veritas uses two layers of versioning:

- schema documents should carry a stable `$id`
- artifacts should carry an explicit version field such as `version` or `schema_version`

Breaking contract changes require both:

- a new artifact version in the payload
- a matching schema update that reflects that version

## Compatibility Rule

Additive, backward-compatible changes may stay within the current major artifact version when:

- existing required keys stay required
- existing meanings do not change
- older producers remain valid against the updated schema

Breaking changes require a new artifact version when:

- a required field is removed or renamed
- a field changes meaning
- a type becomes narrower in a way that invalidates old artifacts

## Deprecation Rule

When a new major schema version is introduced:

- the previous major version should remain documented for at least one release cycle
- migration notes should explain how to move from the old artifact shape to the new one
- verification fixtures should include at least one artifact for the new version before the old one is dropped

## Operator Guidance

- prefer explicit artifact versions over implicit interpretation
- do not reuse an old version number for a new contract
- update the relevant design/reference docs at the same time as the schema
