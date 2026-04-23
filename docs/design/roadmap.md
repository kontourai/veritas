# Roadmap

Open design questions and planned work. Each item names the gap, why it matters, what the options are, and what comes next.

---

## Longitudinal eval tracking

### The gap

The current CI model answers two questions well:

- **Is the repo healthy right now?** — the "Veritas Health" GitHub issue is open when red, closed when green, and its comment history provides a human-readable timeline.
- **What happened in this PR?** — the sticky PR comment posts the check-in summary for every run.

It does not answer:

- **Is the framework getting more useful over time?** — there is no durable, machine-readable record of eval outcomes across runs that a team could query, trend, or act on.

Generated artifacts (`evidence/`, `eval-drafts/`, `evals/`, `checkins/`) are gitignored by design and uploaded to GitHub Actions as workflow artifacts. Those artifacts expire after 90 days. After expiry, the only persistent record is the GitHub issue comment history, which is human-readable but not machine-queryable.

This means the "measurable improvement over time" value claim is not fully backed at the product level yet. Teams can see whether they are healthy now but cannot easily answer whether review time is shrinking, override rates are falling, or which rules are reliably earning promotion.

### Why this matters

The live eval model is designed around a feedback loop: shadow → assist → gate. That loop only works if the accumulated eval data is inspectable. Without longitudinal persistence, teams are flying on anecdote after the 90-day artifact window closes.

### Options considered

**Commit a rolling `health.json` to the repo.**
CI would need `contents: write` permission and would generate a commit on every run. This pollutes git history, creates merge conflicts between concurrent runs, and violates the principle that generated outputs do not live in the repo. Locally the file would always be stale. Rejected.

**Use GitHub Actions cache for run-to-run comparison.**
Cache keyed per branch can store the previous run's eval summary. CI downloads it, compares, and reports the delta in the PR comment. The cache expires after 7 days of inactivity, which resets the baseline during quiet periods. Viable for short-horizon PR comparison but not for longitudinal trend.

**Extend the GitHub issue body with a machine-readable block.**
The health issue body could carry a JSON block alongside the markdown summary. CI reads the previous block, calculates the delta, and writes back the updated body. The comment history becomes the longitudinal log. No external infrastructure, no auto-commits, and the issue already exists. Viable but awkward — the issue body becomes a hidden state store, and the history is only recoverable by scraping issue comments.

**Hosted eval sink (opt-in).**
A lightweight endpoint that accepts eval payloads and returns trend data on demand. Teams opt in during `veritas init`. The cleanest UX and the only approach that makes the longitudinal claim genuinely true at scale. Requires infrastructure and a trust model for how team data is handled.

**Configurable external sink.**
Teams configure their own destination (S3, Postgres, a webhook). The framework emits to it after each eval. No Veritas-hosted infrastructure required. Adds setup friction but keeps data ownership with the team.

### What comes next

The hosted sink is the right long-term answer. It is also infrastructure that does not exist yet.

In the near term:

1. Be honest in the docs that longitudinal trend data is a planned capability, not a current one. The "measurable over time" claim should be scoped to what is actually true: the GitHub issue and PR comment surface current health; full trend data requires a sink.
2. Design the eval payload shape that a sink would accept. That shape should be stable before any sink infrastructure is built, because it becomes a contract.
3. When the sink is ready, `veritas init` should offer to configure it as an optional step, not require it.

---

## Governance surface integrity

### The gap

The `.veritas/` directory is the trust infrastructure of the repo. The adapter defines what surfaces exist and their risk profiles. The policy pack defines what rules apply and how hard. An AI agent that can freely modify these files can quietly weaken the governance it is supposed to operate under — downgrading a `block` rule to `recommend`, removing a node from scrutiny, or adding a waiver for its own output.

The current framework does not prevent this. The `governance-surface` node kind exists in the adapter and signals that `.veritas/` is special, but there is no enforcement layer that makes governance modifications visible as a distinct class of change or gates them differently from ordinary code changes.

The agent-activation design doc is honest about this: the framework cannot force compliance from an agent that ignores repo context entirely. What it can do is make governance changes tamper-evident and human-gated.

### The three-zone model

Not all of `.veritas/` warrants the same treatment.

**Zone 1 — Constitutional core.** `repo.adapter.json` surface type definitions, `hard-invariant` rules at `block` stage, team profile thresholds. These encode decisions that required organizational trust to make. Any modification or deletion here should require human authorization — not because AI cannot understand them, but because loosening them should require accountability.

**Zone 2 — Living policy.** New surface nodes for new feature areas, `advisory-pattern` and `promotable-policy` rules at `recommend` or `warn` stage, rule promotions backed by eval data. These extend governance without weakening it. An AI agent should be able to propose and, in a repo with strong foundations, merge Zone 2 additions without blocking on human approval for every change.

**Zone 3 — Evidence layer.** `evidence/`, `eval-drafts/`, `evals/`, `checkins/`. Always generated, never human-authored. No gate applies.

### The ratchet principle

Governance should only tighten automatically, never loosen. An AI agent:

- May add a new `advisory-pattern` rule for a new surface.
- May propose promoting a `recommend` rule to `warn` when eval data supports it.
- May add a new node to the adapter for a new feature directory.
- Must not modify the classification or stage of an existing `hard-invariant` rule.
- Must not delete any rule that has reached `block` stage.
- Must not demote an existing rule to a lower stage.

The ratchet is the property that makes it safe to give AI agents more autonomy over Zone 2. The constitutional core stays stable because the framework structurally prevents regression, not because humans review every change.

### On CODEOWNERS

CODEOWNERS is one implementation of Zone 1 protection — not the mechanism itself. It is GitHub-specific, requires branch protection to be enforced, does not distinguish additive from destructive changes, and can be bypassed by admins. It is worth generating as a suggested next step from `veritas init` for teams that want it, but it should not be the primary or only protection.

The right primary mechanism is a CI governance integrity check: diff the governance files, classify the change as additive, destructive, or demotion, surface that classification in the evidence artifact and PR summary. This is platform-agnostic, distinguishes Zone 1 from Zone 2 changes, and fits naturally within the existing evidence and policy evaluation model.

### What comes next

1. **Ambient instruction.** Add a `GOVERNANCE.md` to `.veritas/` generated by `veritas init`. Plain prose that ambient AI agents read as repo context: do not modify the governance files. Add a `governance-locked: true` flag to Zone 1 adapter nodes so the intent is machine-readable, not only human-readable.
2. **CI governance integrity check.** A CI step that diffs governance files, classifies the change type, and includes the classification in the check-in summary. This is the platform-agnostic enforcement layer that makes Zone 1 changes visible as a distinct class.
3. **CODEOWNERS suggestion.** `veritas init` outputs a CODEOWNERS block as a "next step" — not auto-written to `.github/CODEOWNERS`, but printed with the exact content to copy for teams that want the GitHub-level gate.
4. **Zone 2 auto-merge criteria.** Define what makes a Zone 2 addition safe to merge without explicit human review: additive only, advisory tier only, evidence passes, no existing rule touched. This is the property that makes the ratchet real rather than only described.
