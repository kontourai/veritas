# Standards Feedback

This document describes the current **Standards Feedback** mechanics.

Standards feedback is how Veritas learns whether the repo standards are helping, missing coverage, creating noise, or failing to catch important issues.

## Simple Idea

For every AI-guided run, keep two records:

1. generated evidence for what happened during the run
2. standards feedback for how that run turned out afterward

That second record lets Veritas measure effectiveness instead of only intent.

The current CLI command group is:

```bash
veritas eval draft
veritas eval record
veritas eval summary
veritas eval recommend
```

These commands are the current standards-feedback and standards-recommendation surfaces.

## What To Measure

Measure:

- whether the team mostly kept the AI-authored output
- time to reach a green/readiness state
- exception frequency
- noisy requirements
- missed issues
- whether generated evidence made review easier
- which change guidance patterns correlate with faster acceptance

This is enough to tell whether Veritas reduces review work or only moves it around.

## Recommendations

Standards feedback should produce standards recommendations such as:

- add a requirement for uncovered work
- clarify change guidance
- lower a noisy requirement from Require to Guide
- move a useful requirement from Guide to Require
- retire a stale evidenceCheck
- add a recheck trigger
- update the repo map for unmapped files

Recommendations are not automatic policy mutation. They are reviewable suggestions backed by generated evidence.

## Rollout

Use the enforcement ladder:

- **Observe**: collect feedback without changing behavior.
- **Guide**: use feedback to improve just-in-time correction.
- **Require**: only require what has proven useful and trustworthy.

This is the bridge from static repo rules to earned merge autonomy.
