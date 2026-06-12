# Repo Standards Schema

This document describes the current schema behind **Repo Standards** and **Requirements**.

Repo Standards answer:

> What requirements does this repo currently observe, guide on, or require?

They are intentionally separate from implementation code and from the current Repo Map file.

## Why The Shape Exists

Without a standards artifact, teams usually end up with one of two bad outcomes:

- standards are buried in bespoke scripts, so nobody can tell which requirements are durable and which are temporary
- every requirement is flattened into one severity level, so guidance and hard gates are treated the same

The current schema makes requirement intent explicit.

## Current Rule Classes

Schema field names still use `rules` for the requirement list:

- `hard-invariant`: a requirement the repo cannot silently drift from
- `promotable-policy`: a strong preference that may later become required
- `advisory-pattern`: useful guidance worth surfacing without hard blocking
- `brittle-implementation-check`: the current source-shape validation rail, replaceable when stronger evidence kinds land

## Product Enforcement Ladder

Product language should use:

- **Observe**: collect evidence only
- **Guide**: provide correction or review feedback
- **Require**: require fresh evidence or authority-backed exception

Current schema values map roughly to:

- `recommend` -> Observe or Guide, depending on output
- `warn` -> Guide
- `block` -> Require

The point of keeping both classification and enforcement/stage metadata is that they answer different questions:

- Classification: what kind of requirement is this?
- Enforcement: how strongly should Veritas apply it right now?

## Current Reference

Use [repo-standards/work-agent-convergence.repo-standards.json](../../repo-standards/work-agent-convergence.repo-standards.json) as the current schema example.
