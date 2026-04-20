# Agent Activation

This document answers a simple question:

> does the framework only work with one agent, or can it guide whatever AI is touching the codebase?

The intended answer is:

- **the framework is agent-agnostic by design**
- **activation is repo-native and just-in-time**
- **actual enforcement depends on whether the agent respects repo context or is routed through the framework path**

## The Core Principle

The framework should not depend on one proprietary agent runtime.

If it did, it would stop being a repo-level system and turn into a tool integration.

Instead, the framework should activate from the codebase itself.

That means the important activation surfaces are:

- repo-level instructions
- adapter and policy artifacts
- evidence and eval artifacts
- local and CI wrapper commands

Those are the things an agent can encounter at the moment it starts interacting with the repo.

## The Three Activation Modes

### 1. Ambient Activation

This is the most important mode.

The repo contains:

- instructions for the AI
- an adapter that explains the repo shape
- a policy pack that explains the current rules
- a team profile that explains how strict the team wants the system to be

If an agent reads repo instructions and local guidance files, the framework is already present when the agent begins work.

That is what we mean by **just-in-time instruction**.

The repo itself tells the agent:

- where it is
- what matters
- what must be proved
- what should be guided instead of blocked

### 2. Explicit Activation

Some environments should route through the framework on purpose.

Examples:

- a local wrapper command
- a skill
- an `init` or bootstrap command
- a `guidance:report` or `guidance:verify` command

This is useful when you want stronger guarantees than ambient repo context alone can provide.

### 3. Review And CI Activation

Even when the interactive agent path is weak, the framework can still activate later in the flow through:

- evidence generation
- policy evaluation
- CI checks
- live eval capture

This is how the system stays useful even when the front-end agent experience is uneven across tools.

## Does It Work With Every Agent?

In the product sense, it should be usable with any agent that interacts with the repo.

In the strict runtime sense, not every agent will honor it equally.

The honest framing is:

- it works best with agents that read repo instructions and local artifacts
- it can still participate through wrapper commands and CI when an agent does not
- it cannot force compliance from an agent that ignores repo context entirely

So the compatibility goal is not:

- "every agent obeys automatically"

The goal is:

- "the repo exposes the guidance in a tool-agnostic way, and stronger activation paths exist when needed"

## Why This Is A Differentiator

Most agent systems are either:

- tightly bound to one runtime
- or too loose to preserve repo-level trust

This framework tries to take a better path:

- repo-native activation for portability
- just-in-time instruction for focus
- evidence artifacts for auditability
- optional stronger activation through wrappers and CI

That makes it feel less like a prompt trick and more like a development operating layer.
