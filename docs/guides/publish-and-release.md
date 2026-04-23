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

- [CI](../../.github/workflows/ci.yml) runs `npm run verify` and `npm test`
- [Docs Pages](../../.github/workflows/pages.yml) builds the Markdown docs into a GitHub Pages site
- [Publish NPM](../../.github/workflows/publish-npm.yml) publishes `@kontourai/veritas` on tag pushes like `v0.1.0`

## What We Need From You

### 1. GitHub Pages

To make the Pages workflow live, you need repo admin access and should:

1. open GitHub repo settings
2. go to `Pages`
3. set the source to `GitHub Actions`

Once that is enabled, the `Docs Pages` workflow can deploy the generated site to:

- `https://kontourai.github.io/veritas/`

### 2. npm Publishing

The publish workflow is set up for npm trusted publishing using GitHub Actions OIDC.

What you need to do on the npm side:

1. make sure the `@kontourai/veritas` package name is available to the `@kontourai` org
2. configure npm trusted publishing for this GitHub repo and the `Publish NPM` workflow
3. confirm the publishing identity has permission to create or update the package

If you prefer not to use trusted publishing, the fallback is:

1. create an npm automation token with publish access to `@kontourai/veritas`
2. add it to GitHub repo secrets as `NPM_TOKEN`
3. adjust the publish workflow to use `NODE_AUTH_TOKEN`

Trusted publishing is the cleaner path.

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
2. Configure npm trusted publishing for `@kontourai/veritas`.
3. Run the CI workflow on `main`.
4. Run the Docs Pages workflow once manually.
5. Confirm the package metadata looks right on npm:
   - package name
   - homepage
   - repository
   - bugs URL
   - README rendering
6. Tag the first release and let `Publish NPM` run.

## Badges

The root README should expose at least:

- npm version badge
- CI badge

If GitHub Pages is enabled, adding a docs badge is also reasonable, but the core two are npm and CI.
