# Dogfooding Veritas

This repo uses `veritas` on itself as a normal consumer.

The goal is not to make the framework special-case its own repo. The goal is to prove that the normal adapter, policy-pack, evidence, and eval flow are useful on a real codebase that ships the framework.

## What Is Tracked

- `.veritas/README.md`
- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`
- `.veritas/team/default.team-profile.json`

These are the repo-local instructions and policy artifacts that make self-hosting reviewable.

## What Is Not Tracked

- `.veritas/evidence/`
- `.veritas/eval-drafts/`
- `.veritas/evals/`

Those outputs are local and disposable. They should inform product work, not create distribution churn.

## Main Commands

Use the repo-local dogfood lane through:

```bash
npm run veritas:proof
npm run veritas:dogfood:report
npm run veritas:dogfood:shadow
npm run veritas:dogfood:checkin
npm run veritas:dogfood:examples
npm run veritas:dogfood:prove
```

Tracked automation also exists in [.github/workflows/veritas-dogfood.yml](../../.github/workflows/veritas-dogfood.yml). It runs on pull requests, pushes to `main`, manual dispatch, and a weekly schedule.

## What This Repo Proves

The self-hosting lane currently proves four things:

1. the repo-local adapter can classify the framework repo without unresolved files
2. the repo-local policy pack can evaluate concrete artifact presence for the shipped Veritas surface
3. the report artifact now includes evaluated `policy_results`, not only policy-pack provenance
4. the repo ships committed example report and eval artifacts under `examples/dogfood/`

The automated check-in path adds two more things:

5. the repo emits a machine-readable snapshot under `.veritas/checkins/` during automation runs
6. the workflow uploads evidence, eval drafts, and check-in artifacts so future runs can be inspected without committing local state

## Where To Inspect The Proof

- [examples/dogfood/veritas-repo-report.json](../../examples/dogfood/veritas-repo-report.json)
- [examples/dogfood/veritas-repo-report.md](../../examples/dogfood/veritas-repo-report.md)
- [examples/dogfood/veritas-repo-eval-draft.json](../../examples/dogfood/veritas-repo-eval-draft.json)
- [examples/dogfood/veritas-repo-eval.json](../../examples/dogfood/veritas-repo-eval.json)

For future check-ins:

- run `npm run veritas:dogfood:checkin` locally
- inspect the uploaded artifacts from the `Veritas Dogfood` GitHub Actions workflow
- use the suggested eval command emitted by the check-in when you want to turn an automated snapshot into a human-scored eval record

If this dogfood flow feels awkward, the fix should usually land in the product surface, not in a repo-specific framework exception.
