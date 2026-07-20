# Veritas Governance Kit

This repository is both the home of the standalone `@kontourai/veritas` engine and a root-valid
Flow Kit repository. Flow Agents installs the kit from Git; the kit then helps a maintainer set
up and operate the engine in a target repository.

## Install from Git

Pin a release tag, branch, or commit through the Git URL fragment or `--ref`:

```bash
npx @kontourai/flow-agents kit install \
  https://github.com/kontourai/veritas.git#v1.5.1 \
  --dest .

npx @kontourai/flow-agents kit activate \
  --dest . \
  --format json
```

Flow Agents shallow-clones the repository, validates the root `kit.json`, records source and
content-hash provenance, and activates the declared flows, skills, and docs. Git installation
does not execute repository scripts or install the Veritas npm package.

## Set up the engine

Use the activated `setup-governance` skill. It detects the CLI first and requests approval
before installing `@kontourai/veritas`, applying a Repo Standards plan, configuring hooks, or
recording bootstrap authority. The shortest reviewed path is:

```bash
npm install -D @kontourai/veritas
npm exec -- veritas init --explore --output .veritas/init-plans/first-pass.json
# Review and approve the generated plan.
npm exec -- veritas init --apply --plan .veritas/init-plans/first-pass.json
npm exec -- veritas setup repo-hooks
npm exec -- veritas attest bootstrap --actor <authority-id> \
  --approval-ref <human-approval-reference> --non-interactive
npm exec -- veritas readiness --working-tree
```

### Non-npm repositories

Do not add a consumer `package.json` merely to run Veritas. After explicit maintainer approval of
the exact engine release, use the pinned ephemeral invocation for every setup command:

```bash
npm exec --yes --package=@kontourai/veritas@1.5.1 -- veritas --version
npm exec --yes --package=@kontourai/veritas@1.5.1 -- veritas init --explore --output .veritas/init-plans/first-pass.json
# Review and approve the generated plan.
npm exec --yes --package=@kontourai/veritas@1.5.1 -- veritas init --apply --plan .veritas/init-plans/first-pass.json
npm exec --yes --package=@kontourai/veritas@1.5.1 -- veritas readiness --working-tree
```

This invocation uses npm's execution cache without writing the consumer manifest or lockfile.
The exact `1.5.1` version is the approved engine pin in this example; never substitute `latest`,
a range, or a different version without renewed maintainer approval. For a repository without a
package manifest, init configures a Node runtime smoke check so the first readiness run is
runnable. Replace that smoke check with the repository's real evidenceCheck before promoting it.

## Gate canonical readiness

Veritas emits the canonical Hachure trust bundle directly; the kit does not maintain a second
readiness interpretation:

```bash
npm exec -- veritas readiness --check evidence --working-tree \
  --format trust-bundle > readiness.bundle.json

flow init
flow start \
  .kontourai/flow-agents/projections/codex/flows/veritas-governance/veritas-governance.readiness-check.flow.json \
  --run-id readiness
flow attach-evidence readiness --gate gate-check-gate \
  --file readiness.bundle.json --bundle
flow evaluate readiness --gate gate-check-gate --exit-code
```

A failed required standard remains represented in the bundle and causes the Flow gate to block.
Flow consumes the verdict; Veritas alone owns Repo Standards evaluation and readiness semantics.
