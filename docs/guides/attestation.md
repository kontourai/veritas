# Human Attestation

Veritas treats `.veritas/repo.adapter.json`, `.veritas/policy-packs/`, and `.veritas/team/` as Zone 1 governance. These files can be edited like normal code, but a human has to attest the resulting governance state before shadow runs consider it current.

## First attestation

After `veritas init`, record the initial human approval:

```bash
npx @kontourai/veritas attest bootstrap --actor <human-id> --non-interactive
```

This writes `.veritas/attestations/<id>.attestation.json` and updates `.veritas/attestations/HEAD`. The attestation stores hashes of the active adapter, policy pack, and team profile plus the human actor and validity window.

## Policy change

When a Zone 1 file changes, `veritas run` emits `FAIL policy-changes-require-attestation` until the change is reviewed:

```bash
npx @kontourai/veritas attest policy-change \
  --actor <human-id> \
  --message "Reviewed rule staging update"
```

Policy-change attestations chain to the previous attestation through `priorAttestationId`, so reviewers can see the approval history.

## Status

Use status when a run warns about missing, drifted, or expired governance:

```bash
npx @kontourai/veritas attest status
```

Expired attestations warn without implying drift. Drifted attestations fail shadow runs because the current Zone 1 hashes no longer match the human-approved hashes.

## Surface claims

Policy packs, repo adapters, and team profiles are sources of governance claims, not literal Surface claims. During `veritas run`, Veritas projects their evaluated state into `surface.input`: policy-pack integrity/currentness, adapter integrity/applicability, team-profile integrity/currentness, and human attestation currency.

That means operational proof can pass while governance claims are stale or disputed. If tests pass but Veritas fails, the governance artifact deciding what counts as trusted changed and needs human review plus a fresh attestation.
