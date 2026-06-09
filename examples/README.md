# Examples Inventory

`examples/` contains tracked artifacts and small executable samples used by docs, tests, and release packaging. Treat these files as developer-facing reference material unless a task explicitly says to refresh or relocate them.

Do not move files in this tree without updating references in `tests/`, `docs/`, `scripts/`, package metadata, and any Veritas conformance examples that name the path directly.

## Directory Classes

| Path | Class | Purpose | Refresh or edit guidance |
| --- | --- | --- | --- |
| `benchmarks/<marker>/` | Benchmark fixtures | Marker-suite scenarios, with-Veritas and without-Veritas trial outputs, and comparison reports grouped by marker family. | Keep each marker family's scenario, trial, and comparison files together; update `benchmarks/suites/`, `tests/reference.test.mjs`, and CLI examples when paths change. |
| `benchmarks/suites/` | Benchmark suite fixtures | Suite definitions and suite reports that aggregate marker-family fixtures. | Suite paths are relative to this directory, so moving marker folders requires updating suite JSON paths in the same change. |
| `classification/` | Canonical classification fixtures | Reference rule-group examples for work-agent convergence and schema/reference tests. | Edit only when the classification contract changes and update tests in the same change. |
| `evidence/` | Canonical evidence fixtures | Passing, failing, policy-gap, and fallow advisory evidence records used by reference tests and docs. | Keep stable as schema examples; refresh alongside evidence schema or report contract changes. |
| `external/` | External tool samples | Example output from adjacent tools that Veritas can consume or discuss, currently including Fallow audit output. | Keep separate from Veritas-native evidence so source semantics stay clear. |
| `repo-conformance/` | Generated canonical examples | Curated self-hosted conformance, readiness report, standards-feedback, and red-path artifacts copied out of generated `.veritas/` output for docs and tests. | Refresh green-path examples with `npm run veritas:conformance:examples`; red-path fixtures are curated regression snapshots. |
| `repo-standards/` | Starter templates and fixtures | Template Repo Standards for common repo shapes plus fixture snippets that demonstrate expected readiness warnings. | Edit when template behavior changes; keep fixture READMEs aligned with the corresponding `*.repo-standards.json` file. |
| `standards-feedback/` | Canonical standards-feedback fixtures | Accepted feedback, draft feedback, and authority settings examples used by feedback tests and docs. | Refresh alongside standards-feedback schema or authority behavior changes. |
| `plugins/` | Plugin samples | Minimal sample plugins showing the Veritas plugin API, currently an npm audit plugin. | Keep executable and importable by `tests/plugins.test.mjs`. |
| `surface/` | Executable external tool samples | Small scripts that demonstrate handing Veritas output to Surface-oriented consumers. | Keep as sample scripts and update direct references when paths change. |

## Naming Notes

- **Canonical fixtures** are stable files that tests and docs use as examples of current contracts.
- **Generated canonical examples** are tracked snapshots produced from local generation commands so docs can link to concrete output without committing transient `.veritas/` state.
- **Benchmark fixtures** represent scenario inputs and observed outputs; they are not generic examples for new users.
- **External tool samples** preserve the fact that the data originated outside Veritas.
- **Plugin samples** should remain runnable modules, not static documentation snippets.

## Useful Checks

```bash
npm test
npm run verify
npm run veritas:conformance:examples
```

For path changes, also search direct references before and after the edit:

```bash
rg -n "examples/path-or-file" README.md docs src tests scripts package.json .github .githooks .veritas
```
