# Reference Adapters

The files in this directory are reference examples for other repo shapes.

They are not the active adapter for the `veritas` repo itself.

Current examples:

- `work-agent.adapter.json` models the external `work-agent` repository shape
- `demo-docs-site.adapter.json` models a smaller documentation-site repository shape

Dogfooding for this repository uses the tracked repo-local adapter at:

- `.veritas/repo.adapter.json`

That repo-local adapter is the one used by the self-hosting check-in flow, local `veritas report` / `shadow run` usage, and the verification examples under `examples/checkins/`.

## Field Guide

Use `work-agent.adapter.json` as the canonical annotated example.

### Top-level identity

- `name`: stable adapter id
- `kind`: currently `repo-adapter`

### `policy`

These are the default operator judgments used when an evidence artifact has not been explicitly reviewed yet.

- `defaultFalsePositiveReview`
- `defaultPromotionCandidate`
- `defaultOverrideOrBypass`

### `graph`

This is the repo map.

- `version`: graph format version
- `defaultResolution`: fallback phase/workstream metadata for reports
- `nonSliceableInvariants`: cross-cutting concerns that should stay visible during review
- `resolverPrecedence`: human-readable explanation of how workstreams are chosen
- `resolutionRules`: path-driven overrides for phase/workstream routing
- `nodes`: the actual repo surfaces

Each node defines:

- `id`: stable identifier used in evidence artifacts
- `kind`: category such as product, delivery, tooling, governance, or verification
- `label`: human-readable surface label
- `patterns`: repo path prefixes or exact files matched against changed files

### `evidence`

This controls where evidence is written and which proof commands must run.

- `artifactDir`: repo-local directory for evidence artifacts
- `requiredProofLanes`: mandatory proof commands for the repo or routed surface
- `reportTransport`: where the markdown summary is expected to land

## Authoring Guidance

- Keep node ids stable once consumers rely on them.
- Prefer repo-generic surface names over runtime-specific language.
- Start with a small number of proof lanes and only split when the repo shape demands it.
- Treat adapters as reviewable contract files, not generated noise.
