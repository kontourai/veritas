# Framework Core vs Adapter

## Purpose

Define the reusable framework shape for agentic development guidance without tying
it to a single product repository.

## Core Thesis

The framework is not a bundle of repo-specific CI checks.

It is:

1. a generic `graph + resolver + evidence + policy` engine
2. a repo adapter that binds those abstractions to a specific codebase
3. one or more policy packs that express what the repo considers acceptable

## Framework Core

The core owns:

- graph semantics
- resolver semantics
- evidence schema
- policy-pack lifecycle
- reporting contract

It should reason about abstract node kinds such as:
- `product-surface`
- `shared-contract-surface`
- `verification-surface`
- `governance-surface`
- `tooling-surface`
- `delivery-surface`

It should not hardcode local repo paths.

## Repo Adapter

A repo adapter binds the framework to a specific codebase.

An adapter owns:
- path-to-node mapping
- default resolution
- repo-specific invariants
- required proof lanes
- reporting transport details

An adapter does not own:
- node-kind semantics
- evidence semantics
- promotion lifecycle

## Policy Packs

Policy packs encode what a repo considers acceptable.

Examples:
- hard invariants
- promotable policies
- advisory patterns
- brittle implementation checks that should be retired or softened later

## Human Signoff

Humans should sign off on:
- policy changes
- invariant changes
- promotion thresholds
- adapter boundary changes
- trust-boundary and security rule changes

Humans should not need to sign off on routine implementation inside established policy.

## `work-agent`

`work-agent` is adapter `#1`, not the framework itself.

Its current `verify:convergence` logic is best understood as a repo-specific policy pack,
not the framework core.
