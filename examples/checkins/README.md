# Veritas Check-in Examples

These files are curated proof artifacts generated from the `veritas` repo using its tracked `.veritas/` configuration.

They are intentionally copied out of `.veritas/evidence/`, `.veritas/eval-drafts/`, and `.veritas/evals/` so the repo can demonstrate a self-hosted report and eval flow without committing transient local state.

Current example set:

- `veritas-repo-report.json`
- `veritas-repo-report.md`
- `veritas-repo-eval-draft.json`
- `veritas-repo-eval-draft.md`
- `veritas-repo-eval.json`
- `veritas-repo-eval.md`
- `veritas-repo-checkin-red.json`
- `veritas-repo-checkin-red.md`

Refresh them with:

```bash
npm run veritas:checkin:examples
```

Generate an untracked point-in-time self-hosting snapshot with:

```bash
npm run veritas:checkin
```
