# Framework Core vs Adapter

## Purpose

Define a reusable AI-guidance system that stays generic enough to travel across repos while still being concrete enough to guide real development work.

## Core Thesis

The framework is not a bag of repo-specific CI assertions.

It is a contract with three layers:

1. **framework core**: graph semantics, resolution semantics, evidence shape, and executable policy evaluation
2. **repo adapter**: the mapping from those semantics onto one real codebase
3. **policy pack**: the repo's current rules, staged by confidence and enforcement level

That separation matters because it preserves both portability and auditability.

## Why This Helps AI Focus

AI systems lose focus when they cannot tell:

- what surface they are operating in
- what boundaries are real
- which proofs are mandatory
- whether a rule is absolute or only a preference

The framework fixes that by making those concepts explicit.

- The **graph** shrinks the search space.
- The **adapter** localizes repo knowledge.
- The **policy pack** distinguishes hard rails from softer guidance.
- The **evidence record** captures what happened in a form humans can audit quickly.

## Framework Core

The core owns:

- graph semantics
- resolver semantics
- evidence schema
- policy-pack lifecycle
- executable policy evaluation
- reporting contract

The core should reason about abstract node kinds such as:

- `product-surface`
- `shared-contract-surface`
- `verification-surface`
- `governance-surface`
- `tooling-surface`
- `delivery-surface`

The core should not hardcode local repo paths or product-specific workflows.

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
- policy evaluation semantics
- promotion lifecycle

## Policy Packs

Policy packs encode what a repo considers acceptable.

They should be staged, not flattened.

- `hard-invariant`: must hold
- `promotable-policy`: strong preference that may mature into a hard invariant
- `advisory-pattern`: useful guidance without hard blocking
- `brittle-implementation-check`: temporary source-shape rail that should eventually be replaced with a stronger semantic rule

This is one of the framework's biggest differentiators.

Most systems only ask "did the check pass?"
This framework also asks "what kind of rule is this and how much trust should we place in it?"

## Human Signoff

Humans should sign off on:

- policy changes
- invariant changes
- promotion thresholds
- adapter boundary changes
- trust-boundary and security rule changes

Humans should not need to re-audit every routine implementation detail when the change stays inside established policy and the evidence is strong.

## Onboarding Bias

The framework should stay easy to adopt.

The intended onboarding shape is:

1. one adapter
2. one policy pack
3. one proof lane
4. one executable rule

Anything heavier than that should be justified by operator value, not by framework purity.

## `work-agent`

`work-agent` is adapter `#1`, not the framework itself.

Its current `verify:convergence` logic is best understood as:

- partly a mature repo-specific policy pack
- partly a backlog of brittle source-shape checks that still need abstraction

That makes it the right proving ground, but the wrong long-term home for the framework core.
