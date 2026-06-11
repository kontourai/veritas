# Tests

`tests/` holds the product verification suite for Veritas. The tree is partly domain-organized and partly top-level integration tests; do not assume a top-level file is low-level just because it is not inside a subdirectory.

## Test Domains

| Path | Domain | What it verifies |
| --- | --- | --- |
| `*.test.mjs` | Core product and integration behavior | Readiness, governance, claims, plugins, repo conformance, reference fixtures, runner behavior, and broad CLI/product flows. `veritas.test.mjs` is intentionally broad and should be split only in scoped follow-up work. |
| `browser/` | Documentation site browser checks | Playwright config, local docs-site server, and browser specs for generated documentation pages. |
| `cli/` | Focused CLI behavior | CLI-specific flows that are narrow enough to keep out of the larger top-level integration files. |
| `integrations/` | Agent/runtime integrations | Integration behavior for external agent runtimes, currently including Claude Code session log handling. |
| `standards-feedback/` | Standards feedback subsystem | Filesystem observation and recommendation generation for standards-feedback records and drafts. |
| `surface/` | Surface projection and consumption | Readiness-derived claim fixtures and trust report consumption behavior at the Veritas-to-Surface boundary. |
| `helpers.mjs` | Shared test helpers | Temporary repo setup, JSON helpers, command wrappers, and fixtures used across domains. |

## Verification Commands

Run the full Node test suite:

```bash
npm test
```

Run the pre-push content and reference checks:

```bash
npm run verify
```

Run docs browser checks after changing the generated docs site or browser specs:

```bash
npm run docs:pages:build
npm run docs:pages:test:browser
```

Run Veritas self-governance checks after code or governance-relevant documentation changes:

```bash
npm run veritas:conformance:report
```

The repo hook delegates to `npm run test:prepush`, which currently delegates to `npm run verify`.

## Example References

Many tests read tracked examples from `examples/`. Before moving or renaming any example file, search for direct path references:

```bash
rg -n "examples/path-or-file" tests docs scripts README.md package.json
```
