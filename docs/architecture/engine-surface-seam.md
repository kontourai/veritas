# Engine / Surface Seam

**Status:** ratified seam inventory + completed Veritas Governance Kit migration
([flow-agents#646–#652](https://github.com/kontourai/flow-agents/issues/646)).
**Surveyed at:** `2a57022` (main). Every `file:line` reference below was verified against that
commit.

Veritas is split along one line: **`@kontourai/veritas` is a lean, standalone, importable
evaluation-engine library**, while Veritas's repo-installed **product surface** is expressed by
the root-installable `veritas-governance` Flow Kit in this same product repository. Flow Agents
is the neutral host that installs and activates the kit; it does not own or bundle Veritas
solution semantics. The kit wraps the engine and never reimplements it. This document classifies
capabilities as **engine** or **surface**, freezes the engine API the kit and other consumers
depend on, and records the one-way boundary between them.

## Epic closeout (2026-07-19)

The migration landed with one deliberate refinement to the original slice plan: the engine and
the `veritas-governance` kit are colocated in this repository as one product, while Flow Agents
remains their generic installer and host. The public package import is engine-only. Product CLIs
remain as thin engine entrypoints because the kit invokes them through explicit commands and
artifacts. A Git kit install only copies and activates declared assets; it does not execute setup
code. The `setup-governance` skill therefore performs initialization and hook installation as an
explicit, reviewed follow-up. The capability inventory below remains useful as historical design
evidence; its issue destinations are resolved outcomes, not pending moves.

## Invariants

1. **The engine never depends on flow-agents.** Confirmed at survey time: zero
   `flow-agents`/`@kontourai/flow-agents` imports anywhere in `src/` (the only textual hit is
   the path constant `FLOW_AGENTS_RUNTIME_PREFIX` in `src/conformance/content-boundary.mjs:13`).
2. **The kit wraps the engine; it never reimplements Repo Standards / evidence-check
   evaluation.** The kit's adapter
   consumes the canonical `record.trust.bundle` emitted by Veritas. `veritas readiness --format
   trust-bundle` exposes that projection directly, so the kit owns no parallel blocking-failure
   derivation.
3. **Kits distribute by Git install/copy/activate/CLI, never as npm library imports.** The kit
   consumes the engine **via CLI + artifacts only** even though both are maintained in one
   repository. Repository colocation does not create a library dependency from the engine to
   Flow Agents.
4. **Kits declare process; the anchor enforces** (flow-agents ADR 0017/0022). Nothing in this
   split moves enforcement into the kit.

## Resolved open question

**The engine stays standalone and importable, with a thin `veritas readiness` CLI.** (Owner
decision on #646.) Rationale: the kit's readiness adapter needs a runnable verdict regardless;
standalone embeddability is hard to reverse and already has consumers (station, this repo's own
CI); standalone→kit-only remains reversible later, the inverse does not.

## The two frozen consumption channels

The engine has two kinds of consumer, and they use different contracts:

| Channel | Consumers | Contract |
| --- | --- | --- |
| **CLI + artifact** | the veritas-governance kit, repo hooks installed with kit guidance, CI | frozen CLI invocations, the evidence-record artifact, the projected claim shape |
| **Library import** | station, in-process CI checks, any future embedder | frozen named exports of `@kontourai/veritas` |

### Channel 1 (frozen): CLI + artifact contract

1. **Invocation:** `veritas readiness --check evidence --working-tree`
   (thin wrapper: `src/cli/readiness-check.mjs:30` → `runMergeReadiness`,
   `src/readiness/run.mjs:14`). `--check coverage` and `--check boundaries` remain part of the
   thin engine CLI (`src/cli/readiness-coverage.mjs:41`, `src/explain.mjs:184`), as does
   `veritas-report` (`src/cli/report.mjs:26` → `generateVeritasReport`,
   `src/report/index.mjs:101`).
2. **Artifact:** `<artifactDir>/<runId>.json`, default directory
   `.kontourai/veritas/evidence/` (configurable via `config.evidence.artifactDir`,
   `src/paths.mjs:26`); the filename is exactly `${record.run_id}.json`
   (`src/report/artifacts.mjs:12`, `src/util/run-id.mjs:12`) — the default run id happens to
   start with `veritas-`, an explicit `--run-id foo` produces `foo.json`. Written by
   `writeEvidenceArtifact` (`src/report/artifacts.mjs:9`).
3. **Portable gate artifact:** `veritas readiness --format trust-bundle` writes the canonical
   `record.trust.bundle` projection to stdout. The full evidence record retains its existing
   fields for audit and local inspection, but the kit no longer reconstructs readiness from
   those internal fields.
4. **Projected claim shape** (`src/surface/projected-claims.mjs`, `buildReadinessVerdictClaim`
   at line 77): `facet: 'veritas.readiness'` (line 83),
   `claimType: 'software-readiness-verdict'` (line 84), `fieldOrBehavior: 'mergeReadiness'`
   (line 85), `subjectType: 'repository-change'` (line 86), with `derivedFrom` edges to blocking
   policy-result claims (lines 97–98).
5. **Verdict semantics:** *blocking-failure precedence*. A record with an uncovered-path `fail`,
   a failed `Require` policy result, a failed selected evidence check, or a blocking external
   tool `fail`/`missing` is **not-ready/rejected regardless of `promotion_allowed`**
   (`readinessHasBlockingFailure`, `src/surface/readiness.mjs:13-19`, checked *before* the
   `promotion_allowed` short-circuit at `src/surface/readiness.mjs:2-3,8-9`; regression-tested
   in `tests/surface/readiness-verdict.test.mjs:16`). Veritas owns that derivation and emits its
   result directly in the canonical bundle; no kit adapter independently derives it. These
   functions are module-level exports of
   `src/surface/readiness.mjs` but are **not re-exported from the package root today** — see
   the Channel 2 note below.

### Channel 2 (frozen): library exports

Named exports of `@kontourai/veritas` with known external consumers today — breaking any of
these is a semver-major event:

| Export | Defined | Known consumer |
| --- | --- | --- |
| `evaluateRepoStandards` | `src/rules/evaluate.mjs:204` | station `scripts/proof-family-lane.mjs:10`, `scripts/proof-repo-guardrails.mjs:4` |
| `loadRepoStandards` | `src/load.mjs:17` | station (same files) |
| `classifyNodes` | `src/repo/classify.mjs:5` | station `scripts/__tests__/veritas-repo-map.test.ts:13` |
| `runMergeReadiness`, `hasReadinessOutcomeInputs` | `src/readiness/run.mjs:14,12` | thin CLI; in-process CI embedding |
| `generateVeritasReport` | `src/report/index.mjs:101` | `veritas-report` bin; conformance snapshot |
| `inspectAttestationStatus` | `src/attestations.mjs:348` | engine report gate (`src/report/index.mjs:126`); `veritas attest status` |
| `buildAttestationPolicyResult` | `src/attestations.mjs:419` | engine record builder (`src/report/record.mjs:59`) |
| `readCurrentAttestation` | `src/attestations.mjs:106` | PreToolUse hook actor resolution (`src/hooks/pre-tool-use.mjs:6`) |
| `evaluateWorkAreaBoundaryRule` | `src/rules/evaluate.mjs:125` | PreToolUse hook (`src/hooks/pre-tool-use.mjs:5`) |
| `loadRepoMap` | `src/load.mjs:13` | station-adjacent scripts, hooks, claims init |
| `resolveEvidenceCheckPlan`, `resolveWorkstream` | `src/repo/routing.mjs:14,77` | report planning; embedders routing changes |
| `buildReadinessCoverage` | `src/evidence/suites.mjs:145` | coverage CLI; CI |
| `produceSurfaceStateForVeritasRecord` | `src/surface/producer.mjs:8` | record builder (`src/report/record.mjs:259`); embedders projecting trust state |

**Not currently package exports (freeze applies to their semantics, not their import path):**
`readinessVerdict`, `readinessSurfaceStatus`, and the `readiness*Summary`/
`readinessIntegrityScope`/`readinessTransparencyGapHints` helpers
(`src/surface/readiness.mjs:1,7,21,28,37,46,56`) are consumed internally (evidence projection)
but are **not re-exported from the package root** — `src/index.mjs:163`'s
`export * from './surface/projection.mjs'` does not re-export `readiness.mjs`, and a runtime
import of the package returns `undefined` for all seven. Their blocking-failure-first
*semantics* are frozen via Channel 1 §5; making them public library exports is part of the
Slice-5 engine-subpath work, not a promise the package keeps today.

Everything else classified *engine* below is **engine-retained**: it stays in the package and
may evolve normally until Slice 5 formalizes the public engine subpath (see "Slice 5
prerequisite").

## Capability inventory

### Engine — stays in `@kontourai/veritas`

| Capability | Files | Notes |
| --- | --- | --- |
| Rule evaluation | `src/rules/*` (`evaluate.mjs`, `content-rules.mjs`, `primitive-first.mjs`, `result.mjs`) | clean except that `evaluate.mjs:3` imports the mixed `governance.mjs` (its *inspect* side — split B keeps that import engine-clean) |
| Repo map classify/routing | `src/repo/classify.mjs`, `src/repo/routing.mjs` | clean |
| Evidence checks + external tools + coverage | `src/evidence/*` | clean |
| Check execution (bash + MCP client) | `src/runner/bash.mjs`, `src/runner/mcp.mjs`, `src/runner/index.mjs` | `runner/mcp.mjs` is a **client** pool for `runner: "mcp"` evidence checks (consumed at `src/readiness/evidence-check-runner.mjs:63`); it is engine and keeps the `@modelcontextprotocol/sdk` dependency |
| Merge-readiness orchestration | `src/readiness/run.mjs`, `src/readiness/evidence-check-runner.mjs` | `feedback-artifacts.mjs` needs surgery (crossing 1) |
| Report/record building + artifacts | `src/report/*` | `index.mjs` needs surgery (crossing 2); `format.mjs`'s two `buildStandardsFeedback*MarkdownSummary` formatters move with authoring |
| Surface-claim projection | `src/surface/projected-claims.mjs`, `readiness.mjs`, `readiness-authority.mjs`, `producer.mjs`, `projection.mjs`, `projection-assembly.mjs`, `trust-report.mjs`, `trust-bundle-assembler.mjs`, `trust-bundle-validator.mjs` | `projection-assembly.mjs` crossings resolved by reclassification (crossing 3) |
| Projection kernel (shared shape/compat layer) | `src/surface/primitives.mjs`, `capabilities.mjs`, `evidence-projection.mjs`, `evidence-status.mjs`, `governance-projection.mjs`, `extension.mjs`, `policies.mjs` | computational steps inside the projection pipeline, not UX — classified engine |
| Attestation **read** | `src/attestations.mjs:99,106,348,419`; `src/attestations/protected-standards.mjs` (shared hashing) | file split required (split A) |
| Claim-store **read** | `src/claims/store.mjs` (`loadVeritasClaimStore`, `validateClaimStore`) | read path feeds projection (`src/surface/projection-assembly.mjs:1`); file split required (split E) |
| Plugin loading/evidence collection | `src/plugins/loader.mjs`, `src/plugins/registry.mjs`, `src/plugins/interface.d.ts` | evaluation-input infrastructure consumed by projection (`src/surface/projection-assembly.mjs:3`); `veritas plugin list` stays in the thin CLI |
| Content-boundary evaluator | `src/conformance/content-boundary.mjs` | evaluation-shaped, exported API, used by this repo's own `npm run verify`; stays (it is *not* the dashboard) |
| Boundaries/explain **logic** | `src/explain.mjs` (`buildExplainText:112`, `checkBoundaries:167`) | CLI runners embedded in the same file (split D) |
| Governance-block **inspect** | `src/governance.mjs` (`inspectGovernanceBlockFile:82`) | consumed by `evaluateGovernanceBlockRule`; file split required (split B) |
| Foundations | `src/paths.mjs`, `src/load.mjs`, `src/shell.mjs`, `src/util/*`, `src/args.mjs` (engine parsers) | `load.mjs`'s standards-feedback/marker loaders and `args.mjs`'s surface parsers move (splits C/F) |
| Thin CLI | `bin/veritas.mjs` (readiness subcommands), `bin/veritas-report.mjs`, `src/cli/readiness-check.mjs`, `readiness-coverage.mjs`, `report.mjs` (default path) | `report.mjs --trend` delegates to surface analytics and moves with it |

### Surface — resolved through the veritas-governance kit

| Capability | Files | Destination |
| --- | --- | --- |
| Init scaffold | `src/cli/init.mjs`, `src/bootstrap.mjs`, `src/bootstrap/*` | #647: retained as thin CLI invoked by `setup-governance` |
| Standards authoring + feedback workflow | `src/standards-feedback/*`, `src/cli/standards-feedback.mjs`, `veritas feedback */recommendation *` commands | #647 |
| Claim authoring | `src/cli/claims.mjs`, `src/claims/init.mjs`, `src/claims/templates.mjs`, claim-store write path | #647 |
| Attestation **authoring** | `src/attestations.mjs:120,214,318` (`writePendingAttestationMarker`, `createAttestation`, `assertAttestationApprovalReference`), `src/attestations/approval.mjs`, `src/attestations/collection.mjs`, `src/approval-resolvers.mjs`, `src/cli/attest.mjs` | #647 (paired with `recommendation decide`) |
| Hook setup + installers | `src/hooks.mjs`, `src/hooks/*` (incl. `setupRepoHooks`, `src/hooks/git-hooks.mjs:121`), `src/cli/setup*.mjs` | #648: explicit `setup-governance` orchestration; no install-time mutation |
| Runtime integrations | `src/integrations/*` (codex, claude-code, cursor/copilot, session logs) | #648 |
| Just-in-time agent guidance | `veritas explain` evaluation plus kit-owned `consult-standards` guidance | #649: shipped without a standing MCP server |
| Conformance dashboard | `src/conformance/run.mjs`, `governance-surface.mjs`, `governance-trend.mjs` | #650: excluded from the public package import; retained as internal CLI support |
| Surface Console (dashboard read model) | `src/surface/console.mjs`, `console-*.mjs` | #650: excluded from the public package import; retained internally |
| Governance-block **apply** | `src/governance.mjs:9,66,106` (`buildGovernanceBlock`, `replaceGovernanceBlock`, `applyGovernanceBlocks`) | #647 (init/scaffold) |

**Rule for moved code:** everything in this table, once in the kit, talks to the engine only
through Channel 1 (CLI + artifacts). Nothing in the kit imports `@kontourai/veritas`.

## Historical coupling analysis (Slices 2–5)

The import graph is already almost clean: surface→engine calls are fine (that seam survives as
CLI/artifact calls). Three **engine→surface** couplings (five crossing import statements) and
eight **file-internal mixes** are the real work, in dependency order:

**Crossing 1 — readiness writes standards-feedback artifacts.**
`src/readiness/feedback-artifacts.mjs:4-5` imports `standards-feedback/records.mjs` and
`run-history.mjs`; `finalizeReadinessArtifacts` appends run history and drafts feedback **by
default** on every readiness run (opt-outs: `runtime.appendHistory === false` at `:58`,
`runtime.createDraft === false` at `:68`; full records only when outcome inputs are present,
`:80` — the conformance snapshot uses these flags). *Prescription:* artifact-mediated
inversion — the moved standards-feedback code derives drafts/records/run-history from the
**frozen evidence artifact** instead of being called in-process by `runMergeReadiness`. Lands
with #647; until #650 the in-repo path may keep a temporary compatibility call, but the kit path
must not rely on it.

**Crossing 2 — the report generator writes the dashboard read model.**
`src/report/index.mjs:6-8` imports `writeSurfaceConsoleReadModel` and calls it on every run
(`:155`); `src/standards-feedback/records.mjs:14` also patches the console
(`updateRunStandardsFeedbackSummary`). *Prescription:* same inversion — the console read model
is derivable from the record artifact; drop the in-process call when the console moves (#650).

**Crossing 3 — projection assembly reads the claim store and plugins.**
`src/surface/projection-assembly.mjs:1,3` imports `claims/store.mjs` and `plugins/loader.mjs`.
*Resolution: reclassification, not surgery.* Claim-store *read* and plugin loading are
evaluation inputs and stay engine (see inventory); only claim-authoring CRUD moves.

**Split A — `src/attestations.mjs` (read vs. authoring).** Engine keeps `readAttestationHead`
(`:99`), `readCurrentAttestation` (`:106`), `inspectAttestationStatus` (`:348`),
`buildAttestationPolicyResult` (`:419`) plus the shared `attestations/protected-standards.mjs`
hashing; authoring (`writePendingAttestationMarker:120`, `createAttestation:214`,
`assertAttestationApprovalReference:318`, `attestations/approval.mjs`,
`attestations/collection.mjs`, `approval-resolvers.mjs`) moves. Consumers already respect this
line — no file imports both sides except the CLI layer, which moves whole.

**Split B — `src/governance.mjs`.** `inspectGovernanceBlockFile` (read, used by rule
evaluation) stays; `buildGovernanceBlock`/`replaceGovernanceBlock`/`applyGovernanceBlocks`
(write, scaffold) move.

**Split C — `src/load.mjs`.** Core loaders stay; `loadStandardsFeedbackDraftArtifact` and the
three `loadMarkerBenchmark*` loaders move with authoring.

**Split D — `src/explain.mjs`.** Pure `buildExplainText`/`checkBoundaries` stay engine;
the embedded `process.argv` CLI runners (`runExplainCli:142`, `runBoundariesCheckCli:184`)
follow the CLI decision (`--check boundaries` stays in the thin CLI; `veritas explain` moves
with #649 guidance).

**Split E — `src/claims/store.mjs`.** Read/validate stays engine; add/update/remove/save +
`claims/init.mjs` + `claims/templates.mjs` move.

**Split F — `src/args.mjs`.** `parseTokens`/`parseArgs`/`parseCoverageArgs`/`parseReadinessArgs`
stay; `parseInitArgs`/`parseAttestArgs`/`parsePrintArgs`/`parseApplyArgs`/`parseSetupArgs`/
`parsePreToolUseArgs`/`parseStandardsFeedback*Args`/`parseMarker*Args` move with their commands.

**Split G — `src/hooks/pre-tool-use.mjs`.** The hook mixes engine rule evaluation (`:108`,
`:114`) with standards-feedback *exception writing* (`:71`, `:141`). The evaluation entry point
stays engine-invokable (see below); the exception-write side effect moves with standards
feedback (#647/#648).

**Split H — `src/cli/report.mjs`.** The default path is a thin engine wrapper
(`generateVeritasReport`, `:44`) and stays with the thin CLI; the `--trend` branch delegates to
surface analytics (`generateStandardsFeedbackSummary`, imported at `:7`, dispatched at `:29`)
and moves with #647.

**Hook evaluation entry point (Slice 3 constraint).** The live PreToolUse hook evaluates rules
in-process today (`src/hooks/pre-tool-use.mjs:5,108,114`). When hook *installation* moves to the
kit, the hook's *evaluation entry point* must remain engine-invokable as CLI (the installed hook
script shells into `veritas`), because kit code cannot import the engine. Hook wiring is kit;
per-edit evaluation is engine.

## Slice 5 prerequisite: an explicit engine subpath — **shipped (Step A)**

`src/index.mjs` was a flat 254-line barrel with no engine/surface boundary — it exported rule
evaluators next to `runInitCli` and `setupRepoHooks`. As the first step of
[#650](https://github.com/kontourai/flow-agents/issues/650), the engine-classified API is now a
distinct **`@kontourai/veritas/engine` subpath** (`src/engine.mjs`, wired in `package.json`
`exports`), so "standalone importable engine" is structural rather than conventional. The
`tests/engine-subpath.test.mjs` boundary test pins it: the subpath exports the engine API and
must not leak product surface. The root `.` barrel is unchanged and still re-exports everything,
so station's three imports (`evaluateRepoStandards`, `loadRepoStandards`, `classifyNodes` — all
present on `/engine`) and every other root consumer keep working through the transition; station's
version bump stays gated on #650 (station#233).

**Step B — shipped.** The public package library API is now engine-only: `package.json`
`exports["."]` points at `src/engine.mjs` (alongside `./engine`), so importing `@kontourai/veritas`
by name yields the engine, not product surface (`import { setupRepoHooks } from '@kontourai/veritas'`
no longer resolves). `src/index.mjs` remains as an **internal aggregate barrel** — it still
re-exports the product surface, but only to back the `bin/veritas*.mjs` CLIs and the test suite,
which import it by *relative path* (relative imports bypass the `exports` map). No source was
deleted: the surface stays on disk to serve the retained thin CLIs (below). Station's package-name
imports resolve engine-only; the `tests/engine-subpath.test.mjs` package-root test pins it.
Deleting standalone CLI surfaces is a separate product decision, not part of this migration.
`veritas setup repo-hooks` is intentionally retained because `setup-governance` invokes it after
explicit user consent; Git installation itself remains non-executing.

### Kit-wrapped CLIs stay (owner decision, #650)

The engine subpath is the library boundary; it does **not** decide the CLI boundary. The
root `veritas-governance` kit consumes Veritas only through CLI/artifacts (kits cannot
import the engine), and its shipped skills shell into specific commands: `standards-authoring`
runs `veritas init --explore`/`--apply`, and `consult-standards` runs `veritas explain`. So
`veritas readiness`, `veritas explain`, and `veritas init --explore`/`--apply` **remain as thin
CLIs** in the slimmed package even though `init`'s scaffold *library* surface (`src/bootstrap*`,
`writeBootstrapStarterKit`, …) is removed. Step B slims the library surface and the non-wrapped
CLI/UX, but keeps the thin CLIs the kit shells into — removing them would break kit skills that
already shipped (Slices 2 and 4).

## Survey findings that reframe downstream slices

1. **#649 has nothing to move.** No MCP guidance server exists at `2a57022`; veritas's
   `@modelcontextprotocol/sdk` dependency is the evidence-check **client**
   (`src/runner/mcp.mjs`), which is engine and stays. The kit builds guidance new (skill/asset
   wrapping `veritas explain` / the frozen artifacts).
2. **veritas#106 is fixed**, so the freeze includes the verdict functions' semantics as-is.
   The kit adapter header and kit README described #106 as open at survey time; both were
   refreshed in the companion flow-agents change that also links this doc.
3. **`content-boundary.mjs` is an evaluator, not a dashboard** — it stays in the engine
   despite living under `src/conformance/`.
4. **Engine dependency set for #651 (Layer Doctrine):** `@kontourai/surface`,
   `@modelcontextprotocol/sdk`, `picomatch`, `ajv`/`ajv-formats`, `hachure` (schemas). No
   flow-agents dependency exists or may be added.

## The Portfolio Layer Doctrine

This engine/surface split is the veritas-local instance of the portfolio-wide **Layer Doctrine**
([surface/docs/architecture/portfolio-layer-doctrine.md](https://github.com/kontourai/surface/blob/main/docs/architecture/portfolio-layer-doctrine.md)):
dependency direction is one-way up the stack — Layer 1 open trust format (`hachure`) → Layer 2
building-block tools → Layer 3 Surface (`@kontourai/surface`) → Layer 4 products. `@kontourai/veritas`
is a **Layer 4 product** (the evaluation engine): it depends *down* on Surface, never *sideways*
into the platform. Concretely, Invariant 1 above — the engine never depends on flow-agents — is the
Layer Doctrine's no-reach-past-your-neighbor rule, and it is now enforced executably by
`scripts/check-no-flow-agents-dep.mjs` (wired into `npm run verify`); the mirror-image rule that a
kit must not import the engine as a library is enforced flow-agents-side by
`scripts/check-layer-boundary.mjs`. "Kits declare process; the anchor enforces" (ADR 0017/0022) —
and now the layer edges enforce too.
