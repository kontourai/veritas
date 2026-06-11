# Releasing Veritas

Releases are automated with release-please: merges to main accumulate into a release PR; merging it tags the version, and the release workflow then triggers the publish workflow via `workflow_dispatch` at that tag (tags created with `GITHUB_TOKEN` do not fire tag-push workflows). The publish job itself remains tag-gated — dispatch at a non-tag ref publishes nothing. Use conventional commit prefixes (feat:, fix:, docs:, chore:) so version inference works. The manual tag flow below remains valid for exceptional releases.

This document is the operator checklist for cutting a release of `@kontourai/veritas`.

## Preconditions

- `npm run verify` passes
- `npm test` passes
- `npm run test:coverage:check` passes
- `npm run prepublishOnly` passes
- `CHANGELOG.md` is updated
- package metadata in `package.json` is correct
- any breaking changes are documented in [MIGRATING.md](./MIGRATING.md)

## Release Flow

1. Update `package.json` version.
2. Update `CHANGELOG.md`.
3. Merge the release commit to `main`.
4. Create and push a tag matching the package version, for example `v0.4.0`.
5. Let `.github/workflows/publish-npm.yml` publish the package.
6. Confirm the published tarball contents and README rendering on npm.

## Tarball Audit

Before the first publish of a release candidate, run:

```bash
npm run test:coverage:check
npm pack --dry-run
```

Check:

- the tarball only contains intended files from the `files` allowlist
- no local `.veritas/evidence/` or other disposable artifacts are included
- package size is still reasonable for a CLI-plus-docs package

## Trusted Publishing

The repo publishes through npm trusted publishing via GitHub Actions OIDC. Configure npmjs.com to trust:

- organization or user: `kontourai`
- repository: `veritas`
- workflow filename: `publish-npm.yml`
- allowed action: `npm publish`

For an already-published package, you can configure the same relationship from a local authenticated npm CLI with npm `11.15.0` or later:

```bash
npm trust github @kontourai/veritas --repo kontourai/veritas --file publish-npm.yml --allow-publish
```

Publishing through trusted publishing requires npm CLI `11.5.1` or later in CI. The checked-in workflow uses Node 24 for the publish job so npm can authenticate through OIDC without a long-lived `NPM_TOKEN`.

If that OIDC path is unavailable, use the fallback path documented in [docs/guides/publish-and-release.md](./guides/publish-and-release.md).
