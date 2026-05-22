# Veritas — Claude Code Instructions

This is the Veritas product repo. Veritas is a repo-local governance product for trustworthy AI-assisted development.

## This repo runs Veritas on itself

The `.veritas/` directory contains the live governance configuration for this repo. Veritas uses its own Repo Map, Repo Standards, and team profile to govern its own development.

## Key commands

```bash
npm test                        # run the full test suite
npm run veritas:evidence-check  # run the evidenceCheck
npm run veritas:checkin         # full readiness check + check-in report
npm run veritas:checkin:report  # evidence report only
node scripts/build-pages-site.mjs  # rebuild the GitHub Pages site
```

After making code changes, run `npm run veritas:checkin:report` to generate an evidence artifact for the working tree.

## Protected Standards

The following files define Protected Standards. Do not modify them without fresh authority:

- `.veritas/GOVERNANCE.md` — terse agent-facing governance instructions
- `.veritas/repo.adapter.json` — the Repo Map
- `.veritas/repo-standards/` — the Repo Standards
- `.veritas/team/` — team profile and thresholds

You may propose additive Standards Growth for new feature areas. Do not modify, demote, or delete existing required standards or protected definitions.

See `.veritas/GOVERNANCE.md` for the terse agent-facing governance instructions.

## Test output

The test suite intentionally invokes the CLI with invalid inputs to test error handling. These produce error messages that look like:

```
Error: eval record requires a repo-local draft artifact inside .veritas/eval-drafts/
```

These are expected. The messages are not failures.

## Site

The GitHub Pages site is built from `docs/` via `scripts/build-pages-site.mjs` into `.site-src/` (gitignored). The pages workflow deploys it. Run the build script after any docs changes to verify it builds cleanly.

<!-- veritas:governance-block:start -->
This repo uses Veritas for AI governance. Read `.veritas/GOVERNANCE.md` before making changes.
After changes, run `veritas readiness` and address any FAIL lines before finishing.
<!-- veritas:governance-block:end -->
