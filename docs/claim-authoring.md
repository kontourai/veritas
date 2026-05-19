# Claim Authoring

Claims are authored once in `veritas.claims.json`, committed to the repository, and stable across runs. Veritas loads them at run time and collects evidence against those stable claim IDs. Surface derives trust status from the evidence and policies.

## Getting Started

Scaffold a claim store from your repo configuration:

```bash
veritas claim init
git add veritas.claims.json
```

## Managing Claims

Use `veritas claim` to maintain the store:

```bash
veritas claim list
veritas claim add --type software-proof --surface veritas.proof-lane --subject-type repository --subject-id my-repo --field "npm test" --metadata '{"command":"npm test"}'
veritas claim edit --claim-id my-repo.veritas-proof-lane.npm-test --impact high
veritas claim remove --claim-id my-repo.veritas-proof-lane.npm-test
veritas claim validate
```

Claims without evidence collected in a given run retain their previous status through the staleness model rather than disappearing. Run artifacts are dynamic; claims are stable declarations owned by the repository.

If you are upgrading from an older version that generated claims per run, see [MIGRATING.md](./MIGRATING.md).
