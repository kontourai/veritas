# Reference Repo Maps

The files in this directory are reference examples for other repo shapes.

They are not the active Repo Map for the `veritas` repo itself.

Current examples:

- `work-agent.repo-map.json` models the external `work-agent` repository shape
- `demo-docs-site.repo-map.json` models a smaller documentation-site repository shape

Dogfooding for this repository uses the tracked repo-local Repo Map at:

- `.veritas/repo-map.json`

That repo-local Repo Map is the one used by the self-hosting repo conformance flow, local readiness checks, and the verification examples under `examples/repo-conformance/`.

## Field Guide

Use `work-agent.repo-map.json` as the canonical annotated example.

### Top-level identity

- `name`: stable Repo Map id
- `kind`: currently `repo-map`

### `policy`

These are the default operator judgments used when an evidence artifact has not been explicitly reviewed yet.

- `defaultFalsePositiveReview`
- `defaultPromotionCandidate`
- `defaultExceptionAllowed`

### `graph`

This is the repo map.

- `version`: graph format version
- `defaultResolution`: fallback phase/workstream metadata for reports
- `nonSliceableInvariants`: cross-cutting concerns that should stay visible during review
- `resolverPrecedence`: human-readable explanation of how workstreams are chosen
- `resolutionRules`: path-specific routes for phase/workstream routing
- `nodes`: the actual work areas

Each node defines:

- `id`: stable identifier used in evidence artifacts
- `kind`: category such as product, delivery, tooling, governance, or verification
- `label`: human-readable surface label
- `patterns`: repo path prefixes or exact files matched against changed files

### `evidence`

This controls where evidence is written and which evidenceCheck commands must run.

- `artifactDir`: repo-local directory for evidence artifacts
- `evidenceChecks`: explicit evidence-check objects with stable ids, commands, methods, and optional Surface claim mapping
- `requiredEvidenceCheckIds`: mandatory evidenceCheck ids for the repo or routed surface
- `defaultEvidenceCheckIds`: fallback evidenceCheck ids when no route-specific lane applies
- `evidenceCheckRoutes`: node-to-evidence-check routing by id
- `reportTransport`: where the markdown summary is expected to land

## Authoring Guidance

- Keep node ids stable once consumers rely on them.
- Keep evidence-check ids stable once evidence consumers rely on them.
- Prefer repo-generic surface names over runtime-specific language.
- Start with a small number of evidence checks and only split when the repo shape demands it.
- Treat repo-maps as reviewable contract files, not generated noise.
