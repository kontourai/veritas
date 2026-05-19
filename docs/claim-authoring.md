# Claim Authoring

Veritas now requires an authored claim store at `veritas.claims.json` before it can emit `surface.input`.

This is a version break. Previous per-run claim generation is not supported as an alternate mode. Migrate by creating and committing a claim store:

```bash
veritas claim init
git add veritas.claims.json
```

Use `veritas claim` to maintain the store:

```bash
veritas claim list
veritas claim add --type software-proof --surface veritas.proof-lane --subject-type repository --subject-id my-repo --field "npm test" --metadata '{"command":"npm test"}'
veritas claim edit --claim-id my-repo.veritas-proof-lane.npm-test --impact high
veritas claim remove --claim-id my-repo.veritas-proof-lane.npm-test
veritas claim validate
```

Per run, Veritas loads authored claims from `veritas.claims.json` and collects evidence against those claim IDs. Surface then derives status from the evidence and policies.

## Migration Notes

For repos upgrading from a version that emitted claims from each run:

1. Run `veritas claim init`.
2. Review generated claim IDs, surfaces, policies, and metadata.
3. Commit `veritas.claims.json`.
4. Update any automation that expected run-scoped claim IDs to use stable authored claim IDs.

Run artifacts remain dynamic. Claims are stable declarations owned by the repository.
