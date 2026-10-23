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

## Normal release flow

1. Merge reviewed conventional commits to `main`.
2. Review the release-please PR: package version, changelog and migration notes.
3. Merge that PR through the repository's normal process.
4. Confirm the Release Please workflow created the matching tag and dispatched Publish NPM at that tag.
5. Confirm both verification jobs and publication succeeded, then inspect the exact version on npm and its provenance.

The workflows are [release-please.yml](../.github/workflows/release-please.yml) and [publish-npm.yml](../.github/workflows/publish-npm.yml). Publication rejects a mismatched tag or a commit outside `main`; dispatching at a branch ref does not bypass those checks. If publication was interrupted, inspect its state before dispatching the same tag again. An already-published version is skipped.

For an exceptional manual release, review and merge the version/changelog changes first, create the matching tag at that main commit, and let the same publish workflow verify it. This is not the routine release path.

## Tarball Audit

Before the first publish of a release candidate, run:

```bash
npm run test:coverage:check
npm pack --dry-run
```

Check:

- the tarball only contains intended files from the `files` allowlist
- no local `.kontourai/veritas/evidence/` or other disposable artifacts are included
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

If OIDC is unavailable, inspect the trusted-publisher configuration and workflow logs. The checked-in workflow has no token fallback; changing authentication requires a reviewed workflow change. See [publication infrastructure](guides/publish-and-release.md).
