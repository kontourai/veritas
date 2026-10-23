# Veritas

[![npm version](https://img.shields.io/npm/v/%40kontourai%2Fveritas)](https://www.npmjs.com/package/@kontourai/veritas)
[![CI](https://github.com/kontourai/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/kontourai/veritas/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Define your project's rules once. Veritas tells agents which rules apply, runs the relevant checks, and shows what still needs attention.**

Use your existing tests, linters and verification commands. Veritas connects them to repository policies and gives developers and agents guidance before they edit. A readiness report shows the evidence for those policies; your team still decides whether to merge.

## Quickstart

Requires Node.js 22 or newer and a Git repository. Install with your project's package manager; for npm:

```bash
npm install -D @kontourai/veritas
npx --no @kontourai/veritas init --evidence-check "npm test"
```

Replace `npm test` with an existing command that actually checks your project. Review the generated configuration before running it: readiness executes configured commands. If initialization cannot find a project check, its fallback only verifies that Node can run. That is incomplete project setup, even when the smoke check passes.

Then use two commands during development:

```bash
# Before editing: see applicable policies, guidance and selected checks.
npx --no @kontourai/veritas plan src/example.ts

# After editing: execute checks and inspect unmet requirements.
npx --no @kontourai/veritas readiness --working-tree
```

`plan` does not run checks. `readiness` does. Start with the [setup guide](docs/guides/getting-started.md) for configuration review and approval, or the [walkthrough](docs/guides/walkthrough.md) for a concrete policy catch.

## What You Get

| File | Question it answers |
| --- | --- |
| `.veritas/repo-standards/default.repo-standards.json` | What rules apply, and what should an agent do? |
| `.veritas/repo-map.json` | Where do those rules apply, and which checks provide evidence? |
| `.veritas/authority/default.authority-settings.json` | What approval-reference and review preferences apply? |

A policy can give advice (`Guide`) or require passing evidence (`Require`). Begin with advice for rules you are still tuning. Keep hard requirements small and prove that their checks catch the intended problem.

Veritas can require a companion test change, check a forbidden pattern, or connect a policy to an existing test or linter command. Its optional [code hygiene pack](docs/guides/code-hygiene.md) includes detectors for unexplained suppressions and uncontrolled clocks in unit tests. A changed test file alone does not prove that a feature works.

## Choose your next step

- [Set up an existing repository](docs/guides/getting-started.md) and connect its checks.
- [See a policy catch](docs/guides/walkthrough.md) and its limits.
- [Give your agent guidance](docs/guides/agent-runtime-integrations.md) through supported hooks or explicit commands.
- [Run in CI](docs/guides/repo-conformance.md) and inspect readiness evidence.
- [Protect policy changes](docs/guides/attestation.md) with explicit approval settings.
- [Read the concepts](docs/concepts.md) when you need more terminology.
- [Browse the published documentation](https://kontourai.github.io/veritas/), [documentation index](docs/README.md), [CLI reference](docs/reference/cli.md), or [schemas](docs/reference/artifacts-and-schemas.md).

## Optional capabilities

Work-area boundaries, policy approval, external-tool evidence, feedback and recommendations support larger repositories. Add them when they solve a concrete problem; they are not prerequisites for understanding the basic loop.

The [Governance Kit](docs/guides/governance-kit.md) distributes setup workflows, skills and hooks through Flow Agents. The standalone CLI works without that kit. Developers embedding evaluation can use `@kontourai/veritas/engine`; see [architecture](docs/architecture/developer-architecture.md).

Veritas uses Surface internally for claims and evidence. Normal users do not need to configure Surface. [Product boundaries](docs/veritas-and-surface.md) explain optional integrations with other Kontour tools.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Veritas is licensed under [Apache-2.0](LICENSE).
