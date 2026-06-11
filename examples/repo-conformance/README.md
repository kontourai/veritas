# Veritas Repo Conformance Examples

These files are curated evidenceCheck artifacts generated from the `veritas` repo using its tracked `.veritas/` configuration.

They are intentionally copied out of `.veritas/evidence/`, `.veritas/standards-feedback-drafts/`, and `.veritas/standards-feedback/` so the repo can demonstrate a self-hosted report and standards feedback flow without committing transient local state.

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

Generate an untracked point-in-time self-hosting snapshot with:

```bash
npm run veritas:conformance
```
