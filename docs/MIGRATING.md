# Migrating Between Breaking Changes

## Proof Commands No Longer Run Through a Shell

`veritas shadow run` now tokenizes proof commands and executes them directly instead of passing the full string through `SHELL -lc`.

This closes a config-level command-injection path, but it changes the proof-lane contract:

- shell control operators such as `&&`, `||`, `|`, `>`, and `<` are no longer interpreted
- environment-variable expansion such as `$FOO` is no longer interpreted
- quoting still works for grouping argv tokens

### How To Migrate

Recommended:

1. Split compound proof flows into multiple `requiredProofLanes` entries.
2. Keep each proof lane to one executable plus its argv.

Before:

```json
{
  "requiredProofLanes": ["npm run ci:fast && npm test"]
}
```

After:

```json
{
  "requiredProofLanes": ["npm run ci:fast", "npm test"]
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
