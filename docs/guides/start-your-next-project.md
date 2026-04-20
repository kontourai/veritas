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

## The Ideal Future Experience

The target UX is something like:

```bash
npx ai-guidance init
```

Or, in a skill-driven environment:

```text
$ai-guidance-bootstrap
```

That bootstrap flow should set up the minimum starter kit:

1. an adapter
2. a starter policy pack
3. a team profile
4. local commands such as `guidance:report`
5. CI wiring
6. short human-friendly docs in the repo

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

- local wrapper commands
- CI hooks
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

Until a dedicated bootstrap command exists, use this manual sequence:

1. copy a starter adapter
2. copy a starter policy pack
3. copy a starter team profile
4. add one proof-lane command
5. add one guidance-report command
6. document the expected repo workflow in one short guide

That manual path is the current version of the future bootstrap command.
