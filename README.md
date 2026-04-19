# AI Guidance Framework

Reusable framework for keeping agentic software development on track with:

- graph-based repo modeling
- task/diff resolution into bounded work areas
- structured evidence records
- policy-pack enforcement lifecycle
- repo adapters for local path patterns, invariants, and reporting transports

## Mental Model

The framework is `core engine` + `repo adapter` + `policy packs`, where:
- the **core engine** defines graph, resolver, evidence, and policy semantics
- a **repo adapter** binds those semantics to a real codebase
- **policy packs** encode what a repo considers acceptable

## Current Status

This repo is the standalone home for the extracted framework shape.

`work-agent` remains adapter `#1` and the primary proving ground.

## Layout

- `docs/design/` — framework design docs
- `schemas/` — JSON schemas for graph, adapter, evidence, and policy packs
- `adapters/` — example repo adapters
- `policy-packs/` — example policy packs
- `tests/` — lightweight verification for the tracked artifacts

## Commands

```bash
npm run verify
npm test
```
