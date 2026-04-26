# Migrating Between Breaking Changes

## Adapter Proof Lanes Are Explicit Objects

Adapters now use explicit proof-lane objects. Legacy command arrays such as `requiredProofLanes`, `defaultProofLanes`, and `surfaceProofLanes[].proofLanes` fail runtime validation with a migration-oriented error.

Before:

```json
{
  "evidence": {
    "requiredProofLanes": ["npm run ci:fast"],
    "defaultProofLanes": ["npm test"],
    "surfaceProofLanes": [
      { "nodeIds": ["src/api"], "proofLanes": ["npm run api:test"] }
    ]
  }
}
```

After:

```json
{
  "evidence": {
    "proofLanes": [
      { "id": "ci-fast", "command": "npm run ci:fast", "method": "validation" },
      { "id": "unit-tests", "command": "npm test", "method": "validation" },
      { "id": "api-tests", "command": "npm run api:test", "method": "validation" }
    ],
    "requiredProofLaneIds": ["ci-fast"],
    "defaultProofLaneIds": ["unit-tests"],
    "surfaceProofRoutes": [
      { "nodeIds": ["src/api"], "proofLaneIds": ["api-tests"] }
    ]
  }
}
```

Owned repos can update `.veritas/repo.adapter.json` manually or rerun `veritas init --force` and reapply local policy edits.

## Proof Commands No Longer Run Through a Shell

`veritas shadow run` now tokenizes proof commands and executes them directly instead of passing the full string through `SHELL -lc`.

This closes a config-level command-injection path, but it changes the proof-lane contract:

- shell control operators such as `&&`, `||`, `|`, `>`, and `<` are no longer interpreted
- environment-variable expansion such as `$FOO` is no longer interpreted
- quoting still works for grouping argv tokens

### How To Migrate

Recommended:

1. Split compound proof flows into multiple `proofLanes` entries.
2. Keep each proof lane to one executable plus its argv.

Before:

```json
{
  "proofLanes": [{ "id": "ci", "command": "npm run ci:fast && npm test", "method": "validation" }],
  "requiredProofLaneIds": ["ci"]
}
```

After:

```json
{
  "proofLanes": [
    { "id": "ci-fast", "command": "npm run ci:fast", "method": "validation" },
    { "id": "unit-tests", "command": "npm test", "method": "validation" }
  ],
  "requiredProofLaneIds": ["ci-fast", "unit-tests"]
}
```

If you previously relied on shell expansion, move that logic into a real script and call the script as the proof lane.

## Proof Output Now Uses Inherited StdIO

Proof commands now run with inherited stdio instead of redirecting stdout into stderr.

Operational effect:

- proof stdout stays on stdout
- proof stderr stays on stderr
- CLI consumers that assumed `shadow run` emitted only JSON on stdout must now parse the trailing JSON payload instead of the entire stream

This is intentional. The command no longer rewrites proof-lane output streams behind the operator's back.
