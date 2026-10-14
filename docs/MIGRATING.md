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

1. Run `npx --no @kontourai/veritas claim init` in the repo root.
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

Owned repos can update `.veritas/repo-map.json` manually or rerun `npx --no @kontourai/veritas init --force` and reapply local policy edits.

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

Veritas now depends on Surface 2.x (the `^2.0.0` range of the `@kontourai/surface` package) and the `hachure` version pinned in `package.json`. Both packages renamed the Claim `surface` field to `facet` (still an optional string) and bumped the Surface `TrustBundle` `schemaVersion` from 3 to 5.

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

Surface 2.0.0's `validateTrustBundle` still tolerates a legacy `surface` value on read (mapping it onto `facet` with a one-time deprecation warning), but Veritas no longer emits `surface` anywhere.

## Generated Commands Run `npx --no @kontourai/veritas`

Hooks, package scripts, the CI snippet, the `.veritas/README.md` template, and printed next steps
now run `npx --no @kontourai/veritas`. The earlier spelling still works where Veritas is installed.
Where it is not, it fell back to a registry fetch without prompting when no terminal is attached,
and the `npm exec` form fetched the unscoped `veritas` package, which belongs to another project.
The Codex `PreToolUse` and `PostSession` commands and the Claude Code `PostSession` command run in the
agent's working directory, which can be a nested package without its own Veritas install. They look
upward from there for the nearest directory with Veritas installed, and pass it to `npx --prefix`
only when the walk reaches the git root. When it does not, or nothing is installed on the way, they
run plain `npx --no @kontourai/veritas`, which also finds a global install. Two limits:

- In a repository with no `package.json`, plain npx uses npm's own upward search for the nearest
  `package.json` or `node_modules`, which can pass the git root.
- Inside a git submodule with its own `package.json`, or a worktree nested inside the main checkout
  with no install of its own, the hook now refuses where the earlier spelling ran the outer install.

Codex on Windows runs hooks through PowerShell, so the Codex `PreToolUse` hook also carries the plain
command as `commandWindows`.
Files Veritas already wrote keep the earlier spelling until you refresh them:

- `.githooks/post-commit`: run `npx --no @kontourai/veritas setup repo-hooks --force`. Without
  `--force` the command refuses, because the tracked hook no longer matches the current one.
- Claude Code (`.veritas/hooks/pre-tool-use.sh`, `.veritas/hooks/stop.sh`, `.claude/settings.json`):
  run `npx --no @kontourai/veritas integrations claude-code install --force`.
- Codex (`.veritas/hooks/agent-runtime.sh`, `.veritas/runtime/codex-hooks.json`, and the hooks
  file named by `--codex-home` or `--target-hooks-file`): run
  `npx --no @kontourai/veritas integrations codex install --force` with the same option you
  installed with. In the hooks file it replaces the handlers earlier releases wrote, matched by
  their exact command, and leaves every other handler alone.
- A `.codex/hooks.json` provisioned through Flow Agents: provisioning again adds the new
  `PreToolUse` handler and keeps the earlier one, so delete the earlier handler by hand. Its
  command is the one that runs `hooks codex pre-tool-use` without `--no`.
- `package.json` scripts, a CI snippet you copied into a workflow, and `.veritas/README.md` have no
  refresh command. Edit the prefix before each Veritas subcommand to `npx --no @kontourai/veritas`.
  Do not rerun `init --force` for the README: it also rewrites your standards.

`veritas readiness` and repo conformance do not check the spelling in these files.
`integrations claude-code status` reports `postSessionConfigured: false`, and
`integrations codex status` with a hooks file reports `integrationInstalled: false`, for a
configuration written with the earlier spelling.

## The Governance Block Runs `npx --no @kontourai/veritas readiness`

The governance block in `AGENTS.md`, `CLAUDE.md` and the other configured instruction files now
says `npx --no @kontourai/veritas readiness` instead of `veritas readiness`. A bare `veritas` is on
`PATH` only inside an npm script or with a global install, and an agent that recovers from "command
not found" by putting `npx` in front of it runs the unscoped `veritas` package, which belongs to
another project.

The `ai-instruction-files-synced` requirement compares each block with the current one, so after
you upgrade, a block written by an earlier release is a `stale-governance-content` mismatch. At the
starter Enforcement Level, Guide, that is a WARN and readiness still passes. If you raised the
requirement to Require, it is a FAIL until you refresh the blocks:

```bash
npx --no @kontourai/veritas apply governance-blocks
```

This replaces only the text between the governance markers, including a block edited by hand, and
needs no `--force`.

`npx --no` runs only an installed Veritas: a repository dependency, or a global install. In a
repository that has neither, it refuses with `npx canceled due to missing packages`. If your block
was edited to fetch a pinned version from the registry, add `@kontourai/veritas` as a development
dependency before you refresh the block, or keep the edited block and its WARN.
