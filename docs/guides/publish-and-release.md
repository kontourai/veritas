# Publication infrastructure

This is a maintainer reference. For the normal release procedure, use [Releasing Veritas](../RELEASING.md).

## Published artifacts

The npm package `@kontourai/veritas` includes the CLI, implementation, schemas, examples, documentation and optional Governance Kit assets. The `files` and `exports` fields in [package.json](../../package.json) are authoritative. Inspect `npm pack --dry-run` before publishing; generated `.kontourai/` evidence is not package source.

## Automation

- [CI](../../.github/workflows/ci.yml) runs verification, tests and coverage on Node 22 and 24.
- [Docs](../../.github/workflows/docs.yml) validates the Corpus documentation and deploys the site from `main`.
- [Release Please](../../.github/workflows/release-please.yml) maintains a release PR, creates the version tag after release and dispatches publication at that tag.
- [Publish NPM](../../.github/workflows/publish-npm.yml) accepts `v*` tag pushes or manual dispatch. Verification runs on Node 22 and 24. Publication uses Node 24 and requires the ref name to match the package version and the tagged commit to be reachable from `main`. An already-published version is skipped.

Dispatch publication at a version tag, not at `main`: the version/ref validation rejects a branch ref.

## External setup

Repository administrators configure GitHub Pages to use GitHub Actions. The public site is `https://kontourai.github.io/veritas/`.

The npm package's trusted publisher must allow `kontourai/veritas`, workflow `publish-npm.yml`, to publish. The workflow uses OIDC and publishes provenance; it does not use an `NPM_TOKEN`. See the [release guide](../RELEASING.md#trusted-publishing) for the configuration command and npm version requirements.

Release automation also needs the configured GitHub App identity described in the release workflow. Do not add credentials to documentation or bypass tag/reachability checks to recover a failed run. Inspect the failed step and repair that prerequisite. Introducing token-based publication would be a separately reviewed workflow change.
