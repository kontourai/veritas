# Integration Plan: Veritas Alongside Surface in Real Applications

This plan defines how Veritas integrates into real applications alongside Surface — using `briananderson1222/campfit` and `briananderson1222/taxes` as the two reference integrations. It is the Veritas-side counterpart to [Surface's integration plan](../../surface/docs/integration-plan.md). Where they overlap, that document is canonical for Surface concerns; this one is canonical for Veritas concerns.

This plan extends [concepts.md](./concepts.md) and [architecture/surface-veritas-boundary.md](./architecture/surface-veritas-boundary.md). It does not change the Surface-Veritas boundary; it makes the boundary actively useful in real apps.

## Why this plan exists

A code-level audit of `briananderson1222/campfit` and `briananderson1222/taxes` revealed:

- **Campfit does not use Veritas at all.** No dependency, no `.veritas/`, no governance blocks. The repo has clear seams (Prisma schema, LLM extractor, admin review UI) where Veritas would catch real problems, but it is not installed.
- **Taxes uses Veritas only minimally.** `@kontourai/veritas` is a devDependency, and `package.json` exposes `veritas:report`, `veritas:shadow`, and `veritas:install:git-hook` scripts. Real `.veritas/evidence/*.json` files exist and track repo nodes (`workspace.packages`, `verification.tests`) — but no policy pack tailored to tax-specific risks, no `if-changed` rules for rule-pack edits, no governance of the MCP server.

Both apps would benefit from deeper Veritas integration. The pattern that emerges:

- **Veritas governs the codebase** — including the code that produces Surface claims.
- **Surface governs the data** — including data produced by Veritas-governed code.
- They share `surface.input` at exactly one seam: Veritas evidence artifacts include a `surface.input` projection of the *test* run, not the production claims.

This plan does two things: expand Veritas's primitives where real-app integration needs them, and integrate Veritas into both apps deeply enough to confirm the primitives are right.

## Scope: what Veritas does and doesn't do

### Veritas does

- Governs repository state at a point in time (PR, working tree, scheduled run).
- Runs proof lanes (tests, type-checks, smoke runs) and reports their pass/fail.
- Enforces `if-changed` and `then-require` co-change rules on diffs.
- Enforces required-artifact rules ("this file must exist," "this governance block must be present").
- Produces evidence artifacts including a `surface.input` projection of the run.
- Tracks verification budget and eval history.

### Veritas does not

- Run continuously alongside the application (it runs at PR time, hook time, or on demand).
- Govern production data quality (Surface does that).
- Verify that production Surface claims are correct (Surface does that).
- Replace tests; Veritas runs them and lints around them.

The boundary stays clean: Veritas evidence is point-in-time and code-scoped; Surface claims are continuous and data-scoped.

## Pilot strategy

**Taxes is the pilot** for the same reasons Surface picked it: existing minimal integration to expand, deeper trust model that exercises more rule types, real production-style infra (MCP server, CLI, web app) that benefits from cross-layer rules.

**Campfit is the confirmation pass.** No Veritas today; greenfield install validates that the Phase 1 primitives plus existing Veritas surface area are enough for a fresh integration.

## Veritas-side work

The audit identified gaps and the Surface plan introduced new primitives (`ReviewSignal`, batch evidence, candidate claims, etc.). Veritas needs corresponding additions.

### Track V-A — Cross-layer rule type

Today Veritas rules operate on file paths and presence checks. Real cross-layer governance needs rules that read Surface fixtures.

#### V-A1. `surface-fixture-required` rule

A new rule type: when a code path matches the `if-changed` pattern, require a Surface fixture file in `tests/` whose `surface.input` validates against a referenced policy.

```json
{
  "id": "extractor-changes-require-surface-fixture",
  "stage": "block",
  "type": "surface-fixture-required",
  "match": {
    "if-changed": "lib/ingestion/llm-extractor.ts"
  },
  "fixture": {
    "glob": "tests/extraction/**/*.surface.json",
    "min": 1,
    "policySetRef": "campfit.field-attestation"
  }
}
```

Veritas reads the matched fixtures, runs `validateTrustInput` on each `surface.input` block, and confirms claims of the relevant `claimType` exist with valid evidence. If validation fails or the fixture is missing, the rule fails.

This is the first rule type that requires Veritas to actually execute Surface code (currently Surface is just shape-validated by JSON Schema). Wire this through `@kontourai/surface` as a peerDependency.

#### V-A2. `surface-projection-required` rule

When a Surface-projecting module changes, require an updated example projection.

```json
{
  "id": "projection-changes-require-example",
  "type": "surface-projection-required",
  "match": {
    "if-changed": "packages/surface-projection/src/from-resolved-fact.ts"
  },
  "projection": {
    "input": "packages/surface-projection/examples/resolved-fact-input.json",
    "output": "packages/surface-projection/examples/resolved-fact-trust-input.json",
    "function": "fromResolvedFact"
  }
}
```

Veritas runs the projection function against the input and asserts the output matches (byte-equal or semantic-equal, configurable). Catches drift between projection logic and committed examples.

### Track V-B — Adapter packs

Today Veritas's adapter is generic JSON. Real apps need stack-specific scaffolding.

#### V-B1. Reference adapter: Next.js + Prisma

`@kontourai/veritas-adapter-next-prisma` (new package or section of `adapters/`) provides:

- Surface map: `app/`, `lib/`, `prisma/schema.prisma`, `prisma/migrations/`, `public/`, `tests/`
- Default `if-changed` rules: schema-change-requires-migration, route-requires-middleware, env-var-disclosure
- Default proof lanes: `npm run lint`, `npm run typecheck`, `npx prisma migrate diff`
- Governance block templates for Next.js apps

Used by Campfit out of the box.

#### V-B2. Reference adapter: TypeScript monorepo with MCP

`@kontourai/veritas-adapter-mcp-monorepo`:

- Surface map: `packages/`, `apps/mcp-server/`, `apps/web/`, `apps/cli/`, `tests/`, schema/citation files
- Default rules: rule-pack-changes-require-version-bump, schema-changes-require-migration-test, citations-required-for-rule-references
- Default proof lanes: `npm run test`, `npm run typecheck`, MCP server smoke test

Used by Taxes (replacing the current ad-hoc setup).

#### V-B3. Adapter contract

Both adapters conform to a single contract:

```ts
export interface VeritasAdapterPack {
  id: string;                          // "next-prisma", "mcp-monorepo"
  surfaceMap: Record<string, string[]>; // surface name → glob patterns
  defaultRules: PolicyRule[];
  defaultProofLanes: ProofLane[];
  governanceBlocks: Record<string, string>;  // tool name → template
}
```

`npx veritas init --pack next-prisma` installs the pack into `.veritas/`.

### Track V-C — Per-feature verification budget

Today verification budget is repo-wide. For Campfit, the crawl pipeline has its own cost profile (LLM tokens × passes); for Taxes, the rule-pack update has its own. Per-feature budget is needed.

#### V-C1. Feature-scoped budget records

Extend the existing budget record:

```json
{
  "id": "feature-crawl-pipeline",
  "scope": {
    "type": "feature",
    "matches": ["lib/ingestion/**", "scripts/run-crawl.ts"]
  },
  "budget": {
    "maxLlmTokensPerRun": 500000,
    "maxRunDurationMs": 300000,
    "requiredProofLanes": ["smoke-crawl-fixture"]
  }
}
```

`veritas budget` reports per-feature consumption. `veritas budget --feature feature-crawl-pipeline` drills in.

### Track V-D — `surface.input` parity test

The boundary doc claims Veritas evidence includes a `surface.input` projection. Once Surface ships SHACL (Phase 2 of Surface's [linked-data-roadmap.md](../../surface/docs/linked-data-roadmap.md)), validate that claim automatically.

#### V-D1. Reference test in Veritas itself

`tests/surface-input-parity.test.ts`:

- For each `examples/*.json` in Veritas, extract `surface.input`.
- Run `validateTrustInput` from `@kontourai/surface`.
- Run SHACL validation if SHACL is available.
- Assert agreement.

Catches drift between Veritas's evidence shape and Surface's contract.

#### V-D2. Same test in adapter packs

Each adapter pack ships a parity test of its own — so consumers (Taxes, Campfit, future apps) detect drift in their own evidence outputs without running it manually.

### Track V-E — Governance block expansion

Today governance blocks are static text. Real integrations need parameterized blocks (project name, key paths, policy pack ID).

#### V-E1. Templated governance blocks

```hbs
<!-- veritas:governance-block:start -->
This repo uses Veritas for AI governance with the {{ packId }} adapter pack.
Read .veritas/GOVERNANCE.md before changes to: {{ surfaceList }}.
After changes, run `npm run veritas:shadow` and address all FAIL lines.
<!-- veritas:governance-block:end -->
```

Render at install time, re-render when the pack updates.

## Phased delivery

### Phase V1 — Cross-layer rule types (Track V-A)

V-A1 first (fixture-required). V-A2 follows (projection-required). Both depend on Surface's Track A primitives being stable; coordinate with Surface plan Phase S1.

### Phase V2 — Adapter packs (Track V-B)

V-B1 (Next.js + Prisma) first because Campfit greenfield install drives it. V-B2 (MCP monorepo) follows for Taxes. V-B3 (adapter contract) is the underlying refactor that makes both packs first-class.

### Phase V3 — Taxes Veritas expansion (pilot)

Cross-repo work. See "Pilot: Taxes" below. Confirms V-B2 covers the real stack and V-A rules catch real bugs.

### Phase V4 — Per-feature budget (Track V-C)

Implements after both apps integrate so feature scopes are real, not invented.

### Phase V5 — Parity tests (Track V-D)

Adds the `surface.input` SHACL parity test to Veritas itself and to both adapter packs. Coordinate with Surface's Phase 2 of linked-data roadmap.

### Phase V6 — Campfit Veritas integration (confirmation)

Greenfield install of Veritas via the `next-prisma` adapter pack. Confirms the pack covers a real Next.js + Prisma stack without ad-hoc additions.

### Phase V7 — Governance block templating (Track V-E)

Lower priority; ships after both pilot integrations stabilize and we know what parameters real installs need.

## Pilot: Taxes

Taxes already has a starting point. Goal: turn the existing minimal integration into a full cross-layer governance setup.

### TV1 — Switch to the MCP-monorepo adapter pack

`npx veritas init --pack mcp-monorepo` re-bootstraps `.veritas/` with surface map, default rules, default proof lanes. Existing `.veritas/evidence/` carries over.

### TV2 — Author a Taxes-specific policy pack

`.veritas/policy-packs/default.policy-pack.json`:

- **Rule-pack governance:**
  - `if-changed: packages/tax-rules/src/manage/schema.ts then-require: packages/tax-rules/migrations/`
  - `if-changed: packages/tax-rules/src/calc/**/*.ts then-require: tests/calc/**/*.test.ts`
- **Citations:**
  - `required-artifacts: every IRS rule reference in code must have a citation file under packages/tax-rules/citations/`
- **MCP server:**
  - `if-changed: apps/mcp-server/src/tools/**/*.ts then-require: apps/mcp-server/tests/integration/**/*.test.ts`
- **Surface projection (cross-layer, V-A1):**
  - `if-changed: packages/surface-projection/src/from-resolved-fact.ts then-require: surface fixture in tests/projection-resolved-fact/*.surface.json`
- **Schema migration:**
  - `if-changed: packages/shared-schemas/src/index.ts then-require: docs/MIGRATING.md update + schema version bump`

### TV3 — Wire shadow run into existing CI

`veritas shadow run --working-tree` runs in pre-commit hook (already partially configured). Expand to PR check:

```yaml
# .github/workflows/veritas.yml
- run: npx veritas report --changed-from origin/main --changed-to HEAD --format feedback
```

### TV4 — Surface projection fixtures

Author fixture inputs at `tests/projection-fixtures/` containing real anonymized `ResolvedFact`, `VerifiedFact`, etc. Author corresponding `*.surface.json` files showing expected projection output. The cross-layer rule from TV2 keeps these in sync with projection code.

### TV5 — Per-feature budget for rule-pack updates

`.veritas/budget/feature-rule-pack-update.json`:

```json
{
  "scope": { "type": "feature", "matches": ["packages/tax-rules/**"] },
  "budget": {
    "requiredProofLanes": ["test:unit:rules", "test:integration:rules"],
    "maxRunDurationMs": 600000
  }
}
```

`veritas budget --feature feature-rule-pack-update` reports cost trends. Catches "rule-pack updates are getting more expensive — investigate" before it hurts.

### TV6 — Eval history and improvement loop

`veritas eval record` and `veritas eval summary` run weekly via cron. Track:

- Which rules fire most often.
- Which rules produce false positives (tracked via `--override` flags).
- Time-to-green after a FAIL.

Drives policy-pack refinement.

### TV7 — Push gaps back to Veritas

If integration reveals gaps (e.g., needing a rule type that doesn't exist, or governance block parameter not supported), surface as Veritas issues and resolve in V1–V7 before V6 confirmation.

## Confirmation: Campfit

Campfit is greenfield. Goal: prove the `next-prisma` adapter pack covers a real Next.js + Prisma trust-bearing app.

### CV1 — Install via adapter pack

```bash
npm install -D @kontourai/veritas
npx veritas init --pack next-prisma
```

Pack installs:

- `.veritas/repo.adapter.json` with surface map for `app/`, `lib/`, `prisma/`, `public/`, `tests/`
- `.veritas/policy-packs/default.policy-pack.json` with default rules
- Governance blocks in `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`
- Pre-commit hook

### CV2 — Author Campfit-specific rules

Default pack rules cover most cases. Campfit-specific additions:

- **Crawl pipeline:**
  - `if-changed: lib/ingestion/llm-extractor.ts then-require: tests/extraction/*.surface.json` (cross-layer)
  - `if-changed: lib/ingestion/diff-engine.ts then-require: tests/diff-engine/`
- **Admin review:**
  - `if-changed: app/admin/review/ then-require: tests/admin/review/`
- **Schema and migrations:**
  - Already covered by pack defaults.
- **Stripe and Supabase:**
  - `required-artifact: lib/stripe/**.ts must reference STRIPE_SECRET_KEY via process.env`
  - `required-artifact: lib/supabase/**.ts must use server-side client in route handlers`
- **Surface projection (cross-layer):**
  - `if-changed: lib/surface/from-attestation.ts then-require: tests/surface/from-attestation.test.ts with valid surface.input`

### CV3 — Per-feature budget for crawl

Crawl pipeline is expensive and risky. Author dedicated budget:

```json
{
  "scope": { "type": "feature", "matches": ["lib/ingestion/**", "scripts/run-crawl.ts"] },
  "budget": {
    "maxLlmTokensPerRun": 500000,
    "maxRunDurationMs": 300000,
    "requiredProofLanes": ["smoke-crawl-fixture-provider"],
    "alertThresholds": {
      "tokensExceedingPct": 80,
      "errorRateExceedingPct": 5
    }
  }
}
```

`smoke-crawl-fixture-provider` runs the crawler against a checked-in fixture provider (no live HTTP) and validates the output projects to a valid Surface input.

### CV4 — Wire shadow run

Pre-commit hook (default from pack) plus PR check (same as Taxes TV3).

### CV5 — Confirmation report

After CV1–CV4, write `docs/integration-report.md` in this Veritas repo summarizing:

- What the `next-prisma` pack covered out of the box.
- What had to be added in Campfit.
- Whether anything in the pack didn't fit.

If the pack needed significant additions, those are V-B1 follow-ups. If it fit cleanly, V-B1 is validated.

## Cross-cutting concerns

### Boundary discipline

The boundary doc claim that "Veritas evidence includes a `surface.input` projection" is currently honored for repo-scoped projections only. After this plan ships:

- Veritas evidence projections remain repo-scoped (test runs, smoke crawls, projection fixtures).
- Production app evidence projections live in the app's Surface store, never in `.veritas/`.
- Both validate against the same Surface SHACL once available.
- This separation is enforced by an existing reference test (`x_surface_mapping`) plus the new V-D parity tests.

### Versioning and compatibility

Veritas, Surface, and adapter packs each version independently. After V-B3 ships, adapter packs declare their compatible Veritas and Surface versions. Compatibility matrix lives at `docs/compatibility.md` (new file, ships alongside V2):

```
@kontourai/veritas-adapter-next-prisma@0.2.x is compatible with veritas@0.3.x and surface@0.4.x
```

### Eval-driven policy refinement

The eval history loop (`veritas eval record`, `veritas eval summary`) is the governance feedback loop. Both pilots feed it; trends inform default-rule revisions in V-B packs.

### Living evidence vs snapshot evidence

This is the most important discipline:

- **Veritas evidence is a snapshot:** point-in-time, immutable, scoped to a code change. Lives in `.veritas/evidence/`.
- **Surface app-runtime evidence is living:** updated as the world changes, scoped to subjects. Lives in the app's Surface store.

Both validate against Surface SHACL, but they're different graphs. Veritas's `surface.input` block is *test* evidence (or *fixture* evidence) — never authoritative for production claims about the same subject. The boundary doc gets a new "Living vs snapshot evidence" section formalizing this.

## Success criteria

This plan succeeds when:

1. Taxes runs `veritas shadow run` in PR checks and the policy pack fires on real, useful violations (rule-pack edits without migration, MCP server changes without integration test, projection edits without fixture update).
2. Campfit installs Veritas via `npx veritas init --pack next-prisma` and the default rules + a small set of Campfit-specific additions cover the trust-bearing seams (crawl, review, schema, projection).
3. Both apps emit Veritas evidence whose `surface.input` blocks validate against Surface SHACL (once Surface SHACL ships).
4. The cross-layer rules in V-A catch at least one real regression in each app within the first month of integration.
5. Per-feature budgets are reporting useful trends for both Campfit's crawl pipeline and Taxes' rule-pack updates.
6. The `next-prisma` and `mcp-monorepo` adapter packs are documented and reusable by future apps without modification.

## Open questions

1. **Should adapter packs ship as separate npm packages or as `adapters/` subdirectories?** Separate packages are cleaner; subdirectories are simpler for discovery. Recommendation: subdirectories under `adapters/` initially, promote to packages once stable.
2. **Should `surface-fixture-required` rules execute inside the Veritas process, or shell out to a Surface CLI?** In-process is faster and gives better errors; shell-out is more robust to version drift. Recommendation: in-process via peerDependency, with shell-out as a fallback.
3. **Should governance block templating support arbitrary Handlebars, or a closed set of variables?** Closed set is safer; arbitrary is more flexible. Recommendation: closed set initially (`packId`, `surfaceList`, `policyPackId`); expand on demand.
4. **Does the parity test require SHACL or just `validateTrustInput`?** Until Surface SHACL ships, only `validateTrustInput`. After, both. Coordinate switch with Surface's linked-data Phase 2.

## See also

- [concepts.md](./concepts.md) — Veritas conceptual model
- [architecture/surface-veritas-boundary.md](./architecture/surface-veritas-boundary.md) — boundary contract
- [design/policy-packs.md](./design/policy-packs.md) — policy pack format
- [design/proof-family-results.md](./design/proof-family-results.md) — proof family results
- [../../surface/docs/integration-plan.md](../../surface/docs/integration-plan.md) — corresponding Surface plan
- [../../surface/docs/grounding-audit.md](../../surface/docs/grounding-audit.md) — audit findings
