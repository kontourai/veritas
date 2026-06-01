# Attestation

An attestation is authority-backed evidence that something was verified, accepted, approved, or reviewed.

In Veritas, attestations protect the parts of the repo standards and repo map that define what good looks like, where boundaries are, and who or what can verify requirements. The goal is not to make humans approve every routine change. The goal is to keep the definition of good from changing without trusted authority.

## Bootstrap Attestation

After `veritas init`, review the generated standards and map, then record the first attestation:

```bash
npx @kontourai/veritas attest bootstrap \
  --actor <authority-id> \
  --approval-ref <human-approval-reference> \
  --non-interactive
```

`--approval-ref` is required for every authority-backed attestation. Use a durable reference to the explicit human approval, such as a pull request review, issue comment, change ticket, signed approval record, or other review artifact. Agents may prepare the command, but they should stop and ask for that reference instead of inventing one.

Teams can tighten this in authority settings with `review_preferences.attestation_approval_ref_policy.allowed_prefixes`. For example, a team can require all approval references to start with `servicenow:change/` before Veritas will record an attestation. That local policy is the foundation for resolver-backed checks where Veritas can later validate the referenced approval against an external system before writing the record.

## Approval Resolver Contract

Approval references are provider-neutral. Veritas treats external approval systems as the source of authority and records the resolver result as evidence about that source, not as a replacement for it.

A resolver receives:

- the approval reference
- attestation kind
- actor
- repo identity
- Protected Standards hashes
- request timestamp

A resolver returns a normalized result with:

- `status`: `approved`, `rejected`, `unresolved`, `expired`, `out-of-scope`, or `error`
- provider and authority reference
- approver identity and approval timestamp when available
- expiry, scope, and evidence hash when available
- a stable failure reason when not approved

Authority settings can use these policy modes:

- `reference-only`: require a durable approval reference
- `prefix`: require one of the configured approval reference prefixes
- `resolved`: require a resolver-backed approved result
- `resolved-strict`: reserved for stricter scope/actor matching on top of resolver approval

Current built-in CLI behavior supports `reference-only` and `prefix`. Resolver-backed modes are part of the core contract and will be usable by provider or offline resolvers.

## Offline Approval Records

Veritas includes a deterministic offline resolver for teams that want resolver-backed attestations without network providers or secrets. Store approval records under:

```text
.veritas/authority/approval-records/
```

Use `veritas-approval:<id>` to load `.veritas/authority/approval-records/<id>.approval.json`, or `file:.veritas/authority/approval-records/<file>` for an explicit repo-local record path. File references must stay inside the approval-records directory.

Example record:

```json
{
  "schemaVersion": 1,
  "id": "chg-123",
  "status": "approved",
  "approvalRef": "veritas-approval:chg-123",
  "provider": "veritas-offline",
  "authorityRef": "chg-123",
  "approvedBy": "change-manager",
  "approvedAt": "2026-06-01T00:00:00.000Z",
  "expiresAt": "2026-07-01T00:00:00.000Z",
  "scope": {
    "attestationKinds": ["bootstrap", "policy-change"]
  }
}
```

When authority settings use `mode: "resolved"` or `mode: "resolved-strict"`, Veritas blocks attestation writes unless the approval ref resolves to an approved, unexpired, in-scope record. Failed resolution happens before attestation files are written. Recommendation acceptance uses the same approval path before applying standards changes.

The current implementation records hashes for the files that hold protected standards state:

- `.veritas/repo-map.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/authority/default.authority-settings.json`

Product language should describe them as the Repo Map and Repo Standards.

## Standards Change Attestation

When protected standards change, record a successor attestation:

```bash
npx @kontourai/veritas attest policy-change \
  --actor <authority-id> \
  --approval-ref <human-approval-reference> \
  --message "Reviewed standards change for contract boundary requirements"
```

Veritas compares the active attestation to the current protected standards. If the hashes no longer match, `veritas readiness` reports that the standards need fresh authority before merge readiness can be trusted.

## Status

```bash
npx @kontourai/veritas attest status
```

Status reports the current attestation, age, expiry, and hash drift.

## What Attestation Is Not

An attestation is not:

- a generic approval label
- evidenceCheck that all code is correct
- a replacement for evidenceChecks
- required for every routine merge
- the same thing as an exception

An **Exception** is an authority-backed decision to accept an unmet or failing requirement for a specific change. An attestation is the evidence form that can support that decision.

## Built With Surface

Veritas projects attestation evidence into Surface-format trust state so freshness, integrity, and authority gaps can be inspected. Veritas users should still think in Veritas terms: protected standards, verification authorities, attestations, and readiness reports.
