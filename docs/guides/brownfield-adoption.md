# Brownfield Adoption

Use this guide when adding Veritas to a repo that already has custom AI instructions, guidance folders, CI contracts, or verification scripts.

The goal is not to copy every existing check into Veritas. The goal is to turn the parts that actually define merge readiness and repo conformance into repo standards.

## 1. Inventory First

Collect:

- AI instruction files
- custom verification scripts
- CI jobs
- ownership or review docs
- existing evidence or report artifacts
- known shared-code boundaries
- recurring repo-health checks

For a read-only first pass:

```bash
npx @kontourai/veritas init --explore --output .veritas/init-plans/brownfield.json
```

When package scripts or existing guidance paths are detected, the recommendation may include implementation fields such as `existing_verification` and `recommended_evidence_inventory`. Treat those as review queues for evidence checks and readiness coverage, not as applied standards.

## 2. Classify Existing Checks

For each existing check or check item, record:

- what requirement it supports
- what evidence it produces
- whether the evidence is fresh for the current change
- who or what is the verification authority
- recent catch evidence
- false-positive risk
- replacement test availability
- owner or review authority
- expiry or recheck trigger
- suggested enforcement level

Unknown catch evidence should start at Observe or Guide. Use Require only after the check has a clear requirement, authority, freshness policy, and review trigger.

## 3. Keep Required Standards Small

Start by requiring only the standards that protect the system itself:

- Veritas artifacts exist
- AI instruction files point agents at Veritas guidance
- the repo has at least one real evidenceCheck
- protected standards changes require attestation

Keep broad existing guardrails as observation or guidance while you decompose them into clearer requirements.

## 4. Move Product Behavior To Tests

If a check asserts product behavior, move it into the normal test suite:

- route and schema behavior -> unit or integration tests
- runtime/provider behavior -> integration tests
- user workflows -> E2E tests
- published docs -> docs build and rendered review

Veritas should route and report those checks as evidence. It should not become the product test suite.

## 5. Promote Reusable Shapes Carefully

Promote generic Veritas capabilities such as:

- evidenceCheck inventories
- candidate or advisory checks
- expiry and freshness metadata
- forbidden import-owner requirements
- brownfield inventory generation
- boundary guidance for shared code

Do not promote one repo's module names, historical exceptions, or refactor details into Veritas itself.

## Verification

Before considering a brownfield migration complete:

```bash
npm run verify
npm test
npm exec -- veritas readiness --check evidence --working-tree
npm exec -- veritas readiness --check coverage --working-tree
npm exec -- veritas readiness --working-tree --format feedback
```

`readiness --check coverage` is the current command for readiness coverage. Review its output before moving more requirements to Require.
