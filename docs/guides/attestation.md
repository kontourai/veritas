# Attestation

An attestation is authority-backed evidence that something was verified, accepted, approved, or reviewed.

In Veritas, attestations protect the parts of the repo standards and repo map that define what good looks like, where boundaries are, and who or what can verify requirements. The goal is not to make humans approve every routine change. The goal is to keep the definition of good from changing without trusted authority.

## Bootstrap Attestation

After `veritas init`, review the generated standards and map, then record the first attestation:

```bash
npx --no @kontourai/veritas attest bootstrap \
  --actor <authority-id> \
  --approval-ref <human-approval-reference> \
  --non-interactive
```

`--approval-ref` is required for every attestation. Use a durable reference to the explicit human approval, such as a pull request review, issue comment, change ticket, signed approval record, or other review artifact. Agents may prepare the command, but they should stop and ask for that reference instead of inventing one.

New repos start in `reference-only` mode with no allowed prefixes. Veritas then checks only that the reference is not empty; it does not confirm that the approval exists. The attestation records who attested and the reference they gave.

Teams can tighten this in authority settings under `review_preferences.attestation_approval_ref_policy`. `allowed_prefixes` constrains the reference format in any mode; for example, a team can require all approval references to start with `servicenow:change/`. A prefix check still does not confirm the approval. To have Veritas check the referenced approval before writing the record, use a resolved mode with an approval record, described below.

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

- `reference-only`: require a non-empty approval reference
- `prefix`: currently the same as `reference-only`; the prefix check comes from `allowed_prefixes`, which applies in every mode
- `resolved`: require a resolver-backed approved result
- `resolved-strict`: currently the same as `resolved`; reserved for stricter scope and actor matching

The built-in CLI resolves approvals only through the offline approval records below. It has no network provider resolver and no option to plug one in.

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
npx --no @kontourai/veritas attest policy-change \
  --actor <authority-id> \
  --approval-ref <human-approval-reference> \
  --message "Reviewed standards change for contract boundary requirements"
```

Veritas compares the active attestation to the current protected standards. If the hashes no longer match, `veritas readiness` reports that the standards need fresh authority before merge readiness can be trusted.

Each protected standards file must be a regular file at its protected path. If the file, or any directory between the repo root and the file, is a symbolic link, the file counts as drift even when the linked content is byte-identical, because the governing bytes would then live outside the protected location. A directory, named pipe, or other non-regular entry at the path counts as drift too, and so does an entry that cannot be inspected. Status reports that file's current hash as `null`, and the readiness message names the path and what it is. `veritas attest` refuses to record an attestation in that state. To clear it, restore a regular file at the protected path. Restoring the attested bytes makes the status `current` again; different bytes need a fresh `policy-change` attestation.

When a protected path given with a CLI flag such as `--repo-standards`, `--repo-map`, or `--authority-settings` lies outside the repo root, Veritas checks only the final entry. Directories above it are not checked for symbolic links.

## Status

```bash
npx --no @kontourai/veritas attest status
```

Status reports the current attestation, age, expiry, and hash drift. It also reports `priorAttestationLink` for the active record: the `reference` it names as its predecessor, its `form` (`attestation-id`, `legacy-reference`, or `unresolved`), whether it `resolved` to a tracked record, and an `explanation`. A successor of an unmarked historical attestation names its predecessor by the opaque `legacy-attestation-v0:<hash>` reference rather than the id in `HEAD`, because the historical id embeds a digest of the raw Repo Map file. That is the expected migration link, not a broken chain; `resolved` is `true` only when the reference matches exactly one tracked record, and the readiness PASS line for `policy-changes-require-attestation` names the reference and whether it resolved.

## Validity Window

Each attestation counts for readiness for a fixed number of days after it was recorded: 90 by default, or the value given with `--valid-until-days`. That value must be a whole number of days, 1 or more, written in digits; `attest bootstrap` and `attest policy-change` refuse anything else, and a window that would end past the latest date Veritas can represent, with exit code `2` and without writing a record. `attest status` reports the end of that window as `validUntil`, and `expired: true` once it has passed. Expiry is judged when readiness runs, and the window includes `validUntil` itself.

An expired attestation is stale authority: the approval it records has run out under the repository's own policy, even though the protected standards still match. Readiness fails closed on it, as it does on drift:

- The feedback output reports `FAIL  policy-changes-require-attestation: Active attestation <id> expired at <validUntil>; readiness fails until an authority records a fresh attestation.`, then says that a human authority must run the command below and that an agent must not run it, and the process exits `1`. The stop hook shows this text to the agent at the end of every turn until the attestation is renewed.
- JSON output has `readiness.status: "fail"` and `readiness.verdict: "not-ready"`. In the trust bundle the readiness claim is `rejected` and the attestation currency claim is `stale`.

`attest status` still reports `state: "current"` for an expired record whose hashes match, because the files did not drift. Read `expired` for the validity window.

To clear it, a human authority reviews the protected standards, then records a fresh attestation. A `policy-change` attestation is accepted when nothing changed. Pass the expired attestation's `validUntilDays` again to keep a custom window; the readiness message names it:

```bash
npx --no @kontourai/veritas attest policy-change \
  --actor <authority-id> \
  --approval-ref <human-approval-reference> \
  --message "Renewed the attestation after reviewing the unchanged standards" \
  --valid-until-days <days>
```

A record whose window cannot be evaluated is never treated as open-ended. If `validUntilDays` is missing, `null`, not a whole number of days of 1 or more, or `attestedAt` is not a valid date, `attest status` reports `expired: true`, `validUntil: null` and a `validityWindowError` that names the field. Readiness fails with `Active attestation <id> has no valid validity window (<reason>); readiness fails until an authority records a fresh attestation.`, and the remedy is the same fresh attestation. If the record also fails its record integrity check, readiness reports that instead.

A repository with no attestation yet, or with only the `.veritas/attestations/PENDING` marker that a non-interactive `init` writes, is a different case. No authority has approved its standards yet, so readiness reports a `WARN` and does not block until the bootstrap attestation is recorded.

Releases before this change reported an expired attestation as a `WARN` and passed readiness; see [MIGRATING](../MIGRATING.md#expired-attestations-fail-readiness).

## Record Integrity

Each attestation that `veritas attest` writes carries `recordIntegrity`: an `algorithm`, currently `veritas-attestation-record-v1`, and a `digest`, the SHA-256 of every other field of the record with keys sorted at every level. That covers the actor, `notes`, `metadata.approvalRef`, and the protected standards hashes. Status recomputes the digest and reports `recordIntegrity.status`:

- `verified`: the record is as it was written.
- `mismatch`: the record was edited after it was written. The status is `tampered`, drift names `recordIntegrity`, and readiness fails. Restore the file as it was committed. To correct a record, record a new attestation instead of editing the old one.
- `unsupported-algorithm`: the record names an algorithm this Veritas version cannot verify. The status is `unverifiable`, and readiness fails until you run a version that supports it.
- `unbound`: the record predates record integrity. It stays `current`, because every attestation recorded before this release has this form, and the readiness PASS line says that its fields are not bound. The next attestation you record is bound.

The digest is not a signature. It lives in the record it covers, so it catches an edit that leaves the digest alone, but not one that recomputes it, and deleting `recordIntegrity` turns a bound record into an unbound one. The commit history of `.veritas/attestations/` remains the record of who changed a file.

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
