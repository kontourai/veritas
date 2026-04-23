# Concepts

This page walks through the core ideas behind Veritas. Each section builds on the last. By the end, you will understand how the pieces fit together and why the system is designed the way it is.

---

## The Core Idea

AI agents can write code, refactor modules, and propose fixes — but they have no inherent knowledge of what your repo considers mandatory, what proof is required before a change ships, or whether their guidance actually helped your team. Veritas solves this by making the repo itself the source of truth. You define what matters (the adapter), what proof is required (policy pack), what happened (evidence), and whether it helped (evals). No centralized control plane. No tribal knowledge encoded in a Slack thread. The repo ships its own trust infrastructure, and every AI agent that reads it gets the same structured context.

---

## Repo Map (The Adapter)

Your repo has different kinds of code. Product features, shared utilities, tests, CI configuration — they have different owners, different risk profiles, and different proof requirements. A change to a shared contract surface deserves stricter scrutiny than a change to an internal example.

The adapter is a JSON file at `.veritas/repo.adapter.json` that maps your repo into named nodes. Each node has a kind — `product-surface`, `shared-contract-surface`, `verification-surface`, `governance-surface`, `tooling-surface`, `delivery-surface`, `shared-package`, or `example-surface`. Pattern matching routes files to nodes, and each node specifies which proof lanes apply to it.

A change to `src/api/` might route to a node named `api`, which requires the `unit-test` and `lint` proof lanes. A change to `examples/` routes to an `example-surface` node with lighter requirements. This routing is explicit and repo-local — no conventions inferred from directory names, no guessing.

For deeper detail, see [Framework Core vs Adapter](design/framework-core-vs-adapter.md).

---

## Rules (The Policy Pack)

Some things in your repo must never break. Others are strong preferences that you hope to harden over time. Others are temporary guardrails holding a refactor in place while you migrate.

The policy pack is a JSON file at `.veritas/policy-packs/default.policy-pack.json`. It holds rules with two properties that answer different questions:

- **Classification** answers what kind of rule this is: `hard-invariant`, `promotable-policy`, `advisory-pattern`, or `brittle-implementation-check`.
- **Stage** answers how hard to enforce it right now: `recommend`, `warn`, or `block`.

A `required-repo-artifacts` rule might be a `hard-invariant` at `block` stage — it ensures critical files like `package.json` always exist, and it gates CI. A `prefer-named-exports` rule might be an `advisory-pattern` at `recommend` stage — it surfaces guidance without blocking anything. The distinction matters because it keeps hard invariants and transitional guardrails from collapsing into a single undifferentiated list.

For deeper detail, see [Policy Packs](design/policy-packs.md).

---

## Evidence (The Artifact)

After an AI agent makes changes, someone has to review them. Without structure, that means scanning the entire diff and hoping nothing important was missed.

Running `veritas report` generates a structured JSON evidence artifact. It captures which files changed, which nodes in the repo map were affected, which proof commands ran, and which policy rules passed or failed. The reviewer gets a bounded summary instead of a raw diff — a surface with edges rather than an open field.

Evidence artifacts live in `.veritas/evidence/`. The source for generating them can be explicit files, a branch diff, the working tree, or staged changes. The source kind is recorded in the artifact, so the reviewer always knows what was measured and how.

For schema details, see [Artifacts and Schemas](reference/artifacts-and-schemas.md).

---

## Feedback (Live Evals)

How do you know if the framework is actually helping? Not theoretically — measurably.

After reviewing an evidence artifact, an operator records an eval. Did they accept the output? How long did it take to reach a verified state? How many overrides did they need? How confident were they in the result? These questions have structured answers — eval records are JSON, not free-text retros. The framework tracks acceptance rate, time-to-green, override count, false positive rate, missed issues, and reviewer confidence.

The key insight is that evidence records capture what happened during the AI-guided run; eval records capture how that run turned out afterward. The second record is what lets you measure effectiveness instead of only intent.

For deeper detail, see [Live Evals](design/live-evals.md).

---

## Rollout: Shadow, Assist, Enforce

Veritas moves through three rollout phases, and you control the pace.

- **Shadow**: the framework runs alongside normal work, generating evidence and collecting evals, with no enforcement. You learn what the rules would have caught before you give them any teeth.
- **Assist**: rules begin influencing behavior. Operators can waive individual violations, but drift is visible and tracked.
- **Enforce**: rules gate CI. Violations block merges until addressed or explicitly overridden with a recorded justification.

Team profiles in `.veritas/` control which phase applies and how confidence thresholds and signoff expectations scale with it.

Start with shadow. You never have to move to enforce until the eval data tells you it is safe to do so.

For a step-by-step rollout approach, see [Tune the Framework for Your Team](guides/tune-for-your-team.md).

---

## How It Activates

Veritas has three activation modes, from lightest to most integrated.

- **Ambient**: the AI agent reads `.veritas/` files as part of normal repo context. No explicit invocation needed. The adapter and policy pack are already there, and a capable agent will use them to shape its output.
- **Explicit**: an operator runs CLI commands — `veritas report`, `veritas shadow run`, `veritas eval draft` — to generate artifacts and record evals on demand.
- **CI**: evidence generation and policy evaluation run in GitHub Actions, gating pull requests against the policy pack automatically.

The lightest integration is ambient. Just having the files in your repo gives AI agents structured context about what the repo considers important. The heavier integrations layer on top of that without replacing it.

For wiring details, see [Agent Activation](design/agent-activation.md).

---

## Putting It Together

The full loop is short:

1. The adapter maps the repo into named nodes with proof requirements.
2. An AI agent makes changes.
3. `veritas report` generates an evidence artifact from those changes.
4. The policy pack evaluates rules against the evidence.
5. A reviewer inspects the bounded artifact instead of the raw diff.
6. The operator records an eval against the artifact.
7. Over time, eval data informs which rules to tighten, which to relax, and whether the evidence surface is actually reducing review effort.

Each piece is a separate JSON file. Each file is repo-local and version-controlled. Nothing is inferred from conventions or hidden in a control plane.

For hands-on setup, start with the [Getting Started guide](guides/getting-started.md). For CLI details, see the [CLI Reference](reference/cli.md).
