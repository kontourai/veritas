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

2. If it is absent and the maintainer approves the dependency change, install it:

   ```bash
   npm install -D @kontourai/veritas
   ```

   For repositories that do not use npm, stop and ask which package/runtime installation
   convention to use. Do not invent one.

3. Derive a plan without applying it:

   ```bash
   npm exec -- veritas init --explore --output .veritas/init-plans/first-pass.json
   ```

   Use `init --guided --answers <answers.json> --output <plan>` when owner answers are needed.

4. Review the plan and satisfy the `veritas-governance.standards-authoring` flow's
   `human-approval-gate`. A schema-valid approval claim records the decision; it does not by
   itself authenticate who attached the claim.

5. Apply only the reviewed plan:

   ```bash
   npm exec -- veritas init --apply --plan .veritas/init-plans/first-pass.json
   ```

6. Configure or repair tracked repo hooks with explicit approval:

   ```bash
   npm exec -- veritas setup repo-hooks
   ```

7. After a maintainer reviews the generated standards and map, record bootstrap authority:

   ```bash
   npm exec -- veritas attest bootstrap \
     --actor <authority-id> \
     --approval-ref <human-approval-reference> \
     --non-interactive
   ```

8. Run the first readiness check:

   ```bash
   npm exec -- veritas readiness --working-tree
   ```

Report any unsupported package manager, refused overwrite, missing authority, or failed
readiness result as an explicit setup gap. Do not weaken generated standards to make setup pass.
