---
name: "standards-authoring"
description: "Author or update Veritas Repo Standards through a plan-first, human-reviewed flow using `veritas init --explore` or `--guided`, followed by `--apply` only after approval evidence is attached."
---

# Author Repo Standards

Veritas derives and writes Repo Standards. This skill coordinates the reviewable sequence and
does not reproduce derivation or evaluation logic.

```bash
# Propose without writing the governance files.
npm exec -- veritas init --explore --output .veritas/init-plans/proposal.json

# Or collect explicit owner answers.
npm exec -- veritas init --guided --answers answers.json \
  --output .veritas/init-plans/proposal.json
```

Review the proposed project name, Repo Map, inferred Evidence Checks, instruction-file changes,
reasoning, and unresolved owner questions. Start the activated
`veritas-governance.standards-authoring` Flow Definition and attach a verified
`standards-authoring-approval` claim to its `human-approval-gate`.

Only after that gate passes:

```bash
npm exec -- veritas init --apply --plan .veritas/init-plans/proposal.json
```

The apply command validates the plan's artifact hashes and refuses unsafe replacement by
default. Never use `--force` merely to bypass drift or an unreviewed existing configuration.
