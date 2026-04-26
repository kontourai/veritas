# Getting Started

This guide is written for the end user of the framework, not the framework maintainer.

The goal is simple:

- give your AI a bounded map of the repo
- define the few rules that actually matter
- emit lint-style feedback that the agent can fix before it finishes
- keep evidence and eval history for human review

This guide is about installation and use first.
Framework development belongs in `CONTRIBUTING.md`.

If your next question is "how does this turn on for the AI?", read [Agent Activation](../design/agent-activation.md) after this guide.
If your next question is "what are the exact commands and generated files?", use [CLI Reference](../reference/cli.md) and [Artifacts and Schemas](../reference/artifacts-and-schemas.md).

## Mental Model

Use the framework as:

1. **rules**: "what does this repo require from AI-authored changes?"
2. **feedback**: "what should the agent fix right now?"
3. **improvement**: "did this guidance actually help the team?"

If you keep those concepts separate, the system stays understandable.

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
npm install -D @kontourai/veritas
npx @kontourai/veritas init
```

That gives you a starter adapter, policy pack, team profile, governance instruction file, local README under `.veritas/`, and marker-bounded governance blocks in AI instruction files.

The bootstrap README also tells you what the framework inferred about the repo so you can confirm or correct it right away.

For a repo where the first setup should be reviewed before anything is mutated, use the guided path:

```bash
npx @kontourai/veritas init --explore --output .veritas/init-plans/first-pass.json
npx @kontourai/veritas init --guided --answers answers.json --output .veritas/init-plans/guided.json
npx @kontourai/veritas init --apply --plan .veritas/init-plans/guided.json
```

The guided path is built for agent-led setup. Exploration and interview work can be rich, but the actual mutation still happens through `veritas init --apply --plan ...` after the plan artifact has been reviewed.

## Step 1: Create an Adapter

An adapter should answer:

- what are the meaningful repo surfaces?
- what proof lane do changes need?
- when different surfaces need different proof commands, which node IDs route to which proof lanes?
- how should unresolved files be treated?

Use [adapters/work-agent.adapter.json](../../adapters/work-agent.adapter.json) as the richer example and [adapters/demo-docs-site.adapter.json](../../adapters/demo-docs-site.adapter.json) as the smaller one.

## Step 2: Create a Policy Pack

A policy pack should start small.

Prefer:

- one `hard-invariant` rule that must never drift
- one `promotable-policy` rule that captures a strong preference
- one `brittle-implementation-check` rule only if you need a temporary safety rail during refactoring

Start with executable rules that are easy to explain:

- `artifacts`: required repo files must exist.
- `governance-block`: AI instruction files must contain the canonical Veritas block.
- `if-changed` plus `then-require`: if one path changes, a companion path must also change.

## Step 3: Generate Evidence

Run the CLI with your adapter and policy pack:

```bash
npx @kontourai/veritas report \
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

If you want proof plus agent-readable feedback, run:

```bash
npx @kontourai/veritas shadow run --working-tree
```

Then record a local eval when you know the outcome:

```bash

npx @kontourai/veritas eval draft \
  --evidence .veritas/evidence/local-smoke.json

npx @kontourai/veritas eval record \
  --draft .veritas/eval-drafts/local-smoke.json \
  --accepted-without-major-rewrite true \
  --required-followup false \
  --reviewer-confidence high \
  --time-to-green-minutes 12 \
  --override-count 0

npx @kontourai/veritas eval summary
```

Optional runtime installs still exist, but they are not required for the core product path:

```bash
npx @kontourai/veritas apply git-hook --configure-git
npx @kontourai/veritas apply stop-hook --tool generic
npx @kontourai/veritas apply runtime-hook
npx @kontourai/veritas print codex-hook --codex-home /path/to/.codex
npx @kontourai/veritas runtime status --codex-home /path/to/.codex
npx @kontourai/veritas apply codex-hook --codex-home /path/to/.codex
npx @kontourai/veritas apply codex-hook --target-hooks-file /path/to/hooks.json
```

That keeps the workflow explicit:

1. report what happened
2. then record how useful that guidance was afterward

The eval step stays conservative:

- `shadow run` is the shortest hook-friendly path for proof + report + draft
- if the adapter defines surface-aware proof routing, `shadow run` is also the shortest path to ensure the changed surfaces select the right proof commands
- `apply git-hook --configure-git` is the shortest tracked git-hook install path
- `apply runtime-hook` is the shortest tracked non-git hook install path
- `apply codex-hook --codex-home ...` is the shortest higher-level Codex hook merge path
- `print codex-hook --codex-home ...` is the shortest no-mutation preview path for that install target
- `runtime status` is the shortest cross-adapter diagnostic path
- when no `--codex-home` or `--target-hooks-file` is supplied, it should tell you that no Codex target was checked yet
- the evidence input must be repo-local under `.veritas/evidence/`
- the draft artifact stays repo-local under `.veritas/eval-drafts/`
- reviewer confidence should match the team profile scale, or use `unknown`
- existing eval artifacts are not overwritten unless you pass `--force`

If you want current-state truth instead of an explicit file list, use one of the working-tree modes:

```bash
npx @kontourai/veritas report --working-tree
npx @kontourai/veritas report --staged
npx @kontourai/veritas report --unstaged --untracked
```

If you want branch-diff truth, keep using explicit refs:

```bash
npx @kontourai/veritas report --changed-from main --changed-to HEAD
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

If you are setting up a brand-new repo, the next guide to read is [Start Your Next Project With Veritas](./start-your-next-project.md).
If you want example payloads before wiring your own repo, inspect [Example Fixtures](../reference/examples.md).

## Why Teams Care

This structure helps because it creates a better contract between AI and humans.

- **For the AI:** it reduces search space and ambiguity.
- **For reviewers:** it shortens the audit path from "read the whole diff" to "inspect the evidence, the affected lane, and the policy result."
- **For the organization:** it turns repo knowledge into reusable policy instead of tribal memory.

That is the differentiator.

The point is not only to make agents faster.
The point is to make them easier to trust.
