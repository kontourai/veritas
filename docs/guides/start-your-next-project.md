# Start Your Next Project With Veritas

Starting a new project with Veritas should feel simple:

- define starter repo standards
- map the obvious work areas and boundaries
- choose the first evidenceCheck
- give agents the right change guidance from day one

The goal is not to model everything before the first commit. The goal is to make the repo's expectations executable before tribal knowledge starts drifting.

## Bootstrap

```bash
npm install -D @kontourai/veritas
npx @kontourai/veritas init
```

That command writes starter files under `.veritas/`, including generated files for the Repo Map, Repo Standards, and protected standards metadata.

For agent-guided setup, use the plan-first variant:

```bash
npx @kontourai/veritas init --explore --output .veritas/init-plans/first-pass.json
npx @kontourai/veritas init --guided --answers answers.json --output .veritas/init-plans/guided.json
npx @kontourai/veritas init --apply --plan .veritas/init-plans/guided.json
```

The conversation can be flexible, but `--apply --plan` remains the reviewed write path.

## Minimum Useful Setup

Start with:

- one Repo Map
- one small set of Repo Standards
- one Evidence Check
- one Required or Guided requirement that catches a real review issue

That is enough to make Veritas useful without overbuilding.

## What Bootstrap Should Infer

The setup flow should identify:

- project type
- likely source roots
- likely test roots
- obvious work areas
- protected standards files
- first evidenceCheck
- AI instruction targets
- release or CI expectations

Anything uncertain should start as guidance or observation, not a hard requirement.

## Safe Defaults

Use the enforcement ladder:

- **Observe** first for uncertain requirements.
- **Guide** when the requirement is useful but still being tuned.
- **Require** when the evidenceCheck and authority model are trusted.

For protected standards, record an attestation after the generated files have been reviewed:

```bash
npx @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
```

## What To Do Today

1. Run `npx @kontourai/veritas init`, or use the guided plan-first flow.
2. Review the generated `.veritas/` files.
3. Replace the default evidenceCheck with the command that proves repo health.
4. Run `npx @kontourai/veritas readiness --working-tree`.
5. Use `npx @kontourai/veritas explain --file <path>` to inspect change guidance.
6. Add CI or runtime hooks only after the basic readiness check is useful.
7. Use `npx @kontourai/veritas feedback summary` later to review standards feedback.

Use `--changed-from <ref> --changed-to <ref>` when you want branch-diff evidence instead of current working-tree evidence.

If you want concrete payload examples before generating your own repo-local artifacts, inspect [Example Fixtures](../reference/examples.md).
