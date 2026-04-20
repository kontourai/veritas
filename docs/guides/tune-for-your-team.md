# Tune The Framework For Your Team

This guide is about making the framework fit your team without turning it into a one-off fork.

The easiest mistake is to change code every time something feels off.

Do this instead:

1. keep the framework structure stable
2. tune behavior through team-owned settings
3. use live-eval outcomes to decide what should change

## The Two Things To Adjust

Most teams only need to adjust two things:

- a **team profile** for how strict and review-heavy the framework should be
- the **policy pack** for what the repo currently considers mandatory or promotable

That gives you flexibility without losing auditability.

## What A Team Profile Should Control

A team profile is where you capture how your team likes to work.

Good examples:

- your default rollout mode: `shadow`, `assist`, or `gate`
- whether new rules start as recommendations or warnings
- whether warnings should block in CI for your team
- whether a reviewer must explicitly sign off before a rule can move to `block`
- how you score reviewer confidence
- what counts as a major rewrite for eval purposes

Bad examples:

- repo path mapping
- graph node definitions
- low-level framework internals

Those belong somewhere else.

## The Easiest Rollout

If you want the shortest path:

1. keep your existing adapter
2. keep your existing policy pack
3. add one team profile
4. start collecting eval records in `shadow` mode

That gives you feedback before it gives you friction.

## How To Decide What To Change

Use a simple decision loop:

### If a rule keeps getting waived

- lower the enforcement stage
- clarify the rule wording
- or split one fuzzy rule into two clearer ones

### If humans keep catching the same issue

- add a missing rule
- improve the evidence output
- or tighten an existing policy

### If the AI output is usually accepted but review still feels slow

- improve evidence summaries
- shrink the number of mandatory proof lanes
- or make the affected-node mapping clearer

## What Not To Tune First

Do not start with model fine-tuning.

Start with:

- rule severity
- proof-lane requirements
- team review expectations
- evidence fields that help reviewers move faster

That is lower risk and usually gives better signal sooner.

## What Success Looks Like

You know the framework is tuned well when:

- the AI stays inside the right repo lane more often
- reviewers can trust the evidence quickly
- waivers become less common
- the team can explain why a rule exists without reading a long script

That is the practical goal.
The framework should feel easier to trust, not harder to use.
