# Start Your Next Project With AI Guidance

If this framework is doing its job well, starting a new project should feel simple.

The goal is not:

- install a complicated platform
- read a stack of internal docs
- hand-wire every rule before you can begin

The goal is:

- run one setup flow
- get the right starter files
- let the repo guide the AI from the beginning

## The Current Experience

The framework now ships a first bootstrap command:

```bash
npm exec -- ai-guidance init
```

That command writes the minimum starter kit:

1. an adapter
2. a starter policy pack
3. a team profile
4. a short human-friendly README in the repo

It also records the repo shape it inferred so the team can review the guessed source roots, test roots, and proof lane before moving on.

## The Minimum Starter Kit

For the framework to guide the next project well, the repo should start with:

- one **adapter**
- one **policy pack**
- one **team profile**
- one **proof lane**
- one **wrapper command** or script

That is enough to make the system feel real without overbuilding.

## What The Bootstrap Should Do

The bootstrap path should:

### Inspect the repo

- what kind of project is this?
- where are the obvious surfaces?
- what is the likely build/test proof lane?

### Generate the first framework files

- adapter
- policy pack
- team profile

### Default to a safe rollout

- use `shadow` mode first
- recommend before warning
- warn before block

### Wire normal development flow

- suggested local wrapper commands
- suggested CI hooks
- short onboarding docs

## Why This Matters

If setup is heavy, teams will postpone it.
If they postpone it, the framework arrives after local norms have already drifted.

That weakens the whole point of the system.

The framework should be present at project start so the repo can guide the AI from the first meaningful change.

## Activation In Practice

Once bootstrapped, the repo should activate guidance in three ways:

1. **Ambiently** through repo-native instructions and artifacts
2. **Explicitly** through wrapper commands and skills
3. **Downstream** through evidence, review, and CI

This means the framework does not need every agent to behave identically.
It needs the repo to expose guidance clearly and consistently.

## What To Do Today

Use this sequence:

1. run `npm exec -- ai-guidance init`
2. review the generated `.ai-guidance/` files
3. replace the default proof lane with the one that proves your repo is healthy
4. run `npm exec -- ai-guidance print package-scripts`
5. run `npm exec -- ai-guidance print ci-snippet`
6. run `npm exec -- ai-guidance apply package-scripts`
7. run `npm exec -- ai-guidance apply ci-snippet`
8. run `npm exec -- ai-guidance report --working-tree`
9. wire the same paths into review and CI if you want them in your permanent workflow files

This slice is intentionally conservative. It prints the suggested wiring first, then only writes changes when the user explicitly asks it to.

Use `--changed-from <ref> --changed-to <ref>` when you want branch-diff evidence instead of current-state evidence.
