# Veritas Agent Instructions

This is the Veritas product repo. Veritas is a repo-local governance product for trustworthy AI-assisted development.

## This repo runs Veritas on itself

The `.veritas/` directory contains the live governance configuration for this repo. Veritas uses its own Repo Map, Repo Standards, and authority settings to govern its own development.

## Key commands

```bash
npm test
npm run veritas:evidence-check
npm run veritas:conformance
npm run veritas:conformance:report
node scripts/build-pages-site.mjs
```

After making code changes, run `npm run veritas:conformance:report` to generate an evidence artifact for the working tree.

## Protected Standards

Do not modify these without fresh authority:

- `.veritas/GOVERNANCE.md`
- `.veritas/repo-map.json`
- `.veritas/repo-standards/`
- `.veritas/authority/`

You may propose additive Standards Growth for new feature areas. Do not modify, demote, or delete existing required standards or protected definitions.

<!-- veritas:governance-block:start -->
This repo uses Veritas for AI governance. Read `.veritas/GOVERNANCE.md` before making changes.
After changes, run `veritas readiness` and address any FAIL lines before finishing.
<!-- veritas:governance-block:end -->
