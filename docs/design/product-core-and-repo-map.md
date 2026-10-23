# Product Core And Repo Map

This architecture note uses the current product vocabulary.

## Purpose

Veritas should stay generic enough to work across repos while still being concrete enough to guide real development work.

## Current Separation

The product model has three layers:

1. **Veritas product core**: requirement evaluation, evidence shape, readiness reporting, standards feedback, and Surface-format projection.
2. **Repo Map**: the mapping from Veritas concepts onto one real codebase: work areas, boundaries, protected areas, ownership context, and dependency relationships.
3. **Repo Standards**: the requirements, evidenceChecks, verification authorities, exceptions, enforcement levels, and merge thresholds for that repo.

Use exact schema fields when authoring configuration. The Repo Map declares check commands and routing; requirements in Repo Standards can reference those check IDs. Authority settings are separate protected configuration. Exceptions currently belong to hook feedback and do not waive readiness failures.

## Why This Helps AI Focus

AI systems lose focus when they cannot tell:

- what work area they are operating in
- what boundaries are real
- which evidenceChecks matter
- whether a requirement is guidance or mandatory

Veritas makes those concepts explicit.

## What Belongs In The Product Core

The product core owns:

- requirement evaluation semantics
- generated evidence shape
- readiness reporting
- standards feedback and recommendations
- Surface-format trust projection
- CLI and runtime integration contracts

The core should not hardcode local repo paths or product-specific workflows.

## What Belongs In The Repo Map

The repo map owns:

- path-to-work-area mapping
- boundary and protected-area metadata
- ownership context
- dependency relationships
- routing hints for evidenceChecks

The repo map should not own evidence semantics, authority semantics, or standards improvement policy.

## What Belongs In Repo Standards

Repo standards own:

- requirements
- evidenceChecks
- verification authorities
- exception rules
- enforcement levels
- merge thresholds
- repo conformance requirements
- standards growth rules

This is the layer teams should review when deciding what good looks like.

## Human Role

Humans should review the standards, protected changes, exceptions, and high-risk readiness gaps.

Teams still decide the review required for implementation changes. Policy compliance identifies evidence and gaps; it does not establish that a change is correct or that reduced review is safe.
