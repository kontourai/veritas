# Veritas Plugin Authoring

Veritas plugins import evidence from tool-owned output files and attach that evidence to authored claims in `veritas.claims.json`.

Plugins do not create claims during a run. Claims are authored and committed first; plugins collect evidence for matching `claimType` values.

## Plugin Module

A plugin is a plain ESM module with a default export:

```js
export default {
  name: '@vendor/veritas-plugin',
  version: '1.0.0',
  author: { name: 'Vendor Name', url: 'https://example.com' },
  claimTypes: [{
    id: 'vendor-check',
    displayName: 'Vendor check',
    description: 'Evidence imported from vendor output.',
    defaultImpact: 'high',
    defaultSurface: 'vendor.security',
    policyTemplateId: 'vendor.check',
  }],
  importEvidence(rawOutput, claims, context) {
    return [];
  },
};
```

`importEvidence(rawOutput, claims, context)` receives:

- `rawOutput`: contents of the configured input file, or `''` when the file is absent.
- `claims`: authored claim definitions whose `claimType` matches a plugin claim type.
- `context`: `{ runId, sourceRef, timestamp, rootDir }`.

Return Surface evidence records with `id`, `claimId`, `evidenceType`, `method`, `excerptOrSummary`, `observedAt`, and optional `passing`, `blocking`, and `metadata`.

Veritas adds `metadata._plugin` to every plugin evidence item:

```json
{
  "_plugin": {
    "name": "@vendor/veritas-plugin",
    "version": "1.0.0",
    "author": { "name": "Vendor Name" }
  }
}
```

The Surface Console uses that attribution to show that evidence came from the tool owner instead of hand-written application mapping.

## Register A Plugin

Add plugin entries to `.veritas/repo-map.json`:

```json
{
  "plugins": [
    { "package": "@vendor/veritas-plugin", "inputFile": ".veritas/external/vendor-output.json" }
  ]
}
```

`package` can be an installed package name or a repo-relative module path. `inputFile` is relative to the repo root.

List loaded plugins:

```bash
veritas plugin list
```

## Scaffold Claims

Plugins may expose `scaffoldClaims(repoName)` to create default claim definitions:

```bash
veritas claim scaffold --plugin @vendor/veritas-plugin
```

The scaffold command adds missing claims and policy templates to `veritas.claims.json`; it does not duplicate existing claim IDs.

## Reference

See `examples/plugins/npm-audit.mjs` for a minimal npm audit evidence importer. It maps `npm audit --json` output to evidence for authored `package-version-safety` claims.
