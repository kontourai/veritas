# Live Eval Roadmap

This roadmap is the practical build plan for adding live eval to the framework.

It is written for people deciding what to build next, not only for framework maintainers.

## Phase 1: Shadow Mode

Goal:

- measure usefulness without changing enforcement

Build:

- eval record capture
- eval draft capture
- team profile capture
- simple outcome summaries
- shipped CLI path from report artifact to eval artifact

Questions answered:

- which rules create the most waivers?
- which evidence fields help reviewers most?
- where is the framework still missing coverage?

## Phase 2: Assist Mode

Goal:

- tune the framework using the collected data

Build:

- rule-noise summaries
- guidance about what to promote, soften, or clarify
- clearer reviewer-facing evidence summaries

Questions answered:

- which warnings should stay warnings?
- which policies are reliable enough to harden?
- which rules should be split or rewritten?

## Phase 3: Gate Mode

Goal:

- let proven policy become stronger enforcement

Build:

- promotion criteria based on repeated eval outcomes
- team-profile controls for how strict CI should be
- explicit signoff requirements for moving rules to harder stages

Questions answered:

- which rules have earned block-level trust?
- which proof lanes should be mandatory before promotion?
- when should warnings block in CI for this team?

## What Comes Last

These can wait until the framework has real live-eval history:

- dashboards
- hosted analytics
- model fine-tuning loops
- automatic rule promotion

The early goal is not complexity.
The early goal is to learn what guidance actually works.
