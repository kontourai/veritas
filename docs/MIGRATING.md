# Migration Guide

## Product Terminology Migration

Veritas now uses the product vocabulary in [reference/glossary.md](reference/glossary.md). Pre-glossary names should be renamed, not preserved as a public surface.

Current implementation names to migrate:

| Current implementation name | Canonical product name |
| --- | --- |
| repo standards | Repo Standards or Standards File |
| adapter | Repo Map |
| work area / work area | Work Area |
| rule | Requirement |
| evidenceCheck / evidenceCheck / evidenceCheck command | Evidence Check |
| evidence inventory | Evidence Check Inventory |
| readiness coverage | Readiness Coverage |
| authority settings | Repo Standards settings, authority settings, or rollout settings |
| eval | Standards Feedback |
| recommendation | Standards Recommendation |
| check-in | Readiness Report, Repo Conformance, or Standards Feedback depending on context |
| Protected Standards | Protected Standards |
| Standards Growth | Standards Growth |
| Generated Evidence | Generated Evidence |
| framework | Product, CLI, SDK, or implementation module depending on context |

Near-term rename targets:

1. Rename generated `.veritas/` files to standards/map/settings language.
2. Rename schema files and field names after generated files are settled.
3. Rename CLI command groups from implementation names to readiness, feedback, and recommendations.
4. Keep exact current implementation names only in migration notes, schema references, and code comments needed to explain an active rename.

## Standards Recommendation Module Moved

Standards Recommendation code now lives in the Standards Feedback subcontext.

Before:

```js
import {
  applyRecommendation,
  generateRuleRecommendations,
} from './src/recommendations.mjs';
```

After:

```js
import {
  applyRecommendation,
  generateRuleRecommendations,
} from './src/standards-feedback/recommendations.mjs';
```

The old `src/recommendations.mjs` module is removed instead of re-exported. Update internal imports and external consumers to the new path.

## Run Snapshots Move to `.kontourai/veritas/surface/`

Veritas writes run snapshots below the shared `.kontourai/` runtime root.

New paths:

```
.kontourai/veritas/surface/<run-id>.console.json
.kontourai/veritas/surface/latest.json
```

When updating an existing local checkout:

1. Ensure `.kontourai/` is present in `.gitignore` (current `veritas init` adds that exact entry when needed).
2. The next `veritas readiness` writes to the new path automatically.
3. Remove stale `.surface/` runtime files once they are no longer needed; do not add a `.surface/` ignore entry for Veritas output.

If you pass a `--read-model` flag explicitly to the Surface Console, set it to `.kontourai/veritas/surface/latest.json` or omit it entirely, since that path is now the default.

## Claims Are Now Authored, Not Generated Per Run

Veritas requires a committed claim store at `veritas.claims.json`. Per-run claim generation is no longer supported.

To migrate:

1. Run `veritas claim init` in the repo root.
2. Review the generated claim IDs, surfaces, policies, and metadata.
3. Commit `veritas.claims.json`.
4. Update any automation that referenced run-scoped claim IDs to use the stable authored claim IDs.

See [claim-authoring.md](./claim-authoring.md) for the full authoring workflow.

## Repo Map Evidence Checks Are Explicit Objects

Repo Maps now use explicit evidence-check objects. Removed command arrays such as `requiredEvidenceCheckCommands`, `defaultEvidenceCheckCommands`, and `surfaceEvidenceCheckCommands[].evidenceChecks` fail runtime validation with a migration-oriented error.

Before:

```json
{
  "evidence": {
    "requiredEvidenceCheckCommands": ["npm run ci:fast"],
    "defaultEvidenceCheckCommands": ["npm test"],
    "surfaceEvidenceCheckCommands": [
      { "nodeIds": ["src/api"], "evidenceChecks": ["npm run api:test"] }
    ]
  }
}
```

After:

```json
{
  "evidence": {
    "evidenceChecks": [
      { "id": "ci-fast", "command": "npm run ci:fast", "method": "validation" },
      { "id": "unit-tests", "command": "npm test", "method": "validation" },
      { "id": "api-tests", "command": "npm run api:test", "method": "validation" }
    ],
    "requiredEvidenceCheckIds": ["ci-fast"],
    "defaultEvidenceCheckIds": ["unit-tests"],
    "evidenceCheckRoutes": [
      { "componentIds": ["src/api"], "evidenceCheckIds": ["api-tests"] }
    ]
  }
}
```

Owned repos can update `.veritas/repo-map.json` manually or rerun `veritas init --force` and reapply local policy edits.

## Evidence Check Commands No Longer Run Through a Shell

`veritas readiness` now tokenizes evidenceCheck commands and executes them directly instead of passing the full string through `SHELL -lc`.

This closes a config-level command-injection path, but it changes the evidence-check contract:

- shell requirement operators such as `&&`, `||`, `|`, `>`, and `<` are no longer interpreted
- environment-variable expansion such as `$FOO` is no longer interpreted
- quoting still works for grouping argv tokens

### How To Migrate

Recommended:

1. Split compound evidenceCheck flows into multiple `evidenceChecks` entries.
2. Keep each evidenceCheck to one executable plus its argv.

Before:

```json
{
  "evidenceChecks": [{ "id": "ci", "command": "npm run ci:fast && npm test", "method": "validation" }],
  "requiredEvidenceCheckIds": ["ci"]
}
```

After:

```json
{
  "evidenceChecks": [
    { "id": "ci-fast", "command": "npm run ci:fast", "method": "validation" },
    { "id": "unit-tests", "command": "npm test", "method": "validation" }
  ],
  "requiredEvidenceCheckIds": ["ci-fast", "unit-tests"]
}
```

If you previously relied on shell expansion, move that logic into a real script and call the script as the evidenceCheck.

## Evidence Check Output Now Uses Inherited StdIO

Evidence Check commands now run with inherited stdio instead of redirecting stdout into stderr.

Operational effect:

- evidenceCheck stdout stays on stdout
- evidenceCheck stderr stays on stderr
- CLI callers that assumed `veritas readiness` emitted only JSON on stdout must now parse the trailing JSON payload instead of the entire stream

This is intentional. The command no longer rewrites evidence-check output streams behind the operator's back.

## Claim `surface` Field Renamed to `facet` (Surface 2.0, schemaVersion 5)

Veritas now depends on `@kontourai/surface@^2.0.0` and the `hachure` version pinned in `package.json`. Both packages renamed the Claim `surface` field to `facet` (still an optional string) and bumped the Surface `TrustBundle` `schemaVersion` from 3 to 5.

Veritas now writes `facet` everywhere it previously wrote `surface`:

- `veritas.claims.json` claim entries use `facet` instead of `surface`.
- `veritas claim add` / `veritas claim edit` take `--facet <facet>` instead of `--surface <surface>`.
- Generated `trust.bundle.claims[]` entries carry `facet` and `trust.bundle.schemaVersion` is `5`.
- The Surface Console read model (`kind: "surface-console-read-model"`) reports `facet`, `facetCounts`, and `coverageByFacet` instead of `surface`, `surfaceCounts`, and `coverageBySurface`.

To migrate:

1. Update `@kontourai/surface` to `^2.0.0` and `hachure` to the version pinned in `package.json`.
2. Rewrite any hand-authored `veritas.claims.json` entries that still use `"surface"` to use `"facet"` instead (same value, new key).
3. Update any automation or scripts that pass `--surface` to `veritas claim add` / `veritas claim edit` to pass `--facet` instead.
4. Update any downstream consumer that reads `claim.surface` from `trust.bundle.claims[]` or the Surface Console read model to read `claim.facet` instead.

`@kontourai/surface@2.0.0`'s `validateTrustBundle` still tolerates a legacy `surface` value on read (mapping it onto `facet` with a one-time deprecation warning), but Veritas no longer emits `surface` anywhere.
