# Protected Standards Authority

Protected Standards Authority is the Veritas subcontext for attested assertions about Protected Standards, standards changes, and recommendation acceptance, and for whether the approval behind each one was resolved.

## Language

**Protected Standards Authority**:
The trusted authority context for verifying or accepting changes to Protected Standards. It includes who can attest, what they attested to, and why that authority counts.
_Avoid_: Generic approval, blanket reviewer trust

**Protected Standards Attestation**:
Recorded evidence that Protected Standards were reviewed, accepted, or approved for a specific integrity scope and validity window. It anchors hashes for the standards, repo map, and authority settings. It is authority-backed only when its Approval Reference was resolved against an approval record (`resolved` or `resolved-strict` mode); in the default `reference-only` mode, and in `prefix` mode, it is a recorded attestation with an unverified approval reference.
_Avoid_: Signature as the whole concept, waiver

**Attestation Chain**:
The ordered relationship between an existing attestation and later attested changes. A policy-change or recommendation-acceptance attestation depends on a prior valid attestation.
_Avoid_: Independent approvals, unanchored history

**Governance Drift**:
The state where Protected Standards no longer match the hashes anchored by the current attestation. Governance drift can make readiness fail until a fresh attestation is recorded.
_Avoid_: File changed as the whole concept, harmless mismatch

**Validity Window**:
The time period during which an attestation may count for readiness. Expiration makes authority evidence stale even if the protected files did not drift, and readiness fails until a fresh attestation is recorded.
_Avoid_: Timestamp only, permanent approval

**Approval Reference**:
The cited authority source that explains why an attestation act was allowed. Depending on authority settings, it may be a human statement, resolved approval record, delegated exchange, or authorized action.
_Avoid_: Free-form note, approval as the whole attestation

**Example Dialogue**:
Developer: "I changed Repo Standards and updated the attestation."
Domain Expert: "The attestation must cite an Approval Reference and anchor the new Protected Standards hashes, or the change still has Governance Drift."

Agent: "The prior attestation is expired but the files match."
Domain Expert: "That means the Validity Window is stale. A recheck cannot make it current without fresh authority evidence."
