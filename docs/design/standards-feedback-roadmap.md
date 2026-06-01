# Standards Feedback Roadmap

This roadmap is the practical build plan for Standards Feedback.

## Phase 1: Observe

Goal:

- measure usefulness without changing enforcement

Build:

- standards feedback draft capture
- standards feedback record capture
- rollout settings capture
- simple outcome summaries
- shipped CLI path from generated evidence to feedback artifacts
- optional command-level telemetry export only after artifact semantics are stable

Questions answered:

- which requirements create the most exceptions?
- which evidence fields help reviewers most?
- where is Veritas still missing coverage?

## Phase 2: Guide

Goal:

- tune repo standards using collected feedback

Build:

- requirement-noise summaries
- recommendations about what to require, soften, retire, or clarify
- clearer reviewer-facing evidence summaries

Questions answered:

- which guided requirements should stay guidance?
- which requirements are reliable enough to require?
- which requirements should be split or rewritten?

## Phase 3: Require

Goal:

- let proven requirements become stronger enforcement

Build:

- promotion criteria based on repeated feedback outcomes
- Repo Standards settings for how strict CI should be
- explicit authority requirements for moving requirements to stronger enforcement

Questions answered:

- which requirements have earned blocking trust?
- which evidenceChecks should be mandatory before promotion?
- when should guidance block in CI for this repo?

## Later

These can wait until Veritas has real Standards Feedback history:

- Console views
- hosted analytics
- model fine-tuning loops
- automatic recommendation generation

If telemetry is added before Console views, it should stay downstream from canonical artifacts and use command-level spans or events rather than a synthetic end-to-end lifecycle trace.

The early goal is to learn what guidance actually works.
