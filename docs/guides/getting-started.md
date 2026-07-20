# Getting Started

This guide gets Veritas readiness checking in a repository so developers and agents can check changes against repo standards.

The goal is simple:

- define what good looks like for the repo
- map the work areas and change boundaries that matter
- run evidence checks for the current change
- produce feedback and generated evidence before review

For the product model, read [Concepts](../concepts.md). For exact current commands, read [CLI Reference](../reference/cli.md).

## Mental Model

Use Veritas as:

1. **Repo Standards**: what this repo requires.
2. **Repo Map**: where work lives and which boundaries matter.
3. **Readiness Report**: whether this change has enough evidence to merge.
4. **Standards Feedback**: whether the standards are helping or need improvement.

## Minimal Onboarding

Start small:

1. one repo map
2. a small set of repo standards
3. one evidenceCheck
4. one requirement that catches a real review issue

That is enough to make Veritas useful. You do not need to model the whole organization on day one.

## Install

```bash
npm install -D @kontourai/veritas
npx @kontourai/veritas init
```

`init` writes starter files under `.veritas/`, injects a governance block into AI instruction files, and creates a reviewable starting point for standards and map configuration.

Current generated paths are documented in [CLI Reference](../reference/cli.md). The product model is Repo Standards, Repo Map, and protected standards metadata.

For a repo where setup should be reviewed before files are written, use the guided path:

```bash
npx @kontourai/veritas init --explore
npx @kontourai/veritas init --guided --answers answers.json --output .veritas/init-plans/guided.json
npx @kontourai/veritas init --apply --plan .veritas/init-plans/guided.json
```

Exploration is deterministic: it does not call AI. The first command writes its review artifact to
`.veritas/init-plans/explore.json` by default while leaving active standards untouched.

## Protect The Standards

After reviewing the generated standards and map, record the first attestation:

```bash
npx @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
```

This records authority-backed evidence for the current protected standards. If the standards or map change later, Veritas reports that fresh authority is needed before those changes can be trusted.

## Run A Readiness Check

Run a readiness check:

```bash
npx @kontourai/veritas readiness --working-tree
```

The output gives developer- and agent-facing feedback, writes generated evidence, and records enough context for standards feedback. For a repo that satisfies all its standards, the output looks like:

```text
veritas: 0 files changed ->
PASS  required-veritas-artifacts: All required repository artifacts are present.
PASS  ai-instruction-files-synced: All required AI instruction files contain the canonical governance block.

0 failures · 0 warnings · run `veritas readiness --check evidence` for full generated evidence
```

When a requirement is not satisfied, the output shows the failure with the affected file:

```text
FAIL  api-routes-require-api-tests: Changed files matched app/api/** but no companion changes matched tests/api/**.
      -> app/api/projects/route.ts

1 failure · 0 warnings · run `veritas readiness --check evidence` for full generated evidence
```

For a lower-level evidence artifact without the full orchestration path:

```bash
npx @kontourai/veritas readiness --check evidence --working-tree
```

`veritas readiness` is the front door for readiness reports. Existing hook and CI integrations may still use the lower-level `veritas readiness` compatibility path.

## Add Change Guidance

Use `explain` when an agent or developer needs context before editing:

```bash
npx @kontourai/veritas explain --file src/api/users.ts
npx @kontourai/veritas explain <requirement-id>
```

Good change guidance should say what to do next, what not to do, why it matters, and what evidence will satisfy the requirement.

## Improve The Standards

After Veritas has generated enough evidence, use the current feedback commands:

```bash
npx @kontourai/veritas feedback summary
npx @kontourai/veritas feedback recommend
npx @kontourai/veritas recommendation list
```

In product language, these commands create **Standards Feedback** and **Standards Recommendations**. Recommendations should be reviewed before they change the repo standards.

## Roll Out Gradually

Use the enforcement ladder:

- **Observe**: collect evidence and learn what matters.
- **Guide**: give developers and agents just-in-time correction.
- **Require**: require fresh evidence or an authority-backed exception before merge readiness is complete.

Start in Observe or Guide. Promote requirements only when the evidence says they are useful.

## Why Teams Care

Veritas creates a better contract between AI and humans.

- **For agents:** less ambiguity and more precise correction.
- **For developers:** repo standards appear at the point of work.
- **For reviewers:** a readiness report narrows review to evidence, exceptions, and risky boundaries.
- **For the organization:** humans review the standards and exceptions instead of manually rediscovering the same expectations in every diff.

The point is not only to make agents faster. The point is to make more changes trustworthy enough for reduced human review.
