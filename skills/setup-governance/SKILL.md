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
   npm exec -- veritas --help
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

   Record the resolved path and reported version with the setup evidence. If either differs from
   the maintainer-approved pinned engine invocation, stop. This external path does not modify the
   consumer manifest or lockfile; do not add an npm dependency as a fallback.

3. If the external CLI is absent but the maintainer approves the exact Veritas release, acquire
   and invoke that release ephemerally. The approved version below is intentionally exact; do not
   replace it with `latest`, a range, or an unreviewed version:

   ```bash
   npm exec --yes --package=@kontourai/veritas@1.5.2 -- veritas --version
   npm exec --yes --package=@kontourai/veritas@1.5.2 -- veritas init --explore --output .veritas/init-plans/first-pass.json
   ```

   Record the approved package version and the reported CLI version with the setup evidence. This
   is a reproducible, pinned engine invocation: npm uses its ephemeral execution cache and does
   not create or modify the consumer's `package.json` or lockfile. Use the same exact invocation
   for apply, hooks, attestation, and readiness; do not mix it with an unpinned global CLI.

4. If it is absent and the maintainer approves the dependency change, install it:

   ```bash
   npm install -D @kontourai/veritas
   ```

   For repositories that do not use npm and have not approved an external engine, stop and ask
   which package/runtime installation convention to use. Do not invent one.

5. Derive a plan without applying it. Use `"$veritas_engine_path"` or the approved pinned
   `npm exec --yes --package=...` invocation in place of `npm exec -- veritas` when following an
   external engine path:

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

9. After a maintainer reviews the generated standards and map, record bootstrap authority:

   ```bash
   npm exec -- veritas attest bootstrap \
     --actor <authority-id> \
     --approval-ref <human-approval-reference> \
     --non-interactive
   ```

10. Run the first readiness check:

   ```bash
   npm exec -- veritas readiness --working-tree
   ```

Report any unsupported package manager, refused overwrite, missing authority, or failed
readiness result as an explicit setup gap. Do not weaken generated standards to make setup pass.
