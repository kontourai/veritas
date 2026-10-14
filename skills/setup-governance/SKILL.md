---
name: "setup-governance"
description: "Adopt Veritas governance in a repository after installing this kit: detect or install the @kontourai/veritas CLI with explicit approval, derive a reviewable Repo Standards plan, apply only an approved plan, configure repo hooks, record the bootstrap attestation, and run the first readiness check."
---

# Set Up Veritas Governance

Use this skill after installing and activating the Veritas Governance Kit. The kit supplies
workflow and agent guidance; `@kontourai/veritas` remains the deterministic engine and CLI.

## Safety contract

- Detect first. Do not install a package or write governance files merely because the kit was
  activated.
- Ask before running a package-manager install or applying a generated plan.
- Never silently overwrite existing `.veritas/` files, hooks, or AI instruction files.
- Treat `.veritas/repo-map.json`, `.veritas/repo-standards/`, and `.veritas/authority/` as
  Protected Standards after bootstrap.

## Sequence

1. Check whether the engine is already a direct development dependency:

   ```bash
   npm ls @kontourai/veritas --depth=0
   npm exec -- veritas --version
   ```

2. If npm is not the repository's toolchain, or the maintainer explicitly approves an external
   engine instead of a consumer dependency, use the maintainer-approved external engine path.
   The maintainer must approve the exact, pinned engine invocation (including version or immutable
   distribution reference) before it runs. Detect the candidate, verify the approved identity, and
   use that exact path for every later command:

   ```bash
   veritas_engine_path="$(command -v veritas)"
   "$veritas_engine_path" --version
   ```

   Record the resolved path, the reported version, and the package-manager or distribution
   evidence that binds that path to the maintainer-approved immutable release. If the resolved
   identity differs from the approved invocation, stop. This
   external path does not modify the consumer manifest or lockfile; do not add an npm dependency
   as a fallback.

3. If the external CLI is absent and no dependency is approved, but the maintainer approves a
   one-shot fetch from the registry, resolve the current release once and use that version for
   the whole session. Do not write a literal version into a command you copy elsewhere: a version
   copied into a README or instruction file goes stale, and an old release cannot read the
   attestations a newer one writes. Resolving once also keeps a new release from landing between
   two setup commands.

   ```bash
   v="$(npm view @kontourai/veritas@latest version)"
   echo "$v"   # the maintainer approves this version before anything runs
   npm exec --yes --package="@kontourai/veritas@${v}" -- veritas --version
   npm exec --yes --package="@kontourai/veritas@${v}" -- veritas init --explore --output .veritas/init-plans/first-pass.json
   ```

   Record the version with the setup evidence; `--version` must print the same value. npm uses its
   ephemeral execution cache and does not create or modify the consumer's `package.json` or
   lockfile. Use the same `npm exec --yes --package="@kontourai/veritas@${v}" -- veritas` prefix
   for apply, hooks, attestation, and readiness in the same shell session; if `v` is lost or
   `--version` prints something else, stop and resolve again from the plan step. Do not mix it
   with an unrelated global CLI. Never write this prefix, or any literal version, into a README,
   `AGENTS.md`, or other instruction file: the generated Veritas files state the unversioned
   command, and CI is where a repository pins the engine it trusts.

4. If it is absent and the maintainer approves the dependency change, install it:

   ```bash
   npm install -D @kontourai/veritas
   ```

   For repositories that do not use npm and have not approved an external engine, stop and ask
   which package/runtime installation convention to use. Do not invent one.

5. Derive a plan without applying it. Use `"$veritas_engine_path"` or the step 3
   `npm exec --yes --package="@kontourai/veritas@${v}" -- veritas` prefix in place of
   `npm exec -- veritas` when following an external engine path:

   ```bash
   npm exec -- veritas init --explore --output .veritas/init-plans/first-pass.json
   ```

   Use `init --guided --answers <answers.json> --output <plan>` when owner answers are needed.

6. Review the plan and satisfy the `veritas-governance.standards-authoring` flow's
   `human-approval-gate`. A schema-valid approval claim records the decision; it does not by
   itself authenticate who attached the claim.

7. Apply only the reviewed plan:

   ```bash
   npm exec -- veritas init --apply --plan .veritas/init-plans/first-pass.json
   ```

8. Configure or repair tracked repo hooks with explicit approval:

   ```bash
   npm exec -- veritas setup repo-hooks
   ```

9. For a Codex host, use Flow Agents's Kit provisioner to install the reviewed
   Veritas hook declaration. Inspect the dry run and the exact target first:

   ```bash
   flow-agents kit provision veritas-governance --target . --dry-run
   flow-agents kit provision veritas-governance --target .
   npm exec -- veritas integrations codex status --target-hooks-file .codex/hooks.json
   ```

   Ordinary Kit provisions are create-only by default. This declared host hook
   uses Flow Agents's `hooks-json` merge through Conduit: existing unrelated
   handlers remain, an identical handler is not duplicated, and a conflicting
   command definition refuses before writing. Never force-replace an existing
   `.codex/hooks.json` to bypass that refusal. Codex requires its own trust review of
   the new or changed project hook in `/hooks`; a copied file alone is not proof
   the runtime executes it. For Claude Code, install and inspect the supported
   Veritas PreToolUse integration through `veritas integrations claude-code`.

10. After a maintainer reviews the generated standards and map, record bootstrap authority:

   ```bash
   npm exec -- veritas attest bootstrap \
     --actor <authority-id> \
     --approval-ref <human-approval-reference> \
     --non-interactive
   ```

11. Run the first readiness check:

   ```bash
   npm exec -- veritas readiness --working-tree
   ```

Report any unsupported package manager, refused overwrite, missing authority, or failed
readiness result as an explicit setup gap. Do not weaken generated standards to make setup pass.
