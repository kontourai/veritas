# Operational Readiness Summaries

This repo currently uses self-hosting scripts to dogfood Veritas on itself. They produce derived readiness, conformance, and standards-feedback summaries.

## What Is Tracked

The repo tracks protected standards inputs:

- `.veritas/README.md`
- `.veritas/repo-map.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/authority/default.authority-settings.json`

These file names currently hold the Repo Map, Repo Standards, and related protected standards settings.

## What Is Not Tracked

Generated evidence and read models are local or CI artifacts:

- `.veritas/evidence/`
- `.veritas/claims/`
- `.surface/runs/`
- `.veritas/external/`
- `.veritas/standards-feedback-drafts/`
- `.veritas/standards-feedback/`
- `.veritas/repo-conformance/`

They should inform product work, not create distribution churn.

## Main Commands

Current self-hosting scripts:

```bash
npm run veritas:evidence-check
npm run veritas:conformance:report
npm run veritas:conformance:readiness
npm run veritas:conformance
npm run veritas:conformance:examples
npm run veritas:conformance:verify
```

The outputs should be interpreted as generated evidence, readiness summaries, repo conformance summaries, and standards feedback.

## What This Repo Proves

The self-hosting flow should prove that:

1. the repo map classifies the Veritas repo without unresolved files
2. the repo standards evaluate concrete requirements for the product
3. generated evidence records what changed and what passed or failed
4. examples stay aligned with current schema
5. CI can publish readiness/conformance summaries without committing generated output
6. optional external evidence checks can be captured without becoming required before they are trusted

## Where To Inspect Current Examples

- [examples/repo-conformance/veritas-repo-report.json](../../examples/repo-conformance/veritas-repo-report.json)
- [examples/repo-conformance/veritas-repo-standards-feedback-draft.json](../../examples/repo-conformance/veritas-repo-standards-feedback-draft.json)
- [examples/repo-conformance/veritas-repo-standards-feedback.json](../../examples/repo-conformance/veritas-repo-standards-feedback.json)
- [examples/repo-conformance/veritas-repo-conformance-red.json](../../examples/repo-conformance/veritas-repo-conformance-red.json)

If this flow feels awkward, the fix should usually land in the product surface, not in a repo-specific exception.
