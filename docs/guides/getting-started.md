# Getting Started

This guide is written for the end user of the framework, not the framework maintainer.

The goal is simple:

- give your AI a bounded map of the repo
- define the few rules that actually matter
- emit an evidence artifact that a human can trust quickly

This guide is about installation and use first.
Framework development belongs in `CONTRIBUTING.md`.

If your next question is "how does this turn on for the AI?", read [Agent Activation](../design/agent-activation.md) after this guide.

## Mental Model

Use the framework as:

1. **adapter**: "what parts of this repo exist and how should they be grouped?"
2. **policy pack**: "what do we require, prefer, or still treat as brittle?"
3. **evidence**: "what did the AI touch, what lane did that map to, and what proof do we have?"
4. **live eval**: "did this guidance actually help the team?"

If you keep those three concepts separate, the system stays understandable.

## Minimal Onboarding

You do not need a giant rollout.

Start with:

1. one adapter
2. one policy pack
3. one proof lane
4. one executable rule

That is enough to make the framework useful.

## Install First

The install path should feel boring:

```bash
npm install
```

Then verify the repo artifacts:

```bash
npm run verify
npm test
```

If those pass, move straight into adapter + policy-pack setup.

## Bootstrap The Repo

The fastest way to start is:

```bash
npm exec -- ai-guidance init
```

That gives you a starter adapter, policy pack, team profile, and local README under `.ai-guidance/`.

The bootstrap README also tells you what the framework inferred about the repo so you can confirm or correct it right away.

## Step 1: Create an Adapter

An adapter should answer:

- what are the meaningful repo surfaces?
- what proof lane do changes need?
- how should unresolved files be treated?

Use [adapters/work-agent.adapter.json](../../adapters/work-agent.adapter.json) as the richer example and [adapters/demo-docs-site.adapter.json](../../adapters/demo-docs-site.adapter.json) as the smaller one.

## Step 2: Create a Policy Pack

A policy pack should start small.

Prefer:

- one `hard-invariant` rule that must never drift
- one `promotable-policy` rule that captures a strong preference
- one `brittle-implementation-check` rule only if you need a temporary safety rail during refactoring

The first executable rule in the framework is `required-repo-artifacts`. It is useful because it is easy to explain, easy to audit, and clearly tied to repo safety.

## Step 3: Generate Evidence

Run the CLI with your adapter and policy pack:

```bash
npm exec -- ai-guidance report \
  --root /path/to/repo \
  --adapter ./adapters/work-agent.adapter.json \
  --policy-pack ./policy-packs/work-agent-convergence.policy-pack.json \
  --run-id local-smoke \
  package.json
```

The output gives you:

- resolved phase and workstream
- affected nodes and lanes
- proof-lane status
- policy-pack provenance
- a durable evidence artifact for review or CI

If you want to start Phase 1 live eval, capture a shadow eval from that evidence artifact:

```bash
npm exec -- ai-guidance eval draft \
  --evidence .ai-guidance/evidence/local-smoke.json

npm exec -- ai-guidance eval record \
  --draft .ai-guidance/eval-drafts/local-smoke.json \
  --accepted-without-major-rewrite true \
  --required-followup false \
  --reviewer-confidence high \
  --time-to-green-minutes 12 \
  --override-count 0
```

That keeps the workflow explicit:

1. report what happened
2. then record how useful that guidance was afterward

The eval step stays conservative:

- the evidence input must be repo-local under `.ai-guidance/evidence/`
- the draft artifact stays repo-local under `.ai-guidance/eval-drafts/`
- reviewer confidence should match the team profile scale, or use `unknown`
- existing eval artifacts are not overwritten unless you pass `--force`

If you want current-state truth instead of an explicit file list, use one of the working-tree modes:

```bash
npm exec -- ai-guidance report --working-tree
npm exec -- ai-guidance report --staged
npm exec -- ai-guidance report --unstaged --untracked
```

If you want branch-diff truth, keep using explicit refs:

```bash
npm exec -- ai-guidance report --changed-from main --changed-to HEAD
```

## Step 4: Add Live Eval Later, Not First

Do this only after the first three steps are working.

Add:

1. one team profile
2. one eval record example
3. `shadow` mode as the default rollout

That lets you measure usefulness before you harden more rules.

If you want that next, read [Tune The Framework For Your Team](./tune-for-your-team.md) and [Live Evals](../design/live-evals.md).

## Start The Next Project This Way

If you are setting up a brand-new repo, the next guide to read is [Start Your Next Project With AI Guidance](./start-your-next-project.md).

## Why Teams Care

This structure helps because it creates a better contract between AI and humans.

- **For the AI:** it reduces search space and ambiguity.
- **For reviewers:** it shortens the audit path from "read the whole diff" to "inspect the evidence, the affected lane, and the policy result."
- **For the organization:** it turns repo knowledge into reusable policy instead of tribal memory.

That is the differentiator.

The point is not only to make agents faster.
The point is to make them easier to trust.
