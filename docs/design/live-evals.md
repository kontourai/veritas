# Live Evals

Live evals are how the framework learns whether its guidance is actually helping.

The framework already knows:

- what part of the repo changed
- what policy applied
- what proof lane ran

That evidence gets stronger when the source is explicit about what it measured:

- explicit files
- a branch diff
- the current working tree

Live eval adds the missing layer:

- **was the guidance useful**
- **did the human accept the result**
- **which rules created friction**
- **which misses still slipped through**

## The Simple Idea

For every AI-guided run, keep two records:

1. an **evidence record** for what happened during the run
2. an **eval record** for how that run turned out afterward

That second record is what lets the framework measure effectiveness instead of only intent.

The first operational workflow should stay explicit:

1. run `report`
2. review the evidence artifact
3. run `eval draft` against that artifact
4. run `eval record --draft ...`

That capture path should enforce provenance, not merely suggest it:

- repo-local evidence artifact
- repo-local eval draft artifact
- copied source metadata and immutable digest
- team-profile-aware reviewer confidence
- explicit overwrite only with `--force`

## What Should Be Measured

The first live-eval version should stay practical.

Measure:

- `accepted_without_major_rewrite`: did the team mostly keep the AI output?
- `time_to_green_minutes`: how long did it take to reach an accepted, verified state?
- `override_count`: how often did humans bypass or waive framework guidance?
- `false_positive_rules`: which rules were too strict for this run?
- `missed_issues`: what did the framework fail to catch?
- `reviewer_confidence`: did the evidence artifact make review easier?

This is enough to tell whether the framework is reducing work or only moving it around.

## Why This Matters

Without live eval, teams tend to argue from anecdotes:

- "this rule feels noisy"
- "the agent seems better now"
- "review still takes too long"

With live eval, those become measurable questions.

- Which rule produces the most waivers?
- Which lane reaches green fastest?
- Which misses keep showing up in human review?
- Which guidance patterns correlate with faster acceptance?

That is the bridge from framework intuition to framework proof.

## Team Tuning

The goal is not to make every team behave the same way.

The goal is to let each team tune the framework while keeping the structure stable.

That is why live eval pairs with a **team profile**:

- the eval record captures what happened
- the team profile captures how a team wants the framework to behave

Examples of team-level tuning:

- how strict new rules should be by default
- whether warnings should block in CI
- what counts as a major rewrite
- when human signoff is required
- which proof lanes are mandatory before promotion

## Recommended Rollout

Keep the rollout staged.

### Phase 1: Shadow Mode

Collect eval records without changing enforcement.

Use this phase to learn:

- which rules are noisy
- which evidence fields matter to reviewers
- where the framework is still missing coverage

The first shipped capture path should stay lightweight and manual enough that teams can trust it:

- one evidence artifact in
- one eval artifact out
- no hidden blocking behavior

### Phase 2: Assist Mode

Use the eval data to calibrate warnings and recommendations.

This phase should help teams:

- soften noisy rules
- promote reliable rules
- improve evidence summaries

### Phase 3: Gate Mode

Only after a rule has proven useful in practice should it become a stronger gate.

That keeps the framework from hardening around assumptions that were never validated.

## Differentiator

Most AI tooling stops at generation, orchestration, or pass/fail checks.

This framework can become different because it can answer:

- what did the AI do?
- what policy applied?
- what proof ran?
- how did that guidance perform for this team over time?

That combination of **focus**, **auditability**, and **measurable tuning** is the real differentiator.
