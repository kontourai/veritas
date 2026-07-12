# Operational Readiness Summaries

This repo currently uses self-hosting scripts to dogfood Veritas on itself. They produce derived readiness, conformance, and standards-feedback summaries.

## What Is Tracked

The repo tracks protected standards inputs:

- `.veritas/README.md`
- `.veritas/repo-map.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/authority/default.authority-settings.json`

These file names currently hold the Repo Map, Repo Standards, and related protected standards settings.

## What Is Not Tracked

Generated evidence and read models are local or CI artifacts:

- `.kontourai/veritas/evidence/`
- `.kontourai/veritas/claims/`
- `.surface/runs/`
- `.kontourai/veritas/external/`
- `.kontourai/veritas/standards-feedback-drafts/`
- `.kontourai/veritas/standards-feedback/`
- `.kontourai/veritas/repo-conformance/`

They should inform product work, not create distribution churn.

## Main Commands

Current self-hosting scripts:

```bash
npm run veritas:evidence-check
npm run veritas:conformance:report
npm run veritas:conformance:readiness
npm run veritas:conformance
npm run veritas:conformance:examples
npm run veritas:conformance:verify
```

The outputs should be interpreted as generated evidence, readiness summaries, repo conformance summaries, and standards feedback.

## What This Repo Proves

The self-hosting flow should prove that:

1. the repo map classifies the Veritas repo without unresolved files
2. the repo standards evaluate concrete requirements for the product
3. generated evidence records what changed and what passed or failed
4. examples stay aligned with current schema
5. CI can publish readiness/conformance summaries without committing generated output
6. optional external evidence checks can be captured without becoming required before they are trusted

## Where To Inspect Current Examples

- [examples/repo-conformance/veritas-repo-report.json](../../examples/repo-conformance/veritas-repo-report.json)
- [examples/repo-conformance/veritas-repo-standards-feedback-draft.json](../../examples/repo-conformance/veritas-repo-standards-feedback-draft.json)
- [examples/repo-conformance/veritas-repo-standards-feedback.json](../../examples/repo-conformance/veritas-repo-standards-feedback.json)
- [examples/repo-conformance/veritas-repo-conformance-red.json](../../examples/repo-conformance/veritas-repo-conformance-red.json)

If this flow feels awkward, the fix should usually land in the product surface, not in a repo-specific exception.

## Content-Boundary Consumer Contract

`@kontourai/veritas` exports `runContentBoundary` from its package root. Consumers
own their labeled `RegExp` vocabulary and explicit repo-local exclusions; the
shared engine owns Git discovery, runtime-artifact policy, text scanning, and
deterministic quoted-path `path:line label` output. JSON-style pathname and
label quoting keeps control characters such as newlines on one physical output
line while leaving valid Unicode readable. A CommonJS gate can stay thin:

```js
#!/usr/bin/env node

const SELF = "scripts/check-content-boundary.cjs";
const bannedTerms = [
  { label: "repo-private term", pattern: /replace-with-local-pattern/i },
];

(async () => {
  const { runContentBoundary } = await import("@kontourai/veritas");
  const result = runContentBoundary({
    rootDir: process.cwd(),
    bannedTerms,
    ignoredPaths: [SELF],
  });
  (result.ok ? console.log : console.error)(result.output);
  if (!result.ok) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
```

The runner returns `{ ok, findings, output }`; each finding has `filePath`,
`line`, and `label`. It enumerates tracked files and untracked, non-ignored files
from `rootDir`. Provenance is significant: a tracked path below
`.kontourai/flow-agents/` is a policy violation, while an untracked path below
that prefix is an allowed local runtime artifact and is not vocabulary-scanned.
Git-ignored files are not enumerated. Other tracked and untracked text files are
scanned once, with stable output ordering. Git pathname bytes remain intact
through enumeration and filesystem lookup. A pathname that is not valid UTF-8,
or an enumerated scannable file that cannot be resolved or read, fails closed
with a typed finding instead of being silently skipped. Binary content remains
an intentional skip after a successful read. Before any read, the engine
resolves both the repository root and target canonically; a symlink target
outside the repository is rejected without reading outside content. The engine
opens the validated canonical target with final-component symlink following
disabled, but does not read immediately. It snapshots the device, inode, and
type of every canonical-root-to-target component before open, repeats that walk
after open, and requires the opened descriptor to identify the unchanged final
component. Any symlink, missing or changed component, or descriptor mismatch
fails closed before a content read; the descriptor is always closed. This
pre/open/post identity protocol prevents persistent and swap-open-restore parent
redirection without reopening the lexical candidate. The filesystem test seam's
`read` operation receives only that validated descriptor; there is no supported
path-based `readFile` hook that can reopen a pathname after validation.
Concurrent in-place
mutation of the same inode is outside pathname-containment scope. Runtime
artifact policy is evaluated first, so allowed untracked Flow Agents artifacts
are neither resolved nor vocabulary-scanned.

### Survey and Traverse migration contract

Migration is a separate consumer-repository change after a Veritas release that
contains this API. Each consumer must pin a compatible released npm version in
its manifest and lockfile; do not use a copied engine, floating Git dependency,
unpublished checkout, or cross-repo relative import. Preserve that repository's
existing vocabulary labels, regexes, and self-exclusion unless a separate change
authorizes vocabulary edits, and remove its duplicate discovery/scanning logic.

Each migration must execute the real thin adapter in a child process and prove
that a banned fixture is Git-verified untracked immediately before the gate
exits non-zero and names its path and line. It must also prove tracked banned
text is red, clean content is green, an untracked Flow Agents runtime artifact
is allowed and not scanned, and a tracked runtime artifact is red. Run the
consumer's focused test and native verify/prepush chain and record the released
package version and command evidence in its acceptance record.

### Surface audit contract

Audit Surface in its own lane before deciding to migrate it. Record the relevant
script path and hash (or its absence), both Git enumeration commands, runtime
prefix and tracked/untracked behavior, vocabulary ownership, installed Veritas
version, and whether the verification chain invokes the gate. If it shares the
defective implementation family, apply the same migration and untracked-red
proof. Otherwise publish an evidence-backed no-change rationale.

### Closure restriction

A Veritas merge or release alone does not prove consumer remediation. Do not
close the superseded Survey or Traverse defect until that repository consumes a
released compatible Veritas version and its real adapter passes the verified
untracked pre-commit red regression. Provider closure and package publication
remain separate authorized operations.
