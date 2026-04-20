# Policy Packs

Policy packs are the part of the framework that answers:

> "What does this repo currently consider acceptable, mandatory, or still too brittle to trust?"

They are intentionally separate from the framework core and from repo adapters.

## Why They Exist

Without policy packs, teams usually end up with one of two bad outcomes:

- all guardrails are buried in bespoke scripts, so nobody can tell which rules are durable and which are temporary
- all rules are flattened into one severity level, so advisory guidance and hard invariants get treated the same way

Policy packs make rule intent explicit.

## Rule Classes

- `hard-invariant`: a rule the repo cannot silently drift from
- `promotable-policy`: a strong preference that may later become a hard invariant
- `advisory-pattern`: a useful pattern worth surfacing without hard blocking
- `brittle-implementation-check`: a temporary source-shape rail that should eventually be replaced with a stronger semantic check

## Enforcement Stages

- `recommend`: surface guidance without blocking
- `warn`: make drift visible and expensive to ignore
- `block`: treat the rule as a gate

The point of keeping both **classification** and **stage** is that they answer different questions.

- Classification answers: "what kind of rule is this?"
- Stage answers: "how hard should we enforce it right now?"

## Operator Value

Policy packs help with three things:

- **AI focus:** the agent can tell which repo constraints are real and which are still transitional
- **auditability:** reviewers can inspect the active rules without reading a long bespoke script
- **evolution:** teams can promote or soften rules deliberately instead of rewriting enforcement logic from scratch

## Current State

In this repo, the first executable policy-pack rule class is `required-repo-artifacts`.

That rule is intentionally simple:

- it is easy for humans to reason about
- it is easy for CI to prove
- it demonstrates the difference between "policy-pack metadata exists" and "the framework evaluates a policy"

Use [policy-packs/work-agent-convergence.policy-pack.json](../../policy-packs/work-agent-convergence.policy-pack.json) as the reference example.
