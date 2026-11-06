# Veritas Agent Instructions

This is the Veritas product repo. Veritas is a repo-local governance product for trustworthy AI-assisted development.

## This repo runs Veritas on itself

The `.veritas/` directory contains the live governance configuration for this repo. Veritas uses its own Repo Map, Repo Standards, and authority settings to govern its own development.

## Key commands

```bash
npm run test:prepush
npm run prepush
npm test
npm run veritas:evidence-check
npm run veritas:conformance
npm run veritas:conformance:report
npm run docs:check
```

Docs are published with docs-kit: `corpus.json` lists the published docs and MCP topics, `npm run docs:check` is the gate, and when you change code a document `covers`, update that document.

The tracked repo hook is `.githooks/pre-push`; local checkouts must set `core.hooksPath=.githooks` to use it.

After making code changes, run `npm run veritas:conformance:report` to generate an evidence artifact for the working tree.

## Protected Standards

Do not modify these without fresh authority:

- `.veritas/GOVERNANCE.md`
- `.veritas/repo-map.json`
- `.veritas/repo-standards/`
- `.veritas/authority/`

You may propose additive Standards Growth for new feature areas. Do not modify, demote, or delete existing required standards or protected definitions.

Inside this checkout `npx --no @kontourai/veritas` cannot resolve Veritas itself, so run `npm run veritas:readiness` where the block below says `npx --no @kontourai/veritas readiness`.

## Source-qualified documentation review

The Corpus gate selects the canonical documents mapped in `corpus.json` when
implementation inputs change. Review those claims against the actual callers.
Update inaccurate prose in the same PR. If it remains accurate, record a new
local input/output byte review with a concrete explanation and limits in
`corpus-content.json`, following the [shared review contract](https://github.com/kontourai/corpus/blob/b127e35a818b532369843731b3c64792baade83e/docs/related-content.md#review-an-unchanged-covering-document).
`npm run docs:check -- --base origin/main` uses that same reviewed Corpus source.
Do not add filler text or refresh hashes without inspecting the change. A
passing check does not certify semantic correctness, runtime or publication.

<!-- veritas:governance-block:start -->
This repo uses Veritas for AI governance. Read `.veritas/GOVERNANCE.md` before making changes.
After changes, run `npx --no @kontourai/veritas readiness` and address any FAIL lines before finishing.
If npx says the package is missing, install this repo's dependencies, adding `@kontourai/veritas` as a development dependency if it is not one, and run it again.
<!-- veritas:governance-block:end -->
