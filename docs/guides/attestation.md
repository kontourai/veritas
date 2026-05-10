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
