# Getting Started

This guide is written for the end user of the framework, not the framework maintainer.

The goal is simple:

- give your AI a bounded map of the repo
- define the few rules that actually matter
- emit an evidence artifact that a human can trust quickly

## Mental Model

Use the framework as:

1. **adapter**: "what parts of this repo exist and how should they be grouped?"
2. **policy pack**: "what do we require, prefer, or still treat as brittle?"
3. **evidence**: "what did the AI touch, what lane did that map to, and what proof do we have?"

If you keep those three concepts separate, the system stays understandable.

## Minimal Onboarding

You do not need a giant rollout.

Start with:

1. one adapter
2. one policy pack
3. one proof lane
4. one executable rule

That is enough to make the framework useful.

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
node bin/ai-guidance-report.mjs \
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

## Why Teams Care

This structure helps because it creates a better contract between AI and humans.

- **For the AI:** it reduces search space and ambiguity.
- **For reviewers:** it shortens the audit path from "read the whole diff" to "inspect the evidence, the affected lane, and the policy result."
- **For the organization:** it turns repo knowledge into reusable policy instead of tribal memory.

That is the differentiator.

The point is not only to make agents faster.
The point is to make them easier to trust.
