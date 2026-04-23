<div class="hero">
<h1 class="hero-tagline">The repo ships the rules. Veritas proves they held.</h1>

<p class="hero-subtitle">AI agents edit code faster than reviewers can track intent. Veritas gives your repo its own map, policy, and evidence layer — so AI-assisted changes produce a bounded artifact a human can actually trust, not just a diff to scroll through.</p>

<pre class="install-cmd"><code>npm install -D @kontourai/veritas</code></pre>

<a class="hero-cta" href="guides/getting-started.md">Get Started</a>
</div>

## The Problem

**AI doesn't know what matters in your repo.**
Your codebase has load-bearing files, shared contracts, and surfaces that need different kinds of proof. AI agents treat them all the same.
Veritas gives the repo a [typed map](concepts.md#repo-map-the-adapter) so agents know what they're touching and what evidence that area requires.

**Rules live as tribal knowledge.**
Your team's hard invariants, strong preferences, and temporary guardrails exist in someone's head — not in a reviewable, enforceable form.
Veritas makes them explicit in a [staged policy pack](concepts.md#rules-the-policy-pack) with real classification and enforcement levels.

**Reviewers scan the whole diff.**
When AI changes dozens of files, a human reconstructs intent from a raw diff with no structured summary of what was proven or what passed.
Veritas generates a [bounded evidence artifact](concepts.md#evidence-the-artifact) — what changed, what was affected, what proof ran, and which policies held.

**No way to know if guidance helped.**
You can add context files and prompt instructions, but there is no feedback loop measuring whether they actually improved outcomes.
Veritas captures [live eval records](concepts.md#feedback-live-evals) — acceptance rate, time-to-green, override count, reviewer confidence.

<div class="pillars">

<div class="pillar">
<h3>Repo Map <span class="pillar-term">Adapter</span></h3>
<p class="pillar-what">A typed graph of your codebase that names each surface — source, tests, config, migrations — and specifies what proof that surface requires.</p>
<p class="pillar-why">AI knows what it is touching and what evidence that area demands before it touches it.</p>
</div>

<div class="pillar">
<h3>Rules <span class="pillar-term">Policy Pack</span></h3>
<p class="pillar-what">Staged rules classified as must-hold invariants, strong preferences, or temporary safety rails — not a flat checklist that ages badly.</p>
<p class="pillar-why">Reviewers see which rules applied, which passed, and which were waived — in writing, not memory.</p>
</div>

<div class="pillar">
<h3>Evidence <span class="pillar-term">Artifacts</span></h3>
<p class="pillar-what">A bounded JSON record of what changed, which repo surfaces were affected, what proof ran, and which policies passed or failed.</p>
<p class="pillar-why">A reviewer inspects a focused summary instead of reconstructing intent from a 500-line diff.</p>
</div>

<div class="pillar">
<h3>Feedback <span class="pillar-term">Live Evals</span></h3>
<p class="pillar-what">Structured records of whether guidance actually helped: acceptance rate, time-to-green, override frequency, reviewer confidence.</p>
<p class="pillar-why">You can tell whether the rules are useful, stale, or actively in the way — before the next sprint, not at the next retrospective.</p>
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
<li>No way to know whether any guidance you gave the agent actually changed its behavior</li>
</ul>
</div>

<div class="comparison-col comparison-col--after">
<h3>With Veritas</h3>
<ul>
<li>Repo ships its own map and rules; the agent knows what surfaces it is entering</li>
<li>Reviewer inspects a bounded evidence artifact — what changed, what proof ran, what passed</li>
<li>Policy results are explicit and tracked in source control, not reconstructed after the fact</li>
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
npx veritas report --working-tree

# Run proof, emit evidence, and draft an eval record in one pass
npx veritas shadow run --working-tree
```

`init` writes the starter files to `.veritas/` — tracked in source control, owned by your team. `report` produces the evidence artifact your CI or PR workflow can post. `shadow run` adds proof execution and eval drafting on top of that, with no enforcement until you are ready.

## Start Safe

Veritas has a three-phase rollout. You pick the phase. You do not have to flip a switch you are not ready for.

**Shadow** — rules run but nothing is enforced. Evidence and eval drafts are written locally. This is the observation phase: you learn what is noisy, what is missing, and what matters before you commit to any enforcement shape.

**Assist** — rules start guiding. Operators can waive individual checks. Evidence is posted to PRs. The team gets used to the artifact before it gates anything.

**Enforce** — rules that have proven stable block violations in CI. The policy pack says which rules are at which phase, so the enforcement surface is explicit and reviewable.

The `.veritas/` directory in your repo is the audit trail for all three phases.

## Proven on Itself

Veritas runs on its own repository using the same workflow a consumer repo would use. CI runs `shadow run` on check-ins, posts evidence artifacts to PRs, and tracks health against the live eval records. The `.veritas/` directory in this repo is not a demo configuration — it is the actual development workflow.

If self-hosting feels awkward, that is a signal to fix the product surface, not to carve out special behavior for the framework repo.

## Learn More

- [Getting Started](guides/getting-started.md) — install, init, and first evidence artifact
- [Concepts Overview](concepts.md) — adapter, policy pack, evidence, and eval in depth
- [CLI Reference](reference/cli.md) — all commands and options
- [npm package](https://www.npmjs.com/package/@kontourai/veritas) — `@kontourai/veritas`
- [GitHub](https://github.com/kontourai/veritas) — source, issues, and contributing
