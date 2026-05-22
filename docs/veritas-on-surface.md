# Veritas Built With Surface

Veritas is a producer of Surface-format trust state. Surface powers the portable transparency layer underneath Veritas, while Veritas owns the repo-native product experience.

```text
Repository -> Veritas Repo Standards and Repo Map -> requirements and boundaries
Veritas    -> readiness evaluation             -> evidence, authority, guidance
Surface    -> transparency derivation          -> status, freshness, conflicts, gaps
```

Normal Veritas users should not need to configure Surface directly. Veritas can use Surface internally to validate trust state, derive freshness and conflict signals, and power a Veritas Console with Veritas vocabulary.

## Runtime Model

1. A repository defines Repo Standards and a Repo Map.
2. A Veritas readiness check evaluates a change or repo state against those standards.
3. Veritas records evidence, attestations, exceptions, and readiness coverage.
4. Veritas emits Surface-format trust state at the boundary.
5. Surface derives status, freshness, conflicts, and transparency gaps.
6. Veritas presents those results as readiness reports, repo conformance, and standards feedback.

The product signal is **Built with Surface**. The user-facing product remains Veritas.
