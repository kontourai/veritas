# Attestation

An attestation is authority-backed evidence that something was verified, accepted, approved, or reviewed.

In Veritas, attestations protect the parts of the repo standards and repo map that define what good looks like, where boundaries are, and who or what can verify requirements. The goal is not to make humans approve every routine change. The goal is to keep the definition of good from changing without trusted authority.

## Bootstrap Attestation

After `veritas init`, review the generated standards and map, then record the first attestation:

```bash
npx @kontourai/veritas attest bootstrap --actor <authority-id> --non-interactive
```

The current implementation records hashes for the files that hold protected standards state:

- `.veritas/repo.adapter.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/team/default.team-profile.json`

Product language should describe them as the Repo Map and Repo Standards.

## Standards Change Attestation

When protected standards change, record a successor attestation:

```bash
npx @kontourai/veritas attest policy-change \
  --actor <authority-id> \
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
