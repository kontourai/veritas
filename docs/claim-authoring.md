# Claim Authoring

Claims are authored once in `veritas.claims.json`, committed to the repository, and stable across runs. Veritas loads them at run time and collects evidence against those stable claim IDs. Surface derives trust status from the evidence and policies.

## Getting Started

Scaffold a claim store from your repo configuration:

```bash
npx --no @kontourai/veritas claim init
git add veritas.claims.json
```

## Managing Claims

Use the `claim` subcommand to maintain the store:

```bash
npx --no @kontourai/veritas claim list
npx --no @kontourai/veritas claim add --type software-evidence-check --facet veritas.evidence-check --subject-type repository --subject-id my-repo --field "npm test" --metadata '{"command":"npm test"}'
npx --no @kontourai/veritas claim edit --claim-id my-repo.veritas-evidence-check.npm-test --impact high
npx --no @kontourai/veritas claim remove --claim-id my-repo.veritas-evidence-check.npm-test
npx --no @kontourai/veritas claim validate
```

Claims without evidence collected in a given run retain their previous status through the staleness model rather than disappearing. Run artifacts are dynamic; claims are stable declarations owned by the repository.

If you are upgrading from an older version that generated claims per run, see [MIGRATING.md](./MIGRATING.md).
