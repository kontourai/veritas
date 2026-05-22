<div class="hero">
<h1 class="hero-tagline">Earn merge autonomy for AI-authored code.</h1>

<p class="hero-subtitle">Veritas turns repo standards into evidence-backed readiness reports, change guidance, and protected governance so teams can move faster without making human review the bottleneck for every routine change.</p>

<pre class="install-cmd"><code>npm install -D @kontourai/veritas</code></pre>

<a class="hero-cta" href="guides/getting-started.md">Get Started</a>
</div>

## The Problem

**AI can produce code faster than teams can review it.**
Veritas shifts routine review from re-reading every diff to inspecting whether a change satisfied the repo standards with fresh, trusted evidence.

**Repo standards live as tribal knowledge.**
Tests, ownership expectations, protected files, release rules, security checks, and architecture boundaries are often known by humans but invisible to agents. Veritas makes those standards executable.

**Shared-code boundaries are easy to cross accidentally.**
Agents and developers need to know when a change touches shared contracts, protected areas, or work that other people may depend on. Veritas maps those boundaries and adds the right requirements when a crossing matters.

**Evidence can go stale even when it exists.**
A passing check is not enough if it ran on a different commit, before the standards changed, or under an authority that is no longer trusted. Veritas tracks evidence freshness and recheck needs.

**Standards need to improve from reality.**
Useful requirements should become stronger. Noisy requirements should be relaxed or clarified. Missing coverage should become visible. Veritas turns observed outcomes into standards feedback and recommendations.

<div class="pillars">

<div class="pillar">
<h3>Repo Standards</h3>
<p class="pillar-what">The maintained definition of what good looks like for the repository: requirements, evidenceChecks, authorities, boundaries, exceptions, enforcement levels, and merge thresholds.</p>
<p class="pillar-why">Humans define the standard once, then Veritas applies it consistently to changes.</p>
</div>

<div class="pillar">
<h3>Repo Map</h3>
<p class="pillar-what">A model of work areas, change boundaries, protected areas, ownership context, and dependency relationships.</p>
<p class="pillar-why">Veritas can explain why a change needs specific evidence or authority instead of running every check blindly.</p>
</div>

<div class="pillar">
<h3>Readiness Report</h3>
<p class="pillar-what">A human- and agent-facing report with merge readiness, readiness coverage, evidence freshness, boundary crossings, exceptions, recheck options, and change guidance.</p>
<p class="pillar-why">Reviewers inspect a focused trust state instead of reconstructing repo expectations from a raw diff.</p>
</div>

<div class="pillar">
<h3>Change Guidance</h3>
<p class="pillar-what">Just-in-time instructions when a requirement, work area, boundary, or evidence result matters to the current change.</p>
<p class="pillar-why">Developers and agents get the repo-specific correction they need before declaring work done.</p>
</div>

<div class="pillar">
<h3>Protected Standards</h3>
<p class="pillar-what">The parts of the standards and map that define what good looks like, where boundaries are, or who can verify requirements.</p>
<p class="pillar-why">The system does not let an agent quietly weaken the rules that judge its own work.</p>
</div>

<div class="pillar">
<h3>Standards Feedback</h3>
<p class="pillar-what">Observed evidence about which requirements helped, which were noisy, where coverage was missing, and where rechecks or exceptions happened.</p>
<p class="pillar-why">Teams spend more time improving the standards and less time catching the same routine issues by hand.</p>
</div>

</div>

## Before and After

<div class="comparison">

<div class="comparison-col comparison-col--before">
<h3>Without Veritas</h3>
<ul>
<li>AI agent edits dozens of files with no executable repo standards</li>
<li>Reviewer scans the full diff looking for violations they must already know</li>
<li>Shared contracts and protected areas are discovered too late</li>
<li>Passing checks may not apply to the current commit or standards version</li>
<li>Standards stay static because nobody can tell which guidance helped</li>
</ul>
</div>

<div class="comparison-col comparison-col--after">
<h3>With Veritas</h3>
<ul>
<li>Repo standards define requirements, evidenceChecks, authorities, and thresholds</li>
<li>Readiness report shows what passed, failed, went stale, or needs recheck</li>
<li>Boundary crossings add evidence or authority requirements before merge</li>
<li>Protected standards cannot be weakened without authority-backed attestation</li>
<li>Standards feedback turns observed outcomes into recommendations</li>
</ul>
</div>

</div>

## How It Works

Three commands cover the current workflow:

```bash
# Bootstrap the repo standards and repo map
npx veritas init

# Evaluate the current working tree
npx veritas readiness --working-tree

# Inspect why a file or requirement matters
npx veritas explain --file src/api/users.ts
```

`veritas readiness` is the first-class command for readiness reports.

## Start Safe

Veritas supports a gradual enforcement ladder:

**Observe** — record evidence and outcomes without guiding or blocking work.

**Guide** — provide just-in-time correction or review feedback.

**Require** — require fresh evidence or an authority-backed exception before merge readiness or repo conformance is complete.

You do not have to gate every change on day one. The goal is earned autonomy, not instant bureaucracy.

## Built With Surface

Veritas is built with Kontour Surface. Surface powers portable transparency for claims, evidence, freshness, conflicts, and gaps, while Veritas owns the repo-native product experience.

Normal Veritas users should not need to configure Surface directly.

## Learn More

- [Getting Started](guides/getting-started.md) — install, init, and first readiness check
- [Concepts Overview](concepts.md) — Repo Standards, Merge Readiness, and Readiness Reports
- [Glossary](reference/glossary.md) — canonical product vocabulary
- [CLI Reference](reference/cli.md) — exact current commands and flags
- [Surface-Veritas Boundary](architecture/surface-veritas-boundary.md) — how Veritas is built with Surface
- [npm package](https://www.npmjs.com/package/@kontourai/veritas) — `@kontourai/veritas`
- [GitHub](https://github.com/kontourai/veritas) — source, issues, and contributing
