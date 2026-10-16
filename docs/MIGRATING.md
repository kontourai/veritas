# Migration Guide

## Product Terminology Migration

Veritas now uses the product vocabulary in [reference/glossary.md](reference/glossary.md). Pre-glossary names should be renamed, not preserved as a public surface.

Current implementation names to migrate:

| Current implementation name | Canonical product name |
| --- | --- |
| repo standards | Repo Standards or Standards File |
| adapter | Repo Map |
| work area / work area | Work Area |
| rule | Requirement |
| evidenceCheck / evidenceCheck / evidenceCheck command | Evidence Check |
| evidence inventory | Evidence Check Inventory |
| readiness coverage | Readiness Coverage |
| authority settings | Repo Standards settings, authority settings, or rollout settings |
| eval | Standards Feedback |
| recommendation | Standards Recommendation |
| check-in | Readiness Report, Repo Conformance, or Standards Feedback depending on context |
| Protected Standards | Protected Standards |
| Standards Growth | Standards Growth |
| Generated Evidence | Generated Evidence |
| framework | Product, CLI, SDK, or implementation module depending on context |

Near-term rename targets:

1. Rename generated `.veritas/` files to standards/map/settings language.
2. Rename schema files and field names after generated files are settled.
3. Rename CLI command groups from implementation names to readiness, feedback, and recommendations.
4. Keep exact current implementation names only in migration notes, schema references, and code comments needed to explain an active rename.

## Standards Recommendation Module Moved

Standards Recommendation code now lives in the Standards Feedback subcontext.

Before:

```js
import {
  applyRecommendation,
  generateRuleRecommendations,
} from './src/recommendations.mjs';
```

After:

```js
import {
  applyRecommendation,
  generateRuleRecommendations,
} from './src/standards-feedback/recommendations.mjs';
```

The old `src/recommendations.mjs` module is removed instead of re-exported. Update internal imports and external consumers to the new path.

## Run Snapshots Move to `.kontourai/veritas/surface/`

Veritas writes run snapshots below the shared `.kontourai/` runtime root.

New paths:

```
.kontourai/veritas/surface/<run-id>.console.json
.kontourai/veritas/surface/latest.json
```

When updating an existing local checkout:

1. Ensure `.kontourai/` is present in `.gitignore` (current `veritas init` adds that exact entry when needed).
2. The next `veritas readiness` writes to the new path automatically.
3. Remove stale `.surface/` runtime files once they are no longer needed; do not add a `.surface/` ignore entry for Veritas output.

If you pass a `--read-model` flag explicitly to the Surface Console, set it to `.kontourai/veritas/surface/latest.json` or omit it entirely, since that path is now the default.

## Claims Are Now Authored, Not Generated Per Run

Veritas requires a committed claim store at `veritas.claims.json`. Per-run claim generation is no longer supported.

To migrate:

1. Run `npx --no @kontourai/veritas claim init` in the repo root.
2. Review the generated claim IDs, surfaces, policies, and metadata.
3. Commit `veritas.claims.json`.
4. Update any automation that referenced run-scoped claim IDs to use the stable authored claim IDs.

See [claim-authoring.md](./claim-authoring.md) for the full authoring workflow.

## Repo Map Evidence Checks Are Explicit Objects

Repo Maps now use explicit evidence-check objects. Removed command arrays such as `requiredEvidenceCheckCommands`, `defaultEvidenceCheckCommands`, and `surfaceEvidenceCheckCommands[].evidenceChecks` fail runtime validation with a migration-oriented error.

Before:

```json
{
  "evidence": {
    "requiredEvidenceCheckCommands": ["npm run ci:fast"],
    "defaultEvidenceCheckCommands": ["npm test"],
    "surfaceEvidenceCheckCommands": [
      { "nodeIds": ["src/api"], "evidenceChecks": ["npm run api:test"] }
    ]
  }
}
```

After:

```json
{
  "evidence": {
    "evidenceChecks": [
      { "id": "ci-fast", "command": "npm run ci:fast", "method": "validation" },
      { "id": "unit-tests", "command": "npm test", "method": "validation" },
      { "id": "api-tests", "command": "npm run api:test", "method": "validation" }
    ],
    "requiredEvidenceCheckIds": ["ci-fast"],
    "defaultEvidenceCheckIds": ["unit-tests"],
    "evidenceCheckRoutes": [
      { "componentIds": ["src/api"], "evidenceCheckIds": ["api-tests"] }
    ]
  }
}
```

Owned repos can update `.veritas/repo-map.json` manually or rerun `npx --no @kontourai/veritas init --force` and reapply local policy edits.

## Evidence Check Commands No Longer Run Through a Shell

`veritas readiness` now tokenizes evidenceCheck commands and executes them directly instead of passing the full string through `SHELL -lc`.

This closes a config-level command-injection path, but it changes the evidence-check contract:

- shell requirement operators such as `&&`, `||`, `|`, `>`, and `<` are no longer interpreted
- environment-variable expansion such as `$FOO` is no longer interpreted
- quoting still works for grouping argv tokens

### How To Migrate

Recommended:

1. Split compound evidenceCheck flows into multiple `evidenceChecks` entries.
2. Keep each evidenceCheck to one executable plus its argv.

Before:

```json
{
  "evidenceChecks": [{ "id": "ci", "command": "npm run ci:fast && npm test", "method": "validation" }],
  "requiredEvidenceCheckIds": ["ci"]
}
```

After:

```json
{
  "evidenceChecks": [
    { "id": "ci-fast", "command": "npm run ci:fast", "method": "validation" },
    { "id": "unit-tests", "command": "npm test", "method": "validation" }
  ],
  "requiredEvidenceCheckIds": ["ci-fast", "unit-tests"]
}
```

If you previously relied on shell expansion, move that logic into a real script and call the script as the evidenceCheck.

## Evidence Check Output Now Uses Inherited StdIO

Evidence Check commands now run with inherited stdio instead of redirecting stdout into stderr.

Operational effect:

- evidenceCheck stdout stays on stdout
- evidenceCheck stderr stays on stderr
- CLI callers that assumed `veritas readiness` emitted only JSON on stdout must now parse the trailing JSON payload instead of the entire stream

This is intentional. The command no longer rewrites evidence-check output streams behind the operator's back.

## Claim `surface` Field Renamed to `facet` (Surface 2.0, schemaVersion 5)

Veritas now depends on Surface 2.x (the `^2.0.0` range of the `@kontourai/surface` package) and the `hachure` version pinned in `package.json`. Both packages renamed the Claim `surface` field to `facet` (still an optional string) and bumped the Surface `TrustBundle` `schemaVersion` from 3 to 5.

Veritas now writes `facet` everywhere it previously wrote `surface`:

- `veritas.claims.json` claim entries use `facet` instead of `surface`.
- `veritas claim add` / `veritas claim edit` take `--facet <facet>` instead of `--surface <surface>`.
- Generated `trust.bundle.claims[]` entries carry `facet` and `trust.bundle.schemaVersion` is `5`.
- The Surface Console read model (`kind: "surface-console-read-model"`) reports `facet`, `facetCounts`, and `coverageByFacet` instead of `surface`, `surfaceCounts`, and `coverageBySurface`.

To migrate:

1. Update `@kontourai/surface` to `^2.0.0` and `hachure` to the version pinned in `package.json`.
2. Rewrite any hand-authored `veritas.claims.json` entries that still use `"surface"` to use `"facet"` instead (same value, new key).
3. Update any automation or scripts that pass `--surface` to `veritas claim add` / `veritas claim edit` to pass `--facet` instead.
4. Update any downstream consumer that reads `claim.surface` from `trust.bundle.claims[]` or the Surface Console read model to read `claim.facet` instead.

Surface 2.0.0's `validateTrustBundle` still tolerates a legacy `surface` value on read (mapping it onto `facet` with a one-time deprecation warning), but Veritas no longer emits `surface` anywhere.

## Generated Commands Run `npx --no @kontourai/veritas`

Hooks, package scripts, the CI snippet, the `.veritas/README.md` template, and printed next steps
now run `npx --no @kontourai/veritas`. The earlier spelling still works where Veritas is installed.
Where it is not, it fell back to a registry fetch without prompting when no terminal is attached,
and the `npm exec` form fetched the unscoped `veritas` package, which belongs to another project.
The Codex `PreToolUse` command and the Claude Code `SessionEnd` command run in the
agent's working directory, which can be a nested package without its own Veritas install. They look
upward from there for the nearest directory with Veritas installed, and run that install's entry
point with `node` only when the walk reaches the git root (see the next section). When it does not,
or nothing is installed on the way, they run plain `npx --no @kontourai/veritas`, which also finds a
global install. Two limits:

- In a repository with no `package.json`, plain npx uses npm's own upward search for the nearest
  `package.json` or `node_modules`, which can pass the git root.
- Inside a git submodule with its own `package.json`, or a worktree nested inside the main checkout
  with no install of its own, the hook now refuses where the earlier spelling ran the outer install.

Codex on Windows runs hooks through PowerShell and carries a native `commandWindows` override;
see [the Windows entry selection change](#windows-hooks-run-the-entry-they-validate).
Files Veritas already wrote keep the earlier spelling until you refresh them:

- `.githooks/post-commit`: run `npx --no @kontourai/veritas setup repo-hooks --force`. Without
  `--force` the command refuses, because the tracked hook no longer matches the current one.
- Claude Code (`.veritas/hooks/pre-tool-use.sh`, `.veritas/hooks/stop.sh`, `.claude/settings.json`):
  run `npx --no @kontourai/veritas integrations claude-code install --force`.
- Codex (`.veritas/hooks/agent-runtime.sh`, `.veritas/runtime/codex-hooks.json`, and the hooks
  file named by `--codex-home` or `--target-hooks-file`): run
  `npx --no @kontourai/veritas integrations codex install --force` with the same option you
  installed with. In the hooks file it replaces the handlers earlier releases wrote, matched by
  their exact command, and leaves every other handler alone.
- A `.codex/hooks.json` provisioned through Flow Agents: the kit now declares the two exact
  historical PreToolUse commands as legacy `supersedes`, including the command without `--no`.
  This needs the merged-but-not-yet-published engine capability described in
  [Legacy Kit hook migration](guides/governance-kit.md#install-from-git). Do not assume an older
  installed engine applies the declaration. Once a qualified release is available, review the
  dry run and re-provision rather than force-replacing the hooks file.
- `package.json` scripts, a CI snippet you copied into a workflow, and `.veritas/README.md` have no
  refresh command. Edit the prefix before each Veritas subcommand to `npx --no @kontourai/veritas`.
  Do not rerun `init --force` for the README: it also rewrites your standards.

`veritas readiness` and repo conformance do not check the spelling in these files.
`integrations claude-code status` reports `postSessionConfigured: false`, and
`integrations codex status` with a hooks file reports `integrationInstalled: false`, for a
configuration written with the earlier spelling.

## Agent Hook Commands Run the Install They Found

In v1.11.1 and v1.11.2, the Codex `PreToolUse` and `PostSession` commands and the Claude Code
`PostSession` command passed the install their walk found to `npx --prefix`. That option decides
only whether npx treats Veritas as installed. The binary npx runs is the first `veritas` on a `PATH`
it builds from the working directory's parent directories and your own `PATH`. In an install
without a `node_modules/.bin/veritas` link, for example one made with `--no-bin-links` or
`bin-links=false`, that could be a `.bin/veritas` in a directory above the repository, or a global
install of the unrelated unscoped `veritas` package.

The POSIX Codex `PreToolUse` and Claude Code `SessionEnd` commands, and generated post-commit,
runtime, Stop and Claude Code pre-edit shell scripts, now run the entry point of
the install they found by path:
`node <install>/node_modules/@kontourai/veritas/bin/veritas.mjs`. An install counts only when that
file exists. When the walk finds no install, the commands run plain `npx --no @kontourai/veritas` as
before, which also finds a global install. The Windows override now uses the entry-selection policy described below.

Hooks Veritas already wrote keep the earlier command until you refresh them:

- Claude Code: run `npx --no @kontourai/veritas integrations claude-code install --force`.
  Versions before the user-handler preservation fix replaced the entire `PreToolUse` list;
  restore any deleted handlers from your own backup. Current `PreToolUse` installs preserve
  user handlers and replace only the declared Veritas pre-edit command under the same matcher.
  A `PreToolUse` binding of that command under another matcher remains separate. Session-end
  capture migration still replaces Veritas-marked `SessionEnd` handlers and removes exact
  historical `PostSession` handlers.
- Codex: run `npx --no @kontourai/veritas integrations codex install --force` with the same option
  you installed with. In the hooks file it replaces the handlers v1.11.1 and v1.11.2 wrote, matched
  by their exact command.
- A `.codex/hooks.json` provisioned through Flow Agents: the kit's legacy `supersedes` includes
  the exact old command containing `npx --no --prefix "$VERITAS_PREFIX"` and the earlier npm-exec
  command. This requires the [engine capability and reviewed migration authority](guides/governance-kit.md#install-from-git),
  not merely a Git kit refresh. The capability is merged but not qualified here as a published
  engine version. With a qualified engine, re-provision after a reviewed dry run; matching is
  target/event-bounded but reaches a user's exact old-command copy under another matcher.
  Other kits' valid recorded ownership remains protected.

`integrations claude-code status` reports `postSessionConfigured: false`, and
`integrations codex status` with a hooks file reports `integrationInstalled: false`, until you
refresh them.

Refresh existing root scripts through `setup repo-hooks --force` or the corresponding
`integrations claude-code install --force` / `integrations codex install --force` command.
The generated POSIX scripts use the same bounded walk, preserve stdin and arguments, and run
the selected local entry even when its `.bin/veritas` link is absent. Runtime invocation preserves
the CLI exit status; Stop feedback remains nonblocking. The POSIX no-local-install npx fallback remains unchanged. Consumer-owned package scripts and copied CI snippets
are separate explicit package-manager invocations.

## The Governance Block Runs `npx --no @kontourai/veritas readiness`

The governance block in `AGENTS.md`, `CLAUDE.md` and the other configured instruction files now
says `npx --no @kontourai/veritas readiness` instead of `veritas readiness`. A bare `veritas` is on
`PATH` only inside an npm script or with a global install. An agent that recovers from "command not
found" by putting `npx` in front of it downloads the unscoped `veritas` package, which belongs to
another project and has no executable, so the command fails after fetching unrelated code.

The `ai-instruction-files-synced` requirement compares each block with the current one, so after
you upgrade, a block written by an earlier release is a `stale-governance-content` mismatch:

- At the starter Enforcement Level, Guide, readiness reports a WARN for the requirement and a
  second WARN, `surface-status`, for its claim being DISPUTED. Readiness still passes.
- If you raised the requirement to Require, readiness reports a FAIL until you refresh the blocks.

Refresh them with:

```bash
npx --no @kontourai/veritas apply governance-blocks
```

This replaces only the text between the governance markers, including a block edited by hand, and
needs no `--force`.

`npx --no` runs only an installed Veritas: a dependency of the nearest package, or a global
install. It refuses with `npx canceled due to missing packages` in a repository without
`@kontourai/veritas` as a dependency, and also in a nested directory with its own `package.json`
that is not a workspace of the root, even when the root has the dependency; run readiness from the
root there. If your block was edited to fetch a pinned version from the registry, add
`@kontourai/veritas` as a development dependency before you refresh the block. Keeping the edited
block instead is a WARN at Guide and a FAIL at Require.

`apply governance-blocks` refreshes only the instruction-file blocks. Files an earlier `init` wrote
keep the bare spelling until you edit them by hand:

- `.veritas/GOVERNANCE.md` names the attestation command agents may prepare in the earlier
  spelling, and its first lines lead the text `explain` prints. Change that command to
  `npx --no @kontourai/veritas attest ...`.
- `.veritas/README.md` and `package.json` scripts: see the previous section.

## Governance Block Targets: One List for `apply` and Readiness

`apply governance-blocks` and the `ai-instruction-files-synced` requirement now read the same
instruction files: the Repo Map's `activation.aiInstructionFiles` plus the paths in the
requirement's `match['governance-block']`. Two things change:

- An explicit empty `aiInstructionFiles: []` now means "no instruction files". Earlier releases
  treated it as unset, so `apply governance-blocks` created `AGENTS.md` and `CLAUDE.md` in a
  repository `init` had recorded as having none. It now writes nothing and reports that in its
  `message`.
- Readiness now also checks a file listed only in `activation.aiInstructionFiles`. A required
  entry that is missing, or any listed file whose block is stale, is reported by
  `ai-instruction-files-synced`. `npx --no @kontourai/veritas apply governance-blocks` fixes both,
  because it writes exactly those files. To stop checking a file, remove it from both lists.
## Session-Log Capture Moves to Claude Code `SessionEnd`; Codex Capture Is Removed

Earlier releases installed the standards-feedback session-log capture as a `PostSession` hook for
both Claude Code and Codex. Neither runtime has a `PostSession` event, so the capture never ran.
Claude Code ignores the key and `claude doctor` reports it under "Invalid settings" as
`Unknown hook event "PostSession" was ignored`. Codex does not run it either. The capture
also read `CLAUDE_TRANSCRIPT_PATH`, `CODEX_TRANSCRIPT_PATH` and `CODEX_SESSION_ID`, which neither
runtime documents; both pass the session log path as `transcript_path` in the hook input on stdin.

- **Claude Code.** `integrations claude-code install` now writes the capture under `SessionEnd`.
  It runs `npx --no @kontourai/veritas hooks claude-code session-end`, which reads
  `transcript_path` from stdin. Reinstalling removes the `PostSession` handler earlier releases
  wrote, matched by its exact command, and keeps your own `SessionEnd` and `PostSession` handlers.
  `integrations claude-code status` reports `postSessionConfigured: true` only for the `SessionEnd`
  handler, so it reports `false` until you reinstall. The handler keeps a 60-second `timeout`,
  which raises Claude Code's shared `SessionEnd` budget (1.5 seconds by default) to match.
  The handler's matcher is `.*`, so once installed the capture really runs at every session end,
  including `/clear` and an interactive `/resume`. Each run writes a draft under
  `.kontourai/veritas/standards-feedback-drafts/` that records the path of the session transcript.
  A transcript that cannot be read is reported on stderr and never fails the session end.
- **Codex.** `integrations codex install` no longer writes a session-log capture. Codex does have
  `SessionEnd`, but its transcript is JSONL rollout records that the Codex session log reader does
  not read, and Codex allows a `SessionEnd` hook at most 3 seconds. Reinstalling with the same
  `--codex-home` or `--target-hooks-file` option removes the `PostSession` handler earlier releases
  wrote and keeps every other handler. Until then, `integrations codex status` with that option
  reports `integrationInstalled: false`. `.veritas/runtime/codex-hooks.json` is rewritten without
  `PostSession`.

To refresh, run `npx --no @kontourai/veritas integrations claude-code install --force` and
`npx --no @kontourai/veritas integrations codex install --force` with the option you installed with.
You can still draft standards feedback from a Claude Code session log by hand with
`npx --no @kontourai/veritas feedback observe --tool claude-code --session-log <path>`.

## Explicit Evidence Check Commands Block Readiness Again

Release 1.6.0 (#204) made `veritas readiness --evidence-check-command <cmd>` additive: the
command started running alongside the Repo Map's `requiredEvidenceCheckIds` instead of replacing
them. That change also stopped a failing explicit command from blocking readiness, and neither the
1.6.0 release notes nor this guide said so. From 1.6.0 on, a command that exited nonzero was
reported as `WARN  evidence-check: <cmd>` ("Optional diagnostic failed"), the process exited `0`,
JSON output had `evidenceCheckFailure: null` and `readiness.verdict: "ready"`, and the run passed.
Release 1.5.6 and earlier failed readiness for the same command.

Readiness now blocks on it again. The explicit command is still additive, so configured required
checks still run and still fail on their own. The explicit command is also a required check for the
run that supplied it:

- A nonzero exit reports `FAIL  required-evidence-check:<id>: failed` and the process exits `1`.
- JSON output sets `evidenceCheckFailure`, `readiness.status: "fail"` and
  `readiness.verdict: "not-ready"`, and lists the command in `readiness.requiredEvidenceChecks`.
- The evidence record's `repo_map.required_evidence_check_ids` includes its id and
  `baseline_ci_fast_passed` is `false`. The readiness claim in the trust bundle is `rejected`.

`<id>` is the Repo Map check's id when the command equals a configured check's command, so passing
the command of an optional configured check makes that check required for the run, including its
external tool: with `externalTool.blocking: true`, a `fail` or `missing` artifact verdict also
blocks readiness. Otherwise it is an `explicit-command-<slug>` id.

Two invocations that earlier releases accepted are now usage errors. Readiness exits `2` with a
message and runs no check:

- Giving `--evidence-check-command` more than once. Earlier releases kept only the last command and
  never ran the others. The flag takes exactly one command.
- Combining `--evidence-check-command` with `--skip-evidence-check`. The explicit command is a
  required check for the run, so skipping checks contradicts it. Use one or the other.
- Writing `--evidence-check-command=<cmd>`, or giving the flag an empty value or no value. Earlier
  releases ignored these and ran readiness as if the flag were absent. Pass the command as the next
  argument: `--evidence-check-command "<cmd>"`.

If you relied on the warning-only behaviour, `--evidence-check-command` has no option that makes it
non-blocking. Choose one of these instead:

- Make the command pass, or stop passing it to readiness.
- Declare it in the Repo Map as a check listed in `defaultEvidenceCheckIds` or in an
  `evidenceCheckRoutes` entry, but not in `requiredEvidenceCheckIds`, and run readiness without
  `--evidence-check-command`. A failing default or routed check that is not required is reported
  as `WARN` and does not block. An explicit command replaces default and routed selection, so the
  two do not combine in one run. Changing `.veritas/repo-map.json` is a policy change and needs the
  attestation your repository requires for it.
- Run the command outside Veritas.

A consumer that derived a failure from `evidenceCheckResults` because `evidenceCheckFailure` was
`null` no longer needs to: Veritas reports the failure itself.

## Expired Attestations Fail Readiness

Each attestation has a validity window: 90 days after it was recorded by default, or the value
given with `--valid-until-days`. Earlier releases reported an attestation past that window as
`WARN  policy-changes-require-attestation: Active attestation <id> expired at <validUntil>.`, the
process exited `0`, JSON output had `readiness.verdict: "ready"`, and the readiness claim in the
trust bundle was `verified`. The documentation already treated an expired validity window as stale
evidence, and drift of the protected standards already failed readiness.

Readiness now fails closed on an expired attestation, as it does on drift:

- The feedback line is `FAIL  policy-changes-require-attestation: Active attestation <id> expired
  at <validUntil>; readiness fails until an authority records a fresh attestation.`, followed by
  the command below, which a human authority must run and an agent must not, and the process
  exits `1`.
- JSON output sets `readiness.status: "fail"` and `readiness.verdict: "not-ready"`, and the
  readiness claim in the trust bundle is `rejected`.

To check whether a repository is affected before upgrading, run
`npx --no @kontourai/veritas attest status` and read `expired` and `validUntil`. An attestation
that is not expired today still expires at `validUntil`, and readiness starts failing then.

To clear it, a human authority reviews the protected standards and records a fresh attestation. A
`policy-change` attestation is accepted when the standards did not change. Pass the expired
attestation's `validUntilDays` again to keep a custom window:

```bash
npx --no @kontourai/veritas attest policy-change --actor <authority-id> --approval-ref <human-approval-reference> --message "Renewed the attestation after reviewing the unchanged standards" --valid-until-days <days>
```

Two related cases changed at the same time:

- `attest bootstrap` and `attest policy-change` now refuse a `--valid-until-days` that is not a
  whole number of days, 1 or more, written in digits, or that ends the window past the latest date
  Veritas can represent. They exit `2` with a message and write no record. Earlier releases ran
  `Number()` on the value and wrote what it returned: `1.5` or `30.5` as a fractional window,
  `0` and negative values as they were, and an empty value as `0`. `abc`, `1e12`, `99999999` or a
  flag with no value stopped with `Invalid time value`.
- An attestation record whose `validUntilDays` is not a whole number of days of 1 or more, or whose
  `attestedAt` is not a valid date, now has no valid validity window. `attest status` reports
  `expired: true`, `validUntil: null` and a `validityWindowError`, and readiness fails with
  `Active attestation <id> has no valid validity window (<reason>)`. Such a window is never treated
  as open-ended. Earlier releases handled these records differently:
  - A fractional window such as `1.5` or `89.5`, or a numeric string such as `"90"`, passed
    readiness with an ordinary `validUntil`. It now fails. If you once recorded an attestation with
    a fractional `--valid-until-days`, for example `30.5`, record a fresh one with a whole number
    of days.
  - `0`, a negative window and `null` showed as expired, at or before `attestedAt`.
  - A missing `validUntilDays`, a non-numeric string such as `"abc"`, or a window too large to
    represent, such as `1e12` or `99999999`, made `attest status` and readiness stop with
    `Invalid time value`.

  To clear any of these, a human authority records a fresh attestation with a whole number of days.

No option makes an expired attestation advisory again. To renew less often, record the attestation
with a longer `--valid-until-days`.

A repository with no attestation, or with only the `.veritas/attestations/PENDING` marker, is
unchanged: readiness reports a `WARN` and does not block until the bootstrap attestation is
recorded.

## Attestation Claims Reflect Whether the Approval Was Resolved

New attestation records no longer present an unchecked approval reference as verified human
approval. In the default `reference-only` mode, and in `prefix` mode, Veritas records the
`--approval-ref` value without checking it, and the record's `surface` projection now says so:

| Field | `reference-only` or `prefix` mode | `resolved` or `resolved-strict` mode |
| --- | --- | --- |
| `surface.claim.status` | `proposed` (was `verified`) | `verified` (unchanged) |
| `surface.claim.confidenceBasis.sourceQuality` | `weak` (was `strong`) | `strong` |
| `surface.claim.confidenceBasis.reviewerAuthority` | `none` (was `human`) | `human` |
| `surface.claim.confidenceBasis.evidenceStrength` | `weak` (was `strong`) | `strong` |
| `surface.event.status` and `id` suffix | `proposed`, no `verifiedAt` | `verified`, with `verifiedAt` |
| `surface.evidence.excerptOrSummary` without `--message` | says the reference was not resolved | `Authority-backed <kind> attestation ...` |

The strong values need a `resolved` mode and a recorded resolver result that is approved and is
for the cited reference: `metadata.approvalResolution.approvalRef` must equal `metadata.approvalRef`.
An approved result passed to `createAttestation` under `reference-only` mode is recorded but never
checked, and a result for a different reference does not back the cited one. A result passed to
`createAttestation` under a `resolved` mode is trusted as given: Veritas checks its status, expiry
and reference, not where it came from. A `resolved` mode now refuses a passed-in result whose
`approvalRef` differs from the attested reference, or that has none, where earlier releases wrote
the attestation.

The offline resolver now checks that an approval record answers the reference that cites it, and
reports the cited reference in `metadata.approvalResolution.approvalRef` (earlier releases reported
the record's own `approvalRef`). When the record's `approvalRef` is a `veritas-approval:` or `file:`
reference, it must lead to the same record file as the cited reference, so `veritas-approval:<id>`,
`file:` and `file:./` spellings of one record all match. A record whose offline `approvalRef` leads
to a different record, or is not a valid reference, now resolves as `out-of-scope`, so a `resolved`
mode refuses the attestation, where earlier releases accepted it. A record whose `approvalRef` is an
external identifier, such as `servicenow:CHG1`, is still accepted, and the stored resolution keeps
that identifier as `recordApprovalRef`. The refusal message now ends with the resolver's reason in
parentheses.

Attestations written by any released version carry no record integrity, so they are not
authority-backed for that reason first (see below). Earlier builds also stored the record's own
`approvalRef` in `metadata.approvalResolution.approvalRef`, not the cited reference. So an
integrity-bound resolved-mode attestation written before this change, whose cited reference was not
exactly the record's own `approvalRef`, reads as `resolved, but for a different reference`. Examples
are a `file:` citation, a citation of a record that names an external ticket such as
`servicenow:CHG1`, and a differently spelled id such as `veritas-approval: chg-123`. The stored
resolution does not record which file was read, so Veritas cannot confirm it was the same record.
In every case readiness still passes, and recording a fresh `policy-change` attestation under a
`resolved` mode makes the active attestation authority-backed again.

Existing attestation records are immutable and keep the `surface` values they were written with,
so a reference-only record written before this release still stores a `verified` claim.

Readiness reads the active record's `metadata.approvalRef`, `metadata.approvalRefPolicy` and
`metadata.approvalResolution`, and counts them only when its record integrity is `verified`. An
unbound record is never authority-backed: nothing binds its metadata, and deleting
`recordIntegrity` from a bound record also makes it unbound, so accepting unbound records would let
an edit upgrade any attestation. This includes resolved-mode attestations recorded before record
integrity existed. Record a fresh `policy-change` attestation under a `resolved` mode to make the
active attestation authority-backed again. In the readiness trust bundle, the governance
attestation evidence summary and event notes say `Attestation currency is <status> ...; the
attestation is not authority-backed because <reason>.` instead of `Authority-backed attestation
currency is <status> ...` whenever the active attestation is not authority-backed.

The exported `buildGovernanceArtifactClaims` API, which readiness does not call, applies the same
rule. For an attestation that is not authority-backed it gives the attestation-currency claim
`sourceQuality: weak`, `reviewerAuthority: none`, `evidenceStrength: weak`, and gives each
protected-artifact claim `reviewerAuthority: none` instead of `authority`.

Claim statuses in the readiness trust bundle and readiness verdicts do not change.
`policy-changes-require-attestation` checks the attestation's hashes and validity window, not its
approval reference.

The requirement's `message` text also drops "authority-backed": `Protected standards changes
require a fresh attestation.`, `No attestation has activated the protected standards yet.`, and
`Protected standards require an attestation whose validity window has not expired.`

If a consumer relied on `verified` attestation claims, configure
`review_preferences.attestation_approval_ref_policy.mode: "resolved"` with offline approval records,
as described in [Attestation](guides/attestation.md#offline-approval-records), or read
`metadata.approvalRefPolicy` to tell the modes apart.

## Windows Hooks Run the Entry They Validate

The generated Codex `commandWindows` and the Governance Kit provision now run a
Node launcher through PowerShell. It resolves the physical working directory and
Git root, walks to that root using directory file identity, and runs the nearest
existing `node_modules/@kontourai/veritas/bin/veritas.mjs` with that same Node.
Missing bin links and foreign `veritas.cmd` or PATH binaries cannot substitute
another executable. A broken nested package without its entry does not hide a
valid root install. Directory spaces and junction aliases retain physical identity.

With no repository entry, the launcher checks the scoped package's exact entry
under `npm root --global`. A missing Git executable, failed repository discovery, or execution outside
a Git repository exits 2 instead of selecting a potentially unguided install.
If neither eligible package entry exists it exits 2 with an
installation remedy; it never downloads a package or invokes a generic PATH
`veritas`. This narrows the previous plain-npx fallback: npm's search beyond the
Git boundary and unrelated PATH executables no longer qualify Windows hooks.

Run `npx --no @kontourai/veritas integrations codex install --force` with your
original hooks-file option to refresh an installed override. Integration status
compares the override as well as its POSIX command, so it asks for reinstall until
then. A Git-installed Governance Kit needs reprovisioning with the updated source;
source availability does not mean the npm package or a live consumer was upgraded.

`tests/windows-hook-entry.test.mjs` executes the actual generated command under
Windows PowerShell, including nearest/root selection, missing bin links, foreign
PATH refusal, stdin and exit status, junctions, and explicit scoped-global lookup and Git-discovery refusal.
Those cases skip on other platforms. Their source presence is not Windows runtime
evidence; delivery receipts name the Windows host and revision actually executed.
