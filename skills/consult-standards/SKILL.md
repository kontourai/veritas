---
name: "consult-standards"
description: "Get just-in-time Veritas governance guidance for a file or work area before editing it by running `veritas explain`; use in repositories with an active `.veritas/` configuration."
---

# Consult Repo Standards

Before editing a governed file, ask the Veritas engine what applies:

```bash
npm exec -- veritas explain --file src/path/to/file.ts
npm exec -- veritas explain --work-area <work-area-id>
```

Read the matching Requirement, Enforcement Level, do/don't guidance, examples, and current
Surface status. `No matching requirement found.` means no additional Repo Standard matched;
it is not an error.

The installed Claude Code `PreToolUse` hook presents matching guidance automatically before
`Edit`, `MultiEdit`, and `Write` calls with a path. Other runtimes can request the structured
form with `veritas explain --file <path> --json`; they should do so at task admission or before
the first edit of that path. A hook briefing is not behavioral test evidence.

This is read-only guidance. It does not evaluate a Flow gate, mutate Repo Standards, or replace
readiness enforcement. Veritas owns matching and projection; this skill reimplements none of it.
