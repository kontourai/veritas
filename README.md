# AI Guidance Framework

> “A good harness is really operationalized around giving the model text at the right time so it can look at the work it has done and the information around what a good job looks like.”
>
> Ryan Laapo, OpenAI

Code is free. Trusted delivery is not.

This framework gives teams a shared operating layer for agentic development, with just-in-time guidance, standardized construction paths, baseline compliance, and evidence-backed feedback loops. The result is faster delivery, safer parallelization, and scalable agent output without making human review the bottleneck.

`ai-guidance-framework` is designed to be:

- easy for an agent to operate inside
- easy for a team to install and use
- easy for reviewers to trust

It should guide the repo in a way that is available to whatever AI is touching the codebase, not only one specific agent runtime.

It does that through three pieces:

- a **[framework core](docs/design/framework-core-vs-adapter.md)** that understands graph nodes, resolution, evidence, and policy evaluation
- a **[repo adapter](docs/design/framework-core-vs-adapter.md)** that maps those abstractions onto a real codebase
- **[policy packs](docs/design/policy-packs.md)** that define what a repo treats as required, promotable, or still too brittle to trust fully

## Why This Structure Matters

Most AI coding systems fail in one of two ways:

1. they are too loose, so the model wanders and humans have to audit everything manually
2. they are too repo-specific, so the "framework" is really just a pile of local checks that cannot transfer

This framework is structured to avoid both failure modes.

- **AI focus:** the adapter turns a repo into bounded nodes and proof lanes, so the model can reason about where it is operating instead of treating the whole repo as one blob.
- **Auditability:** the evidence record turns "the agent seemed fine" into a concrete artifact with phase, workstream, affected nodes, proof-lane status, and policy-pack provenance.
- **Policy evolution:** policy packs let a team distinguish hard invariants from softer guidance instead of encoding every rule as an equally rigid one-off script.
- **Differentiation:** most agent tooling stops at prompting or orchestration. This repo is about making agent behavior legible, reviewable, and enforceable at the repo boundary.

## Current Capabilities

Today the framework can:

- bootstrap a starter `.ai-guidance/` setup for a new repo
- infer conservative starter defaults from the target repo shape
- print suggested package scripts and a starter CI snippet
- explicitly apply suggested package scripts and write a reviewable CI snippet file
- load repo adapters and policy packs
- resolve changed files into graph nodes and workstreams
- report explicit files, branch diffs, or the current working tree truthfully
- capture a shadow eval record from a real guidance report artifact
- prepare a shadow eval draft artifact with a framework-generated next step
- run a hook-friendly shadow flow that handles proof, report, and eval draft in one command
- generate tracked git-hook adapters for the passive shadow flow
- generate tracked runtime-hook templates for agent runtimes
- generate tracked Codex hook adapters on top of the runtime-hook surface
- emit structured evidence records and Markdown summaries
- evaluate executable policy-pack rules
- define live-eval and team-tuning artifacts for measuring usefulness over time
- ship canonical fixtures for adapters, evidence, and convergence rule families

The first interpreted rule class is `required-repo-artifacts`, which `work-agent` now consumes through the framework instead of keeping fully bespoke in `verify:convergence`.

## Install

The install path should stay short.

```bash
npm install
```

Then bootstrap the repo:

```bash
npm exec -- ai-guidance init
```

That writes the minimum starter kit:

1. one adapter
2. one policy pack
3. one team profile
4. one local README

The first adaptive slice also inspects the repo for likely source roots, test roots, workflow presence, and a likely proof lane, then writes those decisions into the generated starter README so the team can confirm them quickly.

If you already know the right proof lane, you can still override it with `--proof-lane`.

## Use It

The primary workflow is:

1. bootstrap the repo
2. print suggested scripts and CI wiring
3. explicitly apply the wiring you want
4. run the guidance report against changed files
5. capture a shadow eval from the report artifact when you want Phase 1 feedback
6. use that evidence in review, CI, or future live evals

```bash
npm run verify
npm test

npm exec -- ai-guidance init
npm exec -- ai-guidance print package-scripts
npm exec -- ai-guidance print ci-snippet
npm exec -- ai-guidance apply package-scripts
npm exec -- ai-guidance apply ci-snippet

npm exec -- ai-guidance report --run-id local-smoke \
  package.json

npm exec -- ai-guidance eval record \
  --evidence .ai-guidance/evidence/local-smoke.json \
  --accepted-without-major-rewrite true \
  --required-followup false \
  --reviewer-confidence high \
  --time-to-green-minutes 12 \
  --override-count 0

npm exec -- ai-guidance eval draft \
  --evidence .ai-guidance/evidence/local-smoke.json

npm exec -- ai-guidance shadow run
npm exec -- ai-guidance print git-hook
npm exec -- ai-guidance apply git-hook --configure-git
npm exec -- ai-guidance print runtime-hook
npm exec -- ai-guidance apply runtime-hook
npm exec -- ai-guidance print codex-hook
npm exec -- ai-guidance print codex-hook --codex-home /path/to/.codex
npm exec -- ai-guidance apply codex-hook --codex-home /path/to/.codex
npm exec -- ai-guidance apply codex-hook --target-hooks-file /path/to/hooks.json
npm exec -- ai-guidance runtime status --codex-home /path/to/.codex

npm exec -- ai-guidance report --working-tree
npm exec -- ai-guidance report --changed-from main --changed-to HEAD
```

`report` now distinguishes between:

- explicit-file reports
- branch-diff reports
- current-state working-tree reports

That keeps the evidence artifact honest about what it actually measured.

`eval record` is the first operational Phase 1 live-eval path: it records how useful that guidance was after the run without changing enforcement.
It only accepts repo-local evidence artifacts under `.ai-guidance/evidence/`, uses the team profile's confidence scale, and refuses to overwrite an existing eval artifact unless you pass `--force`.

`eval draft` is the draft-first companion path: it prepares a repo-local draft artifact and a prefilled `eval record --draft ...` command without inventing the missing judgment fields.

`shadow run` is the first hook-friendly passive automation path: it can run proof, capture a report, and prepare an eval draft in one command, then finish `eval record` only if the remaining judgment fields are already supplied.

`print git-hook` and `apply git-hook` are the first tracked adapter surfaces for that passive path. They generate a repo-local `.githooks/post-commit` script that calls `ai-guidance shadow run`, and `apply git-hook --configure-git` can explicitly set `core.hooksPath` to use it.

`print runtime-hook` and `apply runtime-hook` are the first non-git hook templates. They generate a tracked `.ai-guidance/hooks/agent-runtime.sh` script that defaults to `shadow run --working-tree` and can be invoked by agent runtimes as a repo-local post-task hook.

`print codex-hook` and `apply codex-hook` are the first runtime-specific adapter layer on top of that generic hook. They generate a tracked `.ai-guidance/runtime/codex-hooks.json` snippet, can preview the resolved target and install state, and can explicitly merge it into either a chosen Codex `hooks.json` file or a chosen Codex home via `--codex-home`, without silently mutating global config by default.

`runtime status` is the first cross-adapter doctor surface. It inspects the git-hook, runtime-hook, and Codex-hook layers together, tells you what is present or missing, and explicitly tells you when no Codex target was checked yet so the next preview/apply step is obvious.

If you want the shortest path to understanding the system as a user:

- read [docs/design/agent-activation.md](docs/design/agent-activation.md)
- read [docs/design/framework-core-vs-adapter.md](docs/design/framework-core-vs-adapter.md)
- read [docs/design/live-evals.md](docs/design/live-evals.md)
- read [docs/design/live-eval-roadmap.md](docs/design/live-eval-roadmap.md)
- read [docs/design/policy-packs.md](docs/design/policy-packs.md)
- read [docs/guides/getting-started.md](docs/guides/getting-started.md)
- read [docs/guides/start-your-next-project.md](docs/guides/start-your-next-project.md)
- read [docs/guides/tune-for-your-team.md](docs/guides/tune-for-your-team.md)
- inspect:
  - [adapters/work-agent.adapter.json](adapters/work-agent.adapter.json)
  - [adapters/demo-docs-site.adapter.json](adapters/demo-docs-site.adapter.json)
  - [policy-packs/work-agent-convergence.policy-pack.json](policy-packs/work-agent-convergence.policy-pack.json)
  - [examples/evidence/work-agent-pass.json](examples/evidence/work-agent-pass.json)
  - [examples/evals/work-agent-shadow-eval.json](examples/evals/work-agent-shadow-eval.json)
  - [examples/evals/work-agent-team-profile.json](examples/evals/work-agent-team-profile.json)

## Repository Layout

- `src/` — framework core and policy evaluation
- `bin/` — CLI entrypoints for bootstrap and reporting
- `schemas/` — JSON schemas for graph, adapter, evidence, policy-pack, eval, and team-profile artifacts
- `adapters/` — example adapters
- `policy-packs/` — example policy packs
- `examples/` — canonical evidence fixtures and grouped convergence classification artifacts
- `docs/design/` — framework rationale and structure
- `docs/guides/` — onboarding, bootstrap, and operator-oriented usage guidance

## Commands

```bash
npm run verify
npm test
```

## Developing The Framework

If you want to contribute to the framework itself, use [CONTRIBUTING.md](CONTRIBUTING.md).
