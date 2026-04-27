# Brownfield Adoption

Use this guide when adding Veritas to a repo that already has custom AI instructions, guidance folders, CI contracts, or verification scripts.

## 1. Inventory First

Collect:

- AI instruction files,
- custom verification scripts,
- CI jobs,
- policy or trust docs,
- existing evidence or report artifacts.

Do not copy old verification checks into Veritas one-to-one.

For a read-only first pass, run:

```bash
npx @kontourai/veritas init --explore --output .veritas/init-plans/brownfield.json
```

When package scripts or legacy paths such as `.ai-guidance`, `verify:convergence`, or `guidance:report` are detected, the recommendation includes `legacy_verification` and `recommended_proof_family_inventory` sections. Treat those as a review queue, not applied policy.

## 2. Classify Existing Checks

For each check family, record:

- recent catch evidence,
- regression severity,
- false-positive risk,
- replacement test availability,
- owner,
- expiry or review trigger,
- default disposition.

Unknown catch evidence defaults to candidate/advisory status. Required checks need an owner and a review trigger.
Required checks also need non-unknown catch evidence. If the evidence is unknown, keep the family candidate/advisory while you add tests or gather real catches.

## 3. Keep Required Gates Small

Start with a required governance lane that proves:

- `.veritas` artifacts exist,
- CI runs a real proof lane,
- AI instruction files point agents at Veritas governance,
- evidence/report commands are wired.

Keep broad legacy guardrails as compatibility aggregators only while decomposed lanes prove equivalence.

## 4. Move Product Behavior To Tests

If a check asserts product behavior, move it into the normal test suite:

- route and schema behavior -> unit/integration tests,
- runtime/provider behavior -> integration tests,
- user workflows -> E2E tests,
- published docs -> docs build and rendered review.

Veritas should route and report those tests as proof lanes.

## 5. Promote Reusable Shapes Upstream

Promote generic Veritas capabilities such as:

- proof-family results,
- candidate/advisory proof lanes,
- expiry and freshness metadata,
- forbidden import-owner policies,
- brownfield inventory generation.

Do not promote one repo's module names or refactor history into Veritas.

## 6. Publish Only After The Package Catches Up

Local proving-ground work may use a file dependency on a local Veritas checkout. Public docs should point to the published `@kontourai/veritas` package only after the needed features are released.

## Verification

Before considering a brownfield migration complete:

```bash
npm run verify
npm test
npm exec -- veritas report --working-tree
npm exec -- veritas budget --working-tree
npm exec -- veritas shadow run --working-tree --format feedback
```

Repo-specific proof lanes may add stricter commands, but the migration should stay clear about which checks are required, candidate, advisory, or retiring.

When using proof families, add the manifest to the adapter:

```json
{
  "evidence": {
    "proofFamilyManifests": [
      ".veritas/proof-families/repo-guardrails.families.json"
    ]
  }
}
```

Then confirm the report includes `proof_family_results` and `verification_budget`. The budget should be reviewed before promoting more checks to required; `veritas budget` gives the same promotion/retirement signal without requiring the full report.
