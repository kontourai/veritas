# Operational Check-ins

This repo uses `veritas` on itself through the same operational check-in flow a normal consumer repo would use.
That makes this guide a safe place to validate the PR comment format on a temporary branch.

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

Use the repo-local check-in lane through:

```bash
npm run veritas:proof
npm run veritas:checkin:report
npm run veritas:checkin:shadow
npm run veritas:checkin
npm run veritas:checkin:examples
npm run veritas:checkin:prove
```

Tracked automation also exists in [.github/workflows/veritas-checkins.yml](../../.github/workflows/veritas-checkins.yml). It runs on pull requests, pushes to `main`, manual dispatch, and a weekly schedule.

## What This Repo Proves

The self-hosting lane currently proves four things:

1. the repo-local adapter can classify the framework repo without unresolved files
2. the repo-local policy pack can evaluate concrete artifact presence for the shipped Veritas surface
3. the report artifact now includes evaluated `policy_results`, not only policy-pack provenance
4. the repo ships committed example report and eval artifacts under `examples/checkins/`

The automated check-in path adds two more things:

5. the repo emits a machine-readable snapshot under `.veritas/checkins/` during automation runs
6. the workflow uploads evidence, eval drafts, and check-in artifacts so future runs can be inspected without committing local state

The workflow also elevates the result:

7. pull requests get a sticky Veritas check-in comment with the latest check-in summary
8. non-PR runs update a standing `Veritas Health` issue when health is not green, and close it again when health recovers

## Where To Inspect The Proof

- [examples/checkins/veritas-repo-report.json](../../examples/checkins/veritas-repo-report.json)
- [examples/checkins/veritas-repo-report.md](../../examples/checkins/veritas-repo-report.md)
- [examples/checkins/veritas-repo-eval-draft.json](../../examples/checkins/veritas-repo-eval-draft.json)
- [examples/checkins/veritas-repo-eval.json](../../examples/checkins/veritas-repo-eval.json)
- [examples/checkins/veritas-repo-checkin-red.json](../../examples/checkins/veritas-repo-checkin-red.json)
- [examples/checkins/veritas-repo-checkin-red.md](../../examples/checkins/veritas-repo-checkin-red.md)

For future check-ins:

- run `npm run veritas:checkin` locally
- inspect the uploaded artifacts from the `Veritas Check-ins` GitHub Actions workflow
- inspect the PR comment on pull requests
- inspect the `Veritas Health` issue for scheduled or `main`-branch regressions
- use the suggested eval command emitted by the check-in when you want to turn an automated snapshot into a human-scored eval record

If this check-in flow feels awkward, the fix should usually land in the product surface, not in a repo-specific framework exception.
