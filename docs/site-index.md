<div class="hero">
<h1 class="hero-tagline">Govern AI code changes with evidence, not vibes.</h1>

<p class="hero-subtitle">Veritas turns repo-specific expectations into live feedback for agents and reviewable evidence for humans, on top of Kontour Surface. Every AI-assisted change can show what surface it touched, what proof ran, which rules held, and what Surface can report.</p>

<pre class="install-cmd"><code>npm install -D @kontourai/veritas</code></pre>

<a class="hero-cta" href="guides/getting-started.md">Get Started</a>
</div>

## The Problem

**AI doesn't know what matters in your repo.**
Your codebase has load-bearing files, shared contracts, and surfaces that need different kinds of proof. Veritas gives the repo a [rule surface](concepts.md#rules) so agents know what they are touching and what evidence that area requires.

**Rules live as tribal knowledge.**
Your team's hard invariants, strong preferences, and temporary guardrails exist in someone's head — not in a reviewable, enforceable form.
Veritas makes them explicit as [repo-local rules](concepts.md#rules) with real classification and enforcement levels.

**Boundaries disappear in big AI diffs.**
Agents can touch source, tests, schemas, docs, and governance in one pass. Veritas names those surfaces, assigns owners, and can fail closed when an actor crosses a strict boundary without permission.

**Reviewers scan the whole diff.**
When AI changes dozens of files, a human reconstructs intent from a raw diff with no structured summary of what was proven or what passed.
Veritas generates [agent-readable feedback](concepts.md#feedback) plus a bounded evidence artifact: what changed, what was affected, what proof ran, which policies held, the `surface.input` projection, and the compact Surface-generated `surface.report`.

**No way to know if guidance helped.**
You can add context files and prompt instructions, but there is no feedback loop measuring whether they actually improved outcomes.
Veritas captures [local improvement records](concepts.md#improvement) — acceptance rate, time-to-green, override count, reviewer confidence.

<div class="pillars">

<div class="pillar">
<h3>Repo Map <span class="pillar-term">Adapter</span></h3>
<p class="pillar-what">A typed graph of your codebase that names each surface — source, tests, config, migrations — and specifies what proof that surface requires.</p>
<p class="pillar-why">AI knows what it is touching and what evidence that area demands before it touches it.</p>
</div>

<div class="pillar">
<h3>Rules <span class="pillar-term">Policy Pack</span></h3>
<p class="pillar-what">Staged rules for required artifacts, content patterns, governance blocks, companion diffs, and strict surface ownership, with deny or lint enforcement.</p>
<p class="pillar-why">Supported runtime hooks can block hard-invariant edits before they land, while reviewers still see which rules applied, passed, failed, or need ownership review.</p>
</div>

<div class="pillar">
<h3>Human Gate <span class="pillar-term">Attestation</span></h3>
<p class="pillar-what">Immutable human attestations bind the active adapter, policy pack, and team profile to reviewed content hashes.</p>
<p class="pillar-why">Governance changes become tamper-evident, and veritas runs fail when Zone 1 policy changes have not been freshly attested.</p>
</div>

<div class="pillar">
<h3>Runtime Adapters <span class="pillar-term">Integrations</span></h3>
<p class="pillar-what">Codex and Claude Code get deep runtime hooks and transcript readers through one integration contract; Cursor and Copilot use generic stop-hook wiring today.</p>
<p class="pillar-why">Eval drafts can derive time-to-green, rewrite, and override signals from supported transcripts without making every tool look the same.</p>
</div>

<div class="pillar">
<h3>Evidence <span class="pillar-term">Artifacts</span></h3>
<p class="pillar-what">A bounded JSON record of what changed, which repo surfaces were affected, what proof ran, which policies passed or failed, and the Surface TrustInput and report summary.</p>
<p class="pillar-why">A reviewer inspects a focused summary, while Surface derives portable status, freshness, and fault-line signals from claims, evidence, policies, and events.</p>
</div>

<div class="pillar">
<h3>Feedback <span class="pillar-term">Live Evals</span></h3>
<p class="pillar-what">Structured records of whether guidance actually helped: acceptance rate, time-to-green, override frequency, reviewer confidence.</p>
<p class="pillar-why">You can tell whether the rules are useful, stale, or actively in the way, and turn recurring signals into human-reviewed proposals.</p>
</div>

<div class="pillar">
<h3>Rule Evolution <span class="pillar-term">Proposals</span></h3>
<p class="pillar-what">Eval history can propose policy relaxations, retirements, and missing surface nodes as `.veritas/proposals/*.proposal.json` artifacts.</p>
<p class="pillar-why">Rules evolve from observed outcomes, but policy files only change after explicit human accept/reject review and attestation.</p>
</div>

</div>

## Before and After

<div class="comparison">

<div class="comparison-col comparison-col--before">
<h3>Without Veritas</h3>
<ul>
<li>AI agent edits 47 files with no structured guidance surface</li>
<li>Reviewer scans the full diff looking for violations they have to know to look for</li>
<li>Repo expectations live as tribal memory — undocumented, unenforced, unmeasured</li>
<li>Governance files can be weakened like any other config, with no distinct integrity path</li>
<li>No way to know whether any guidance you gave the agent actually changed its behavior</li>
</ul>
</div>

<div class="comparison-col comparison-col--after">
<h3>With Veritas</h3>
<ul>
<li>Repo ships its own map and rules; the agent knows what surfaces it is entering</li>
<li>Reviewer inspects a bounded evidence artifact — what changed, what proof ran, what passed</li>
<li>Policy results and governance surfaces are explicit in source control, not reconstructed after the fact</li>
<li>Strict surface ownership catches cross-team edits before they become review surprises</li>
<li>Live eval record says whether the guidance helped, with numbers</li>
</ul>
</div>

</div>

## How It Works

Three commands cover the core workflow:

```bash
# Bootstrap the adapter, policy pack, and team profile for your repo
npx veritas init

# Emit an evidence artifact for the current working tree
npx veritas run --check shadow --working-tree

# Run proof, emit lint-style feedback, and draft an eval record in one pass
npx veritas run --working-tree
```

`init` writes the starter files to `.veritas/` and injects the governance block into AI instruction files. `report` produces the evidence artifact your CI or PR workflow can post. `veritas run` adds proof execution, lint-style feedback, and eval drafting on top of that, with no enforcement until you are ready.

## Start Safe

Veritas has a three-phase rollout. You pick the phase. You do not have to flip a switch you are not ready for.

**Shadow** — rules run but nothing is enforced. Evidence and eval drafts are written locally. This is the observation phase: you learn what is noisy, what is missing, and what matters before you commit to any enforcement shape.

**Assist** — rules start guiding. Operators can waive individual checks. Evidence is posted to PRs. The team gets used to the artifact before it gates anything.

**Enforce** — rules that have proven stable block violations in CI. The policy pack says which rules are at which phase, so the enforcement surface is explicit and reviewable.

The `.veritas/` directory in your repo is the audit trail for all three phases.

## Proven on Itself

Veritas runs on its own repository using the same workflow a consumer repo would use. CI runs `veritas run` on check-ins, posts evidence artifacts to PRs, and tracks health against the live eval records. The `.veritas/` directory in this repo is not a demo configuration — it is the actual development workflow.

If self-hosting feels awkward, that is a signal to fix the product surface, not to carve out special behavior for the framework repo.

## Learn More

- [Getting Started](guides/getting-started.md) — install, init, and first evidence artifact
- [Fallow Integration](guides/fallow-integration.md) — optional JS/TS codebase-intelligence evidence as an advisory proof lane
- [Concepts Overview](concepts.md) — adapter, policy pack, evidence, and eval in depth
- [CLI Reference](reference/cli.md) — all commands and options
- [Surface-Veritas Boundary](architecture/surface-veritas-boundary.md) — how Veritas builds on Surface without reversing the dependency direction
- [npm package](https://www.npmjs.com/package/@kontourai/veritas) — `@kontourai/veritas`
- [GitHub](https://github.com/kontourai/veritas) — source, issues, and contributing
