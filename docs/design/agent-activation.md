# Agent Activation

This document answers a simple question:

> Can Veritas guide any agent or developer working in the repo?

The intended answer is:

- Veritas is agent-first, not agent-only.
- Change guidance is repo-native and just-in-time.
- Stronger enforcement depends on whether the tool is routed through Veritas hooks, wrappers, or CI.

## Core Principle

Veritas should not depend on one proprietary agent runtime.

The repo should expose:

- Repo Standards
- Repo Map
- Change Guidance
- generated evidence
- local and CI commands
- optional runtime hooks

An agent or developer should encounter the relevant standards at the point of work.

## Activation Modes

### Ambient Activation

The repo contains instructions, standards, map files, and guidance. Any tool that reads repo context can discover what matters.

This is the baseline. It is portable, but it depends on the tool actually reading the repo context.

### Explicit Activation

Some environments should route through Veritas directly:

- wrapper commands
- agent skills
- `veritas explain`
- `veritas readiness`

This gives stronger guarantees than ambient instructions alone.

### Hook And CI Activation

When supported, hooks can provide change guidance before edits or at the end of a session. CI can evaluate merge readiness even if an interactive agent ignored repo context.

Examples:

- Claude Code PreToolUse hooks
- stop hooks
- local wrapper scripts
- pull request checks
- protected branch CI

## Honest Compatibility

Veritas cannot force compliance from an agent that ignores repo context and never runs the CLI.

It can still help by:

- putting standards and guidance in the repo
- exposing simple commands
- wiring optional hooks
- producing readiness reports in CI
- protecting standards from silent weakening

The goal is not "every agent obeys automatically." The goal is "the repo exposes the standard in a tool-agnostic way, and stronger activation paths exist when needed."
