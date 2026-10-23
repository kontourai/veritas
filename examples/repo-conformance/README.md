# Veritas Repo Conformance Examples

These files are curated format fixtures generated from the Veritas configuration. The generator supplies a synthetic successful baseline and builds report artifacts without executing the configured evidence checks. A fixture can therefore show a successful baseline alongside missing required execution; it is not a current readiness, CI or release qualification receipt.

They are intentionally copied out of `.kontourai/veritas/evidence/`, `.kontourai/veritas/standards-feedback-drafts/`, and `.kontourai/veritas/standards-feedback/` so the repo can demonstrate a self-hosted report and standards feedback flow without committing transient local state.

Current example set:

- `veritas-repo-report.json`
- `veritas-repo-report.md`
- `veritas-repo-standards-feedback-draft.json`
- `veritas-repo-standards-feedback-draft.md`
- `veritas-repo-standards-feedback.json`
- `veritas-repo-standards-feedback.md`
- `veritas-repo-conformance-red.json`
- `veritas-repo-conformance-red.md`

Refresh the report/standards feedback examples with:

```bash
npm run veritas:conformance:examples
```

The red repo conformance examples are maintained as a curated regression snapshot for the unhealthy path.

Derive an untracked summary from existing local evidence with:

```bash
npm run veritas:conformance
```
