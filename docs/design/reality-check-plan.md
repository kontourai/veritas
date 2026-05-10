# Reality-Check Plan

> Status: implemented through Phase 8 on 2026-05-10. Follow-up cleanup from verification feedback is tracked in the implementation changes rather than changing the phase order below.

This plan closes the gap between what Veritas claims and what Veritas does today, and pushes the Surface/Veritas separation harder so Veritas becomes a real Surface *consumer* (not just a producer of `surface.input`). It also introduces the missing human-in-the-loop primitive (attestation).

Touch points span both repos:

- `~/dev/github/kontourai/veritas` (this repo)
- `~/dev/github/kontourai/surface` (foundation)

The plan is ordered. Earlier phases unblock later ones. Each phase has a deliverable acceptance test the worker agent can run.

---

## Phase 1 — Human attestation primitive

**Goal:** introduce a human-signed attestation that gates Zone 1 changes and activates the policy pack.

### Surface (small)

- Add `attestation` as a first-class evidence type already supported by Surface's evidence schema (`type: "attestation"`, `method: "attestation"`); confirm `validateTrustInput` accepts it with no schema change. Document the canonical shape for "human attests to a policy pack" in `surface/docs/concepts.md` under a new "Attestation" subsection.
- Export a `buildHumanAttestationEvidence({ subject, actor, attestedAt, validUntil, contentHash })` helper from `@kontourai/surface` so consumers don't reinvent it.

### Veritas (larger)

1. **Schema:** add `schemas/veritas-attestation.schema.json`. Required fields: `id`, `kind` (`bootstrap` | `policy-change` | `proposal-acceptance`), `actor` (id + display name + identity proof — git config user.email + signing key fingerprint if available), `attestedAt`, `policyPackHash`, `adapterHash`, `teamProfileHash`, `priorAttestationId` (nullable for bootstrap), `validUntilDays` (default 90), `notes`.
2. **Storage:** `.veritas/attestations/*.attestation.json`. Tracked in git. Always immutable — new attestations supersede old by `priorAttestationId` chain.
3. **CLI:**
   - `veritas attest bootstrap` — interactive (or `--non-interactive --actor <id>`), records hashes of current Zone 1 files, writes attestation, updates `.veritas/attestations/HEAD` symlink-style pointer (a JSON file with `currentAttestationId`).
   - `veritas attest policy-change [--message <text>]` — used after editing a policy pack. Diffs old vs new hashes, requires explanation.
   - `veritas attest status` — prints current attestation, age, expiry, drift between attested hashes and on-disk hashes.
4. **Init flow:** `veritas init` ends with an attestation prompt. In `--non-interactive` mode it writes a "no attestation yet" marker (`.veritas/attestations/PENDING`) and exits 0; subsequent `shadow run` warns until attested.
5. **Shadow run gate:** if `attestations/HEAD` points to an attestation whose hashes do not match current Zone 1 file hashes, `shadow run` emits a hard FAIL on a new built-in rule `policy-changes-require-attestation`. The agent cannot pass without a fresh attestation.
6. **Tests:** add tests under `tests/attestation.test.mjs` covering bootstrap, drift detection, expiry warning, hash chaining, and refusal-to-attest-as-non-human (block when actor matches CI bot identity).

**Acceptance:** `npm test` passes. `veritas init` then `veritas attest bootstrap --actor brian --non-interactive` produces a tracked attestation; modifying a policy pack rule and running `veritas shadow run` returns FAIL on `policy-changes-require-attestation` until `veritas attest policy-change` is run.

---

## Phase 2 — Graduated enforcement (PreToolUse can deny)

**Goal:** convert Veritas from advisor to graduated enforcer. Hard-invariant rules deny edits at the PreToolUse boundary; promotable-policy rules continue to lint at shadow-run time.

### Veritas

1. **Policy schema:** confirm `stage: "block"` and `classification: "hard-invariant"` are already present (they are). Add `enforcement: "deny" | "lint"` to each rule. Default for `hard-invariant` is `deny`; default otherwise is `lint`.
2. **PreToolUse hook content (`src/hooks.mjs`):** when called with `--file <path>`, evaluate which rules apply to that path. If any rule with `enforcement: "deny"` would fail (required-pattern, header-required, forbidden-pattern can be evaluated against an *intended* edit; cross-surface-write can be evaluated against actor + path immediately), emit a Claude Code hook protocol JSON response with `decision: "block"` and `reason: <explain output>`. Otherwise, emit context only.
3. **Override:** support `VERITAS_OVERRIDE_RULE=<rule-id> VERITAS_OVERRIDE_REASON="<text>"` env vars; record overrides in the eval record under a new `overrides[]` array with `{ ruleId, reason, actor, timestamp }`. `veritas eval summary` surfaces override frequency per rule.
4. **Cross-surface-write at PreToolUse:** the hook already needs `actor`; resolve actor from the current attestation's `actor.id` if not explicitly set. This is the missing link between Q2 (attestation) and the existing `cross-surface-write` rule.
5. **Tests:** new `tests/pretooluse-deny.test.mjs` simulating Claude Code hook input JSON and asserting deny/allow decisions. Cover override path.

**Acceptance:** with the bootstrap attestation in place, an attempt to edit `.veritas/repo.adapter.json` from PreToolUse hook input returns the deny JSON; an override env var with reason permits it and records the override.

---

## Phase 3 — Tool-agnostic transcript & runtime adapter layer

**Goal:** make "works for any AI agent" true. Today only Codex has deep integration; everything else gets the generic stop hook.

### Veritas

1. **New module `src/integrations/contract.mjs`:** define two interfaces (as JSDoc-typed factory functions, since this codebase is `.mjs`):
   - `TranscriptReader`: `{ name, canRead(transcriptPath), readEvents(transcriptPath) → IterableIterator<NormalizedEvent> }`. `NormalizedEvent` is `{ kind: "tool-call"|"shadow-run"|"edit"|"override"|"completion", timestamp, files[], commandText, exitCode, raw }`.
   - `RuntimeAdapter`: `{ name, installPreToolUseHook(opts), installStopHook(opts), installPostSessionHook(opts), uninstall(), status() }`.
2. **Refactor existing code into the contract:**
   - Move `src/integrations/codex/eval-capture.mjs` to a `CodexTranscriptReader` implementing the interface. Move `applyCodexHook`, `printCodexHook` into a `CodexRuntimeAdapter` implementation.
   - Same for Claude Code: implement `ClaudeCodeTranscriptReader` reading `~/.claude/projects/<project-id>/<session-id>.jsonl` (this is the actual on-disk format; verify by reading a current session file). Implement `ClaudeCodeRuntimeAdapter` wrapping the existing `applyClaudeCodePreToolUseHook` plus a new `applyClaudeCodeStopHook` and `applyClaudeCodePostSessionHook`.
   - Stub `CursorRuntimeAdapter` and `CopilotRuntimeAdapter` with the generic governance-block + stop-hook only; explicit `transcriptReader: null`.
3. **CLI consolidation:** introduce `veritas integrations <tool> install|status|uninstall` as the new front door. Keep existing `apply codex-hook` etc. as thin shims that delegate to the new namespace, marked deprecated in `--help` output.
4. **`veritas eval observe`:** replace the hard-coded Codex transcript reader with a registry lookup: choose reader by `--tool` flag or auto-detect by transcript shape.
5. **Docs:** update `docs/guides/deep-integration-template.md` to describe the contract any new tool must satisfy, and the parity matrix (Codex full, Claude Code full after this phase, Cursor/Copilot generic).
6. **Tests:** `tests/integrations/claude-code-transcript.test.mjs` against a fixture transcript. Reuse the existing Codex transcript fixtures to verify parity through the new interface.

**Acceptance:** `veritas integrations claude-code install --root <repo>` installs PreToolUse + Stop + PostSession hooks; running a Claude Code session that triggers a shadow-run FAIL produces an eval draft with non-null `time_to_green_minutes`, `accepted_without_major_rewrite`, and `override_count` derived from the Claude Code transcript.

---

## Phase 4 — Filesystem-based observation fallback

**Goal:** give every tool — even ones with no transcript — a useful eval signal.

### Veritas

1. **New module `src/eval/filesystem-observer.mjs`:** synthesize a `NormalizedEvent` stream from durable artifacts:
   - `time_to_green_minutes`: read `.veritas/runs/history.jsonl` (already exists), find first FAIL → next PASS for the active run-id chain.
   - `override_count`: scan shell history for `VERITAS_HOOK_SKIP=1` / `VERITAS_OVERRIDE_RULE=` invocations within the run window, plus parse the `overrides[]` array on the evidence record (Phase 2).
   - `accepted_without_major_rewrite`: compute churn ratio of touched files in `git log --since=<run-start>` against the file list reported by the shadow run.
2. **Wire into `eval observe`:** when no transcript reader is present (or `--tool none`), use the filesystem observer. Annotate fields with `source: "filesystem-inferred"` so they're distinguishable from transcript-derived values.
3. **Tests:** `tests/eval/filesystem-observer.test.mjs` with synthetic `runs/history.jsonl` and a temp git repo.

**Acceptance:** running a session in a tool with no integration (e.g., manually in a shell), then `veritas eval observe --tool none --evidence <path>` produces a draft with non-null fields and `source: "filesystem-inferred"`.

---

## Phase 5 — Consume the Surface trust report

**Goal:** Veritas should not just emit `surface.input`; it should ingest the `TrustReport` Surface generates from it and surface (sic) the derived statuses in lint output.

### Surface

- Confirm `buildTrustReport(input, policies?)` is exported and stable. If not yet exported, do so. Document in `surface/docs/concepts.md` and the `built-on-surface` page.

### Veritas

1. **`src/surface/projection.mjs`:** after `validateTrustInput`, also call `buildTrustReport` and persist the result alongside `surface.input` under `evidence.surface.report` (omit on-disk if too large; keep summary fields).
2. **`shadow run` output:** for any claim whose Surface status is `stale` or `disputed`, emit an additional WARN line:
   ```
   WARN  surface-status: claim "veritas.proof-lane.required-proof" is STALE (last verified 14d ago, freshness policy 7d)
   ```
3. **`veritas explain`:** when explaining a rule, query the trust report for that rule's policy claim and include current status + fault lines.
4. **Tests:** `tests/surface/trust-report-consumption.test.mjs` covering stale freshness, disputed status, fault-line surfacing.

**Acceptance:** an evidence record older than the freshness policy produces a STALE warning in shadow-run output without any new Veritas-local logic — the status comes from Surface.

---

## Phase 6 — Surface consumer SDK

**Goal:** make it as easy to write a non-Veritas Surface consumer as it is to write a Veritas adapter today.

### Surface

1. **`src/consumer-sdk.ts` (new module, exported):** consolidate `policy-helpers.ts` + claim/evidence/event builders + a `TrustInputBuilder` fluent class:
   ```ts
   const builder = new TrustInputBuilder({ source: "myproduct:run-1" });
   builder.addClaim({ ... });
   builder.addEvidence({ ... }).linkTo(claimId);
   builder.addEvent({ ... });
   const input = builder.build(); // validateTrustInput called inside
   ```
2. **Documentation:** new `surface/docs/guides/consumer-sdk.md` walking through the Veritas-Surface mapping as a reference implementation, then a smaller second example (e.g., reuse `examples/external-adapter`).
3. **Type ergonomics:** ensure all builder helpers return discriminated-union types so consumers get TS errors when they forget required fields.

### Veritas

- Refactor `src/surface/projection.mjs` to use the new builder (proves the SDK is real, not aspirational).

**Acceptance:** `examples/external-adapter` rewritten to use the builder is shorter and still passes its tests; Veritas projection refactor leaves all current evidence artifacts byte-identical (or schema-equivalent).

---

## Phase 7 — Eval-driven rule proposals (closes the human loop)

**Goal:** evals propose rule changes; humans accept; rules update only after attestation. This is the missing feedback loop that justifies the eval infrastructure.

### Veritas

1. **Proposal generator:** `veritas eval propose` (or run automatically inside `eval summary` with `--write-proposals`). Heuristics:
   - Rule fires FAIL but is overridden >40% of the time → propose `enforcement: deny → lint` or `stage: block → warn`.
   - Rule fires WARN but never causes a follow-up edit → propose `stage: warn → advise`.
   - Rule never fires in N runs → propose retirement (`x_status: deprecated`).
   - File pattern repeatedly matches no surface node → propose new surface node with `boundary: advisory`.
2. **Storage:** `.veritas/proposals/<id>.proposal.json`. Schema in `schemas/veritas-proposal.schema.json`. Each proposal is a Surface claim with `status: proposed`, evidenceIds pointing to the eval records that support it.
3. **CLI:**
   - `veritas proposal list` — show all open proposals with their evidence summaries.
   - `veritas proposal show <id>` — full detail including the diff to the policy pack the proposal would apply.
   - `veritas attest proposal <id> --accept | --reject [--message <text>]` — on accept, applies the diff and creates a `policy-change` attestation in one step. On reject, marks the proposal `rejected` with the reason and stops the proposal from being regenerated for N days.
4. **Shadow run nudge:** when open proposals exist, `shadow run` prints a one-line nudge (not a FAIL) at the bottom: `proposals: 3 open · run \`veritas proposal list\` to review`.
5. **Tests:** `tests/eval/proposal-generator.test.mjs` covering each heuristic; `tests/proposals/lifecycle.test.mjs` covering propose → accept → policy diff applied → attestation chain updated.

**Acceptance:** a synthetic eval history with 5 overrides on rule X causes `eval propose` to emit a proposal; `veritas attest proposal <id> --accept` applies the rule diff and updates `attestations/HEAD`. The proposal surfaces in `surface.input` as a `proposed`-status claim and graduates to `verified` after attestation.

---

## Phase 8 — CLI surface cleanup

**Goal:** reduce `bin/veritas.mjs` from 367 lines of subcommand routing to a coherent verb-noun structure.

1. Front door becomes 7 verbs: `init`, `run`, `explain`, `attest`, `proposal`, `eval`, `integrations`.
2. Existing `apply <thing>` / `print <thing>` become `integrations <tool> install|print` and `runtime <kind> install|print`. Old commands stay as deprecated shims that print a one-line `# deprecated; use \`...\`` notice and continue to work.
3. `boundaries check` becomes `run --check boundaries` (a single `run` verb with `--check <kind>` covers shadow run, boundaries check, budget check).
4. Update `docs/reference/cli.md` and the README quickstart to use the new verbs.
5. **Tests:** existing CLI tests stay green via the shims; new tests under `tests/cli/new-surface.test.mjs` cover the verb-noun structure.

**Acceptance:** `veritas --help` fits in one screen; all existing scripts in `package.json` and `.veritas/hooks/` continue to run unchanged via shims.

---

## Cross-cutting requirements

- **Backwards compatibility:** every renamed CLI keeps a working shim for one minor version. Every renamed schema field gets a migration in `src/schema-migration.mjs` (create if absent).
- **Documentation parity:** every phase that lands code also updates `docs/concepts.md`, `docs/reference/`, and the kontourai.io marketing pages where the claim has changed. The marketing site must not say "works with any agent" until Phase 3 lands; it must not say "human-in-the-loop" until Phase 1 lands. Mark not-yet-landed claims with a roadmap pointer until then.
- **Test coverage:** every phase ships with new tests; `npm test` must remain green at every commit.
- **`veritas shadow run` on Veritas itself must pass** at the end of every phase; if a new rule is added, it must pass on this repo before merge.
- **Surface coupling:** any new Veritas dependency on Surface must be an exported public API, not an internal import. If Surface needs a new export, do that in the matching Surface phase first.

## Suggested phasing for the worker agent

The worker agent should run phases roughly in this order. Phases 1, 2, 3 are foundational and unblock the rest. Phases 4, 5 can run in parallel after 3. Phase 6 can run any time after 1. Phase 7 requires 1 and 4. Phase 8 should run last to avoid churn during refactors.

```
Phase 1 (attestation)
   ↓
Phase 2 (graduated enforcement)
   ↓
Phase 3 (tool-agnostic adapters)
   ↓ ↓
Phase 4 (FS observer)   Phase 5 (consume report)
   ↓                       ↓
   └─────────┬─────────────┘
             ↓
Phase 6 (consumer SDK) ← can start any time after Phase 1
             ↓
Phase 7 (eval-driven proposals)
             ↓
Phase 8 (CLI cleanup)
```

When each phase completes, run:

```
npm test
npm run veritas:checkin:report
node scripts/build-pages-site.mjs
```

and address any FAILs before moving on.
