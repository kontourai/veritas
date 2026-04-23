# Releasing Veritas

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
4. Create and push a tag matching the package version, for example `v0.1.0`.
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

If that OIDC path is unavailable, use the fallback path documented in [docs/guides/publish-and-release.md](./guides/publish-and-release.md).
