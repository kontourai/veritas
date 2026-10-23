# Documentation audit: October 2026

This record describes a source and usability audit of the documentation at Veritas 1.12.1. It is not a claim that every integration was executed on every host.

## Product and entry path

The useful core is: define project policies, show applicable guidance before an edit, run existing checks and explain missing evidence afterward. The entry path now uses **set up → plan → check readiness**. Approval, boundary modeling, feedback, plugins and cross-product contracts remain available as optional depth.

The audit corrected misleading setup examples, no-op evidence presentation, the companion-test walkthrough, release instructions, resource and plugin contracts, external artifact paths, strictness rules, claim status retention, hook capabilities and unsupported telemetry implications. Historical planning pages are explicitly historical rather than current feature backlogs.

## Capability disposition

| Capability | Disposition | Reason |
| --- | --- | --- |
| Policies, path matching, guidance and executed checks | Core | Connect expectations to actionable feedback and evidence |
| Required evidence and source/config integrity | Core | Missing or stale evidence must not silently count as passing |
| Resource-shaped policy and native plans | Core | Reusable contracts and less consumer glue |
| Approval and attestations | Optional depth | Valuable for protected policy changes; reference-only and resolved approval must remain distinct |
| Work-area graph and boundaries | Optional depth | Useful in larger repositories; excessive for a first policy |
| Runtime hooks and Governance Kit | Optional integration | Installation is not proof the host loaded or executed a hook |
| Feedback and recommendations | Optional, evidence-limited | Human judgment and real catch evidence are needed; silence does not prove a rule is obsolete |
| Claims, plugins and Surface projection | Advanced integration | Stable interoperability matters, but users need not learn it to start |
| Historical roadmaps | History | Keep provenance; do not present completed work as pending or aspirations as shipped |
| OTLP exporter, hosted analytics and automatic learning | Future/external | No shipped exporter or universal outcome proof is claimed |

No runtime feature was removed solely because it was difficult to explain. Source validity and product usefulness are different judgments; deployment and usage studies remain needed to establish the latter.

## Verification and limits

The revised walkthrough was executed in a disposable Git repository: missing companion warned, adding a real handler test passed, changing the handler response caused that test to fail, and restoring it returned green. This proves the demonstrated policy and test loop, not application-wide correctness.

The inventory below records each original tracked Markdown file's role and review disposition. Public contracts were compared to implementation, schemas, manifests and workflows. Generated fixtures and changelog entries retain historical meaning. Structural checks verify links, anchors, publication coverage and source routes; they do not replace semantic review. Live provider/host behavior, external tool releases, rendered console behavior and marketplace outcomes are outside this source audit.

## File inventory


| File | Role | Disposition and scope |
| --- | --- | --- |
| [.github/ISSUE_TEMPLATE/bug_report.md](../.github/ISSUE_TEMPLATE/bug_report.md) | Contribution policy | Retained: Reviewed usability and consistency; contact delivery and maintainer response commitments are not runtime-tested. |
| [.github/ISSUE_TEMPLATE/feature_request.md](../.github/ISSUE_TEMPLATE/feature_request.md) | Contribution policy | Retained: Reviewed usability and consistency; contact delivery and maintainer response commitments are not runtime-tested. |
| [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) | Contribution policy | Retained: Reviewed usability and consistency; contact delivery and maintainer response commitments are not runtime-tested. |
| [.github/copilot-instructions.md](../.github/copilot-instructions.md) | Repository instructions | Retained: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |
| [.veritas/GOVERNANCE.md](../.veritas/GOVERNANCE.md) | Repository instructions | Retained: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |
| [.veritas/README.md](../.veritas/README.md) | Repository instructions | Corrected: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |
| [AGENTS.md](../AGENTS.md) | Repository instructions | Retained: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |
| [CHANGELOG.md](../CHANGELOG.md) | Release history | Retained: Preserved release entries; current release identity checked against package/tag. Older entries are history, not re-executed claims. |
| [CLAUDE.md](../CLAUDE.md) | Repository instructions | Corrected: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Contribution policy | Retained: Reviewed usability and consistency; contact delivery and maintainer response commitments are not runtime-tested. |
| [CONTEXT-MAP.md](../CONTEXT-MAP.md) | Maintainer vocabulary | Retained: Compared definitions with readiness, approval, feedback and projection owners; separated assertions from resolved authority. |
| [CONTEXT.md](../CONTEXT.md) | Maintainer vocabulary | Corrected: Compared definitions with readiness, approval, feedback and projection owners; separated assertions from resolved authority. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Repository instructions | Retained: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |
| [README.md](../README.md) | Entry and navigation | Corrected: Reworked around setup, plan and readiness; linked supported optional depth and explicit evidence limits. |
| [SECURITY.md](../SECURITY.md) | Contribution policy | Corrected: Reviewed usability and consistency; contact delivery and maintainer response commitments are not runtime-tested. |
| [docs/MIGRATING.md](MIGRATING.md) | Migration reference | Corrected: Reviewed compatibility guidance against current loaders, hooks, approval, output and fixture contracts; corrected obsolete current-state claims. |
| [docs/README.md](README.md) | Entry and navigation | Corrected: Reworked around setup, plan and readiness; linked supported optional depth and explicit evidence limits. |
| [docs/RELEASING.md](RELEASING.md) | Product reference | Corrected: Reviewed product boundary and maintainer paths against current exports and scripts. |
| [docs/architecture/developer-architecture.md](architecture/developer-architecture.md) | Architecture and migration | Corrected: Compared current exports, resource support and projection contract; historical staged plans remain revision-bound. |
| [docs/architecture/engine-surface-seam.md](architecture/engine-surface-seam.md) | Architecture and migration | Corrected: Compared current exports, resource support and projection contract; historical staged plans remain revision-bound. |
| [docs/architecture/surface-veritas-boundary.md](architecture/surface-veritas-boundary.md) | Architecture and migration | Corrected: Compared current exports, resource support and projection contract; historical staged plans remain revision-bound. |
| [docs/claim-authoring.md](claim-authoring.md) | Product reference | Corrected: Reviewed product boundary and maintainer paths against current exports and scripts. |
| [docs/concepts.md](concepts.md) | Product reference | Corrected: Reviewed product boundary and maintainer paths against current exports and scripts. |
| [docs/design/agent-activation.md](design/agent-activation.md) | Design contract | Corrected: Reviewed against relevant schema, routing, feedback and policy owners; distinguished desired behavior from generator support. |
| [docs/design/evidence-inventories.md](design/evidence-inventories.md) | Design contract | Retained: Reviewed against relevant schema, routing, feedback and policy owners; distinguished desired behavior from generator support. |
| [docs/design/implementation-backlog.md](design/implementation-backlog.md) | Historical plan | Corrected: Retained design history and labeled its lifecycle; not a current shipping commitment or task list. |
| [docs/design/product-core-and-repo-map.md](design/product-core-and-repo-map.md) | Design contract | Corrected: Reviewed against relevant schema, routing, feedback and policy owners; distinguished desired behavior from generator support. |
| [docs/design/reality-check-plan.md](design/reality-check-plan.md) | Historical plan | Corrected: Retained design history and labeled its lifecycle; not a current shipping commitment or task list. |
| [docs/design/repo-standards.md](design/repo-standards.md) | Design contract | Corrected: Reviewed against relevant schema, routing, feedback and policy owners; distinguished desired behavior from generator support. |
| [docs/design/roadmap.md](design/roadmap.md) | Historical plan | Corrected: Retained design history and labeled its lifecycle; not a current shipping commitment or task list. |
| [docs/design/schema-evolution.md](design/schema-evolution.md) | Design contract | Retained: Reviewed against relevant schema, routing, feedback and policy owners; distinguished desired behavior from generator support. |
| [docs/design/standards-feedback-roadmap.md](design/standards-feedback-roadmap.md) | Historical plan | Corrected: Retained design history and labeled its lifecycle; not a current shipping commitment or task list. |
| [docs/design/standards-feedback.md](design/standards-feedback.md) | Design contract | Corrected: Reviewed against relevant schema, routing, feedback and policy owners; distinguished desired behavior from generator support. |
| [docs/design/terminology-decisions.md](design/terminology-decisions.md) | Design contract | Retained: Reviewed against relevant schema, routing, feedback and policy owners; distinguished desired behavior from generator support. |
| [docs/guides/agent-runtime-integrations.md](guides/agent-runtime-integrations.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/attestation.md](guides/attestation.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/brownfield-adoption.md](guides/brownfield-adoption.md) | Operator guide | Retained: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/code-hygiene.md](guides/code-hygiene.md) | Operator guide | Retained: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/deep-integration-template.md](guides/deep-integration-template.md) | Operator guide | Retained: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/fallow-integration.md](guides/fallow-integration.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/getting-started.md](guides/getting-started.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/governance-kit.md](guides/governance-kit.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/publish-and-release.md](guides/publish-and-release.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/recommendations.md](guides/recommendations.md) | Operator guide | Retained: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/repo-conformance.md](guides/repo-conformance.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/start-your-next-project.md](guides/start-your-next-project.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/tune-for-your-team.md](guides/tune-for-your-team.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/guides/walkthrough.md](guides/walkthrough.md) | Operator guide | Corrected: Reviewed named commands and behavior against CLI, configuration, integration code or publication workflows; no blanket provider/device qualification. |
| [docs/plugin-authoring.md](plugin-authoring.md) | Product reference | Corrected: Reviewed product boundary and maintainer paths against current exports and scripts. |
| [docs/reference/artifacts-and-schemas.md](reference/artifacts-and-schemas.md) | Contract reference | Corrected: Reviewed CLI, loaders, schemas and corresponding implementation; external runtime behavior is not independently qualified. |
| [docs/reference/benchmarking.md](reference/benchmarking.md) | Contract reference | Retained: Reviewed CLI, loaders, schemas and corresponding implementation; external runtime behavior is not independently qualified. |
| [docs/reference/cli.md](reference/cli.md) | Contract reference | Corrected: Reviewed CLI, loaders, schemas and corresponding implementation; external runtime behavior is not independently qualified. |
| [docs/reference/env-vars.md](reference/env-vars.md) | Contract reference | Corrected: Reviewed CLI, loaders, schemas and corresponding implementation; external runtime behavior is not independently qualified. |
| [docs/reference/examples.md](reference/examples.md) | Contract reference | Retained: Reviewed CLI, loaders, schemas and corresponding implementation; external runtime behavior is not independently qualified. |
| [docs/reference/glossary.md](reference/glossary.md) | Contract reference | Retained: Reviewed CLI, loaders, schemas and corresponding implementation; external runtime behavior is not independently qualified. |
| [docs/reference/telemetry-and-read-models.md](reference/telemetry-and-read-models.md) | Contract reference | Corrected: Reviewed CLI, loaders, schemas and corresponding implementation; external runtime behavior is not independently qualified. |
| [docs/resource-contract-audit.md](resource-contract-audit.md) | Architecture and migration | Corrected: Compared current exports, resource support and projection contract; historical staged plans remain revision-bound. |
| [docs/site-index.md](site-index.md) | Entry and navigation | Corrected: Reworked around setup, plan and readiness; linked supported optional depth and explicit evidence limits. |
| [docs/veritas-and-surface.md](veritas-and-surface.md) | Product reference | Corrected: Reviewed product boundary and maintainer paths against current exports and scripts. |
| [examples/README.md](../examples/README.md) | Example or template | Corrected: Compared with corresponding shipped templates, plugin/config files or fixture ownership; enforcement and evidence limits clarified where needed. |
| [examples/code-hygiene/README.md](../examples/code-hygiene/README.md) | Example or template | Retained: Compared with corresponding shipped templates, plugin/config files or fixture ownership; enforcement and evidence limits clarified where needed. |
| [examples/repo-conformance/README.md](../examples/repo-conformance/README.md) | Example or template | Corrected: Compared with corresponding shipped templates, plugin/config files or fixture ownership; enforcement and evidence limits clarified where needed. |
| [examples/repo-conformance/veritas-repo-conformance-red.md](../examples/repo-conformance/veritas-repo-conformance-red.md) | Format fixture | Retained: Compared with companion JSON and fixture generator; retained synthetic evidence with parent README qualification. |
| [examples/repo-conformance/veritas-repo-report.md](../examples/repo-conformance/veritas-repo-report.md) | Format fixture | Retained: Compared with companion JSON and fixture generator; retained synthetic evidence with parent README qualification. |
| [examples/repo-conformance/veritas-repo-standards-feedback-draft.md](../examples/repo-conformance/veritas-repo-standards-feedback-draft.md) | Format fixture | Retained: Compared with companion JSON and fixture generator; retained synthetic evidence with parent README qualification. |
| [examples/repo-conformance/veritas-repo-standards-feedback.md](../examples/repo-conformance/veritas-repo-standards-feedback.md) | Format fixture | Retained: Compared with companion JSON and fixture generator; retained synthetic evidence with parent README qualification. |
| [examples/repo-standards/README.md](../examples/repo-standards/README.md) | Example or template | Corrected: Compared with corresponding shipped templates, plugin/config files or fixture ownership; enforcement and evidence limits clarified where needed. |
| [examples/repo-standards/monorepo-pnpm-example/README.md](../examples/repo-standards/monorepo-pnpm-example/README.md) | Example or template | Retained: Compared with corresponding shipped templates, plugin/config files or fixture ownership; enforcement and evidence limits clarified where needed. |
| [examples/repo-standards/nextjs-typescript-example/README.md](../examples/repo-standards/nextjs-typescript-example/README.md) | Example or template | Retained: Compared with corresponding shipped templates, plugin/config files or fixture ownership; enforcement and evidence limits clarified where needed. |
| [examples/repo-standards/python-fastapi-example/README.md](../examples/repo-standards/python-fastapi-example/README.md) | Example or template | Retained: Compared with corresponding shipped templates, plugin/config files or fixture ownership; enforcement and evidence limits clarified where needed. |
| [repo-maps/README.md](../repo-maps/README.md) | Repository instructions | Retained: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |
| [skills/consult-standards/SKILL.md](../skills/consult-standards/SKILL.md) | Agent workflow | Corrected: Compared skill sequence with CLI, flow and provision declarations; host execution and external release compatibility not independently qualified. |
| [skills/setup-governance/SKILL.md](../skills/setup-governance/SKILL.md) | Agent workflow | Retained: Compared skill sequence with CLI, flow and provision declarations; host execution and external release compatibility not independently qualified. |
| [skills/standards-authoring/SKILL.md](../skills/standards-authoring/SKILL.md) | Agent workflow | Retained: Compared skill sequence with CLI, flow and provision declarations; host execution and external release compatibility not independently qualified. |
| [src/attestations/CONTEXT.md](../src/attestations/CONTEXT.md) | Maintainer vocabulary | Corrected: Compared definitions with readiness, approval, feedback and projection owners; separated assertions from resolved authority. |
| [src/readiness/CONTEXT.md](../src/readiness/CONTEXT.md) | Maintainer vocabulary | Retained: Compared definitions with readiness, approval, feedback and projection owners; separated assertions from resolved authority. |
| [src/standards-feedback/CONTEXT.md](../src/standards-feedback/CONTEXT.md) | Maintainer vocabulary | Retained: Compared definitions with readiness, approval, feedback and projection owners; separated assertions from resolved authority. |
| [src/surface/CONTEXT.md](../src/surface/CONTEXT.md) | Maintainer vocabulary | Retained: Compared definitions with readiness, approval, feedback and projection owners; separated assertions from resolved authority. |
| [tests/README.md](../tests/README.md) | Repository instructions | Retained: Compared commands, paths and ownership with package scripts, hooks, map/templates and test layout; protected instructions preserved. |

## Product work still needed

Documentation now describes the shipped CLI accurately. It does not implement an interactive setup wizard, a concise human-default init summary, an incomplete-setup status, or an automatic first-policy demonstration. Those require product changes and behavioral acceptance tests. A future onboarding slice should reuse the existing init proposal/apply logic, connect a real check, show one known-bad and one valid case, and expose advanced configuration only on demand.

Executed for this documentation change: Corpus checks and site build, repository verification, a real walkthrough with failure/restoration, conformance with zero failures and one existing advisory Fallow warning, and Chrome inspection of the landing/setup journey. The source review included an independent technical pass. Full-suite and hosted results belong to their exact commit/run receipts rather than this durable explanation.

## Removed prose-pinning test

`tests/reference.test.mjs` contained “first-contact docs preserve the Surface foundation boundary,” which read five Markdown files and asserted literal sentences/headings. It failed on this behavior-preserving rewrite. It could detect changed wording, not a broken engine boundary. The independent keepers are `tests/engine-subpath.test.mjs` for actual public export isolation, `tests/surface/readiness-derived-claim.test.mjs` and the other Surface tests for runtime projection/derivation, plus Corpus and repository verification for document links and structure. Removing the prose test deletes no production seam and changes no runtime contract. The remaining reference file and named keepers are executed as the focused validation; broad hosted checks remain separate.
