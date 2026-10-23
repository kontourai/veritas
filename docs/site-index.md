# Project rules agents can follow and checks you can inspect

Veritas connects your repository's policies to agent guidance and existing verification commands. Define a rule once, see it before an edit, and check its evidence afterward.

```bash
npm install -D @kontourai/veritas
npx --no @kontourai/veritas init --evidence-check "npm test"
npx --no @kontourai/veritas plan src/example.ts
npx --no @kontourai/veritas readiness --working-tree
```

Use a real verification command and review the generated configuration before running checks. Requires Node.js 22 or newer and Git.

## The basic loop

1. **Set up:** connect existing tests or linters and choose one useful policy.
2. **Plan:** show which rules and checks apply before editing. No checks run.
3. **Check readiness:** execute configured checks and explain unmet requirements.

Your team decides whether to merge. A readiness result reports the configured evidence; it does not certify code correctness or replace review.

[Set up Veritas](guides/getting-started.md) · [Try a concrete policy](guides/walkthrough.md)

## Start small

Keep useful advice at `Guide`. Use `Require` when a policy's detector is reliable and you want unmet evidence to fail readiness. A companion test file, a syntax detector and a behavioral test each prove different properties.

The starter setup can fall back to a command that only verifies Node runs. Replace it with a real project check before treating readiness as useful project evidence.

## Add capabilities when you need them

- [Code hygiene](guides/code-hygiene.md): connect policies to linters and tests, including the optional Veritas Oxlint pack.
- [Agent integrations](guides/agent-runtime-integrations.md): deliver guidance through supported hooks or explicit commands.
- [CI integration](guides/repo-conformance.md): enforce checks and retain readiness evidence.
- [Policy approval](guides/attestation.md): protect standards and configure approval-reference requirements.
- [Feedback](guides/recommendations.md): review noisy or missing policies after real usage.

The CLI works independently. The [Governance Kit](guides/governance-kit.md) is an optional way to distribute workflows and skills through Flow Agents. Surface supplies internal evidence primitives; normal users do not need to configure it.

[Browse documentation](README.md) · [CLI reference](reference/cli.md) · [npm](https://www.npmjs.com/package/@kontourai/veritas) · [GitHub](https://github.com/kontourai/veritas)
