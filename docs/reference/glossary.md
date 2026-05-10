# Glossary

Veritas adds repo-workflow vocabulary on top of Surface's trust vocabulary. They are not synonyms — Veritas terms describe *how a check is run in a repo*; Surface terms describe *what is true and how we know*.

## Veritas terms (repo workflow)

| Term | Meaning |
|------|---------|
| **rule** | A repo-local lint check. One of seven `kind`s: `required-artifacts`, `governance-block`, `diff-required`, `forbidden-pattern`, `required-pattern`, `header-required`, `cross-surface-write`. |
| **policy pack** | A bundle of rules at `.veritas/policy-packs/*.policy-pack.json`. |
| **adapter** | The repo's surface map at `.veritas/repo.adapter.json`. Defines surfaces, owners, boundaries, and activation targets. |
| **surface** | A named region of the repo (e.g. `product.code`, `tests`, `governance.guidance`). Has owners and a `strict` or `advisory` boundary. |
| **proof lane** | The shell command Veritas runs to gather proof (e.g. `npm run verify`). Configured per repo. |
| **proof family** | A grouping of proof lanes by lifecycle status (`required`, `candidate`, `advisory`, `move-to-test`, `retiring`, `stale`, `triggerless`). |
| **verification budget** | The classification of proof families relative to current repo state. Output of `veritas run --check budget`. |
| **shadow run** | An evaluation pass that doesn't block. Output of `veritas run`. The agent-facing path. |
| **attestation** | A human approval record for the current Zone 1 governance hashes. Bootstrap attestations start the chain; policy-change and proposal-acceptance attestations renew it. |
| **proposal** | A reviewable governance change drafted from eval history, such as relaxing, retiring, or adding policy/surface coverage. |
| **enforcement** | The runtime behavior for a rule. `deny` can block supported PreToolUse edits; `lint` reports through feedback without blocking the edit boundary. |
| **override** | A human-recorded exception for a deny rule, including actor, reason, and timestamp. Overrides are evidence, not permanent policy changes. |
| **priorAttestationId** | The attestation-chain pointer from a newer attestation to the human approval it supersedes. |
| **Zone 1** | Human-owned governance: adapter, policy packs, and team profile. Drift requires attestation. |
| **Zone 2** | Additive governance growth that agents may propose, such as new surface nodes or advisory rules. |
| **Zone 3** | Generated Veritas output such as evidence, eval drafts, check-ins, and reports. |
| **evidence artifact** | The JSON record at `.veritas/evidence/<run-id>.json` capturing what was checked, what passed, what failed, and the embedded `surface.input`. |
| **eval draft** | Per-run observation about acceptance, time-to-green, overrides — under `.veritas/eval-drafts/<run-id>.json`. |
| **governance block** | The marker-bounded paragraph Veritas injects into AI instruction files (`AGENTS.md`, `CLAUDE.md`, etc.). |

## Surface terms (trust)

| Term | Meaning |
|------|---------|
| **claim** | A statement about a subject (e.g. "the proof lane `npm run verify` is selected"). |
| **evidence** | The traceable record supporting a claim. |
| **policy** | A `VerificationPolicy` — what makes a claim valid for how long. |
| **event** | A `VerificationEvent` — `verify`, `dispute`, `supersede`, `reject`. |
| **TrustInput** | The portable shape: `{ claims, evidence, policies, events, source }`. |
| **TrustReport** | What Surface generates from `TrustInput`: summaries, derived statuses, fault lines, proof requirements, freshness. |
| **fault line** | A discoverable conflict or weakness across claims (contradiction, supersede chain, missing evidence). |
| **derivation ceiling** | The strongest status a claim can reach given its evidence — e.g. an unverified claim cannot be `verified` regardless of policy. |

## How they map

Veritas terms project into Surface terms when an evidence artifact embeds `surface.input`:

| Veritas concept | Surface projection |
|------------------|--------------------|
| Selected proof lane (`npm run verify`) | Claim about subject `repo-proof-lane`, surface `veritas.proof-lanes` |
| Policy result (one rule's pass/fail) | Claim about subject `repo-policy`, surface `veritas.policy-results` |
| Affected surface (which repo region was touched) | Claim about subject `repo-surface`, surface `veritas.surface` |
| Proof family classification | Claim about subject `proof-family`, surface `veritas.proof-family` |
| Verification budget | Claim about subject `verification-budget`, surface `veritas.verification-budget` |
| External tool result (lint, test, audit) | Claim about subject `external-tool-result`, surface `veritas.external-tool-results` |

The full mapping rule lives in [Surface-Veritas Boundary](../architecture/surface-veritas-boundary.md). Veritas owns the projection; Surface owns the schema and the report shape.
