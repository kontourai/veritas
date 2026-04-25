# Veritas — Claude Code Instructions

This is the Veritas framework repo. Veritas is a repo-local framework for trustworthy AI-assisted development.

## This repo runs Veritas on itself

The `.veritas/` directory contains the live governance configuration for this repo. Veritas uses its own adapter, policy pack, and team profile to govern its own development.

## Key commands

```bash
npm test                        # run the full test suite
npm run veritas:proof           # run the proof lane
npm run veritas:checkin         # full shadow run + check-in report
npm run veritas:checkin:report  # evidence report only
node scripts/build-pages-site.mjs  # rebuild the GitHub Pages site
```

After making code changes, run `npm run veritas:checkin:report` to generate an evidence artifact for the working tree.

## Governance surface — do not modify

The following files are Zone 1 (constitutional core). Do not modify them:

- `.veritas/GOVERNANCE.md` — terse agent-facing governance instructions
- `.veritas/repo.adapter.json` — the repo surface map
- `.veritas/policy-packs/` — the policy rules
- `.veritas/team/` — team profile and thresholds

You may add new advisory-tier rules or surface nodes for new feature areas (Zone 2). You may not modify, demote, or delete existing hard-invariant rules or governance-surface definitions.

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
After changes, run `veritas shadow run` and address any FAIL lines before finishing.
<!-- veritas:governance-block:end -->
