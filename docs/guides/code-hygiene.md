# Code hygiene with executable standards

Veritas connects repository requirements, agent guidance and the evidence for a
change. Existing linters, tests and reviewers remain responsible for detecting
violations. A readiness result means the selected requirements have the recorded
evidence; it does not prove that every desirable property was tested.

## Preview requirements before editing

```bash
npx --no @kontourai/veritas plan src/example.ts tests/example.unit.test.ts
npx --no @kontourai/veritas plan --working-tree --json
npx --no @kontourai/veritas plan --changed-from origin/main --changed-to HEAD
```

`plan` is read-only. It uses the same routing and rule matching as readiness,
returns a `ChangePlan` resource with selected checks and their required/advisory status, and presents
matching guidance. It never executes checks or creates evidence. Hypothetical
new paths are supported. Unknown flags, invalid configuration, ambiguous scope
and paths outside the repository are rejected. Unmapped paths are reported with
the configured coverage policy; a successful plan is not a readiness decision.

## Define an evidence-backed requirement

Use `kind: "evidence-check"` when a requirement is proved by a tool or test rather
than by the presence of a file or a text pattern:

```json
{
  "id": "code-hygiene",
  "kind": "evidence-check",
  "classification": "promotable-policy",
  "enforcementLevel": "Require",
  "message": "Source changes must pass code hygiene checks.",
  "match": { "files": ["src/**", "tests/**", "!src/**/*.generated.*"] },
  "evidenceCheckIds": ["code-hygiene"],
  "explain": {
    "mustDo": ["Explain lint/type-check suppressions."],
    "mustNotDo": ["Do not weaken the rule to silence findings."]
  }
}
```

Add the named Evidence Check to the Repo Map's `evidence.evidenceChecks`:

```json
{
  "id": "code-hygiene",
  "command": "npm run lint:hygiene",
  "method": "validation"
}
```

`match.files` uses ordered include/exclude patterns shared by guidance and
execution routing. A matching rule is pending until its linked checks execute.
Unknown check IDs are configuration errors. Missing, skipped or failed execution
cannot satisfy a Require rule; Guide keeps the unmet requirement advisory.
Existing rules can still use `evidenceCheckIds` alongside their native assertions.

This connects guidance to a check, not automatically to every rule inside that
check. Keep requirement claims no broader than the detector's tested coverage.

## Optional Oxlint reference pack

The published package includes [an example pack](../../examples/code-hygiene/README.md)
with an Oxlint plugin, configuration and Repo Standards. Use its public `@kontourai/veritas/hygiene/oxlint` export in a repo-owned
Oxlint configuration, install a pinned Oxlint development dependency, and add:

```json
{
  "scripts": {
    "lint:hygiene": "oxlint --config config/code-hygiene.oxlint.json --report-unused-disable-directives src tests"
  }
}
```

For example, the configuration can load the plugin without importing package internals:

```json
{
  "jsPlugins": ["@kontourai/veritas/hygiene/oxlint"],
  "rules": { "repo-hygiene/require-suppression-reason": "error" }
}
```

Merge the example requirement and check into your reviewed governance config.
Run `readiness --check config`, `plan` and the real detector before promotion.
Protected Standards changes retain the repository's approval/attestation process.

The initial pack requires explanations for suppressions, warns about low-value
comments, and bans direct real clocks/timers only in `*.unit.test.*` files.
Canonical Node namespace imports are available but opt-in: this is a style choice,
not a universal correctness requirement. The syntax-based timing rule is deliberately
narrow; aliases and arbitrary wrapper calls are not a complete timing analysis.
Use a reviewed integration/performance scope for tests that must measure real time.
An inline explanation is reviewer context, not an authority-backed exception.

These examples adapt portable parts of T3 Code's hygiene approach, with its MIT
attribution retained. Effect, React Compiler, Hermes, Uniwind, RPC permission
wrappers and disposable React render helpers need repository-specific rules and
prerequisites. Do not transplant those bans into unrelated stacks.

## Evidence identity and source drift

Readiness captures a private before/after snapshot of Git-visible tracked and
untracked inputs plus explicit scope and governance configuration paths, file modes, symbolic-link targets, HEAD and index state.
Changes during check execution invalidate the run before report generation with
`VERITAS_SOURCE_CHANGED`. Generated `.kontourai/veritas/` output is excluded.
The snapshot hashes never enter public reports: source/config files can contain
secrets. A failed run requires finishing/restoring edits and rerunning checks.

Checks should write generated output to ignored paths, not modify source while
verifying it. This guard is not a sandbox or an immutable build environment. It
does not detect transient changes restored between snapshots, changes inside
ignored dependencies, or changes after the final snapshot. Gitlinks/non-file
inputs fail rather than receiving an unsupported verification claim. Consumers
must still compare evidence identity with the current change at admission.

## Interoperability direction

Veritas's configuration contract is JSON Schema Draft 2020-12. Use established
formats at integration boundaries:

- [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html)
  for static-analysis findings: rule IDs, locations, severity and fixes. A SARIF
  artifact is detector output, not proof of execution or trusted source identity.
- [OPA/Rego](https://www.openpolicyagent.org/docs/policy-language) and
  [Conftest](https://www.conftest.dev/) as optional external policy checks. Run
  the tool through an Evidence Check; do not reimplement Rego inside Veritas.
- [in-toto/SLSA verification summaries](https://slsa.dev/spec/v1.2/verification_summary)
  for verifiable subject, policy, verifier and evidence relationships. Current
  Veritas reports are not signed SLSA attestations or a SLSA level certification.
- [OSCAL](https://pages.nist.gov/OSCAL/) for future mapping to control catalogs and
  assessment results when customers need compliance reporting. This is not a
  substitute for executable checks or an existing OSCAL adapter.

These are integration priorities, not claims that Veritas already implements
SARIF import/export, signed attestations, or OSCAL. Existing Evidence Checks can
run tools that emit these formats; normalized native adapters need independent
validation and source/authority binding.

## Keep reusable orchestration separate from product checks

Native Veritas owns `plan`, `explain`, readiness, rule/check routing and policy
configuration validation. Thin npm aliases are useful stable repo entry points.
Product-specific build/test commands remain external Evidence Checks. In
Station, UI/native/SDK behavior, dependency lifecycle and its coordinated test
scheduler remain Station-owned; their selected commands are not themselves
Veritas product semantics. Generic scanner adapters and policy authoring belong
upstream only when they remove repeated integration work across repositories.

## Kontour Resource Contracts

The native portable model follows the shared
[Kontour Resource Shape](https://github.com/kontourai/kontourai.io/blob/main/docs/kontour-resource-shape.md),
not a Kubernetes runtime dependency. New JSON plans are `ChangePlan` resources:
`apiVersion: veritas.kontour.ai/v1alpha1`, `kind`, `metadata`, `spec.files` and
`status` with a `ChecksExecuted=False` condition. The plan records observations;
it cannot assert merge readiness.

Authored standards may use a `RepoStandards` resource with the same API version,
`metadata.name` and `spec.requirements`. The resource schema is
`schemas/veritas-repo-standards-resource.schema.json`. The original version-1
`name`/`rules` files remain supported. Resource inputs are validated strictly,
then normalized to the existing evaluator model; unsupported versions and
producer-authored `status` verdicts are rejected. Protected-standards hashing
still covers the complete authored file, including its resource metadata.

The example hygiene pack uses the resource form. Wrap existing `rules` under
`spec.requirements` and move the standards name to `metadata.name`; review and
attest an existing protected-policy migration before adoption. Repo Maps and
durable readiness evidence keep their existing formats in this additive slice.
See [Resource Contract Audit](../resource-contract-audit.md) for remaining
migration families. Resource shape is not a second generic trust format:
Surface/Hachure retain ownership of portable trust semantics.
