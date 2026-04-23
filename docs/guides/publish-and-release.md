# Publish And Release

This guide answers three practical questions:

1. what gets published
2. what still needs to be configured outside the repo
3. what GitHub Actions already exists in the repo to automate release and docs deployment

## What We Publish

The npm package is:

- `@kontourai/veritas`

The current publish surface is defined in [package.json](../../package.json) and includes:

- `bin/` for the CLI entrypoints
- `src/` for the framework logic
- `schemas/` for the contract surface
- `adapters/` for reference adapters
- `policy-packs/` for reference policy packs
- `docs/` for packaged documentation
- `examples/` for canonical fixtures
- `README.md` and `LICENSE`

That means the npm package is not only the CLI binary. It also publishes the schema and fixture material needed to understand and extend the framework.

## What GitHub Actions Already Does

This repo now ships three core automation lanes:

- [CI](../../.github/workflows/ci.yml) runs `npm run verify`, `npm test`, and the line-coverage gate on Node 18 and Node 22
- [Docs Pages](../../.github/workflows/pages.yml) builds the Markdown docs into a GitHub Pages site
- [Publish NPM](../../.github/workflows/publish-npm.yml) verifies on Node 18 and Node 22, then publishes `@kontourai/veritas` on tag pushes like `v0.1.0`

## What We Need From You

### 1. GitHub Pages

To make the Pages workflow live, you need repo admin access and should:

1. open GitHub repo settings
2. go to `Pages`
3. set the source to `GitHub Actions`

Once that is enabled, the `Docs Pages` workflow can deploy the generated site to:

- `https://kontourai.github.io/veritas/`

### 2. npm Publishing

The current publish workflow is configured for token-based publishing through the GitHub Actions secret:

- `NPM_TOKEN`

What you need to do on the npm side:

1. make sure the `@kontourai/veritas` package name is available to the `@kontourai` org
2. create an npm access token with publish permission for that package scope
3. add it to this GitHub repo as the `NPM_TOKEN` Actions secret
4. confirm the publishing identity has permission to create or update the package

If you later want npm trusted publishing instead, you can swap the workflow back to OIDC-based auth and remove the token secret.

### 3. Release Trigger

The current publish workflow triggers on tags matching:

- `v*`

So the normal release path is:

1. bump `package.json` version
2. commit the release
3. merge that commit to `main`
4. create and push a tag like `v0.1.0` that points at the `main` commit you intend to release

## Suggested First Publish Checklist

1. Enable GitHub Pages from Actions.
2. Confirm the `NPM_TOKEN` Actions secret is present and valid for `@kontourai/veritas`.
3. Run the CI workflow on `main`.
4. Run the Docs Pages workflow once manually.
5. Confirm the package metadata looks right on npm:
   - package name
   - homepage
   - repository
   - bugs URL
   - README rendering
6. Tag the first release and let `Publish NPM` run.

The current coverage gate enforces at least 80% aggregate line coverage.

## Badges

The root README should expose at least:

- npm version badge
- CI badge

If GitHub Pages is enabled, adding a docs badge is also reasonable, but the core two are npm and CI.
