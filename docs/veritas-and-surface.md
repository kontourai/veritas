# Veritas and Surface

Veritas is a repo-local lint tool for AI-assisted code changes. **Surface** is the foundation it sits on — a generic substrate for representing claims, evidence, freshness, and trust status.

You almost never have to choose between them. The right question is "which one are you reaching for *first*?"

## You came here because you want repo lint for AI agents

Use Veritas. The Quickstart in the [README](../README.md) is the entry point. You will not need to think about Surface to get value from Veritas.

Surface is doing real work underneath — every Veritas evidence artifact projects into a `surface.input` block that Surface can turn into a portable trust report — but that is a downstream capability you opt into when you need it (e.g. piping evidence into a dashboard or another consumer). For the handoff, see [`examples/surface-handoff.mjs`](../examples/surface-handoff.mjs).

## You're building a different product that needs to show provenance

Use [Surface](https://github.com/kontourai/surface) directly. Veritas is one consumer of Surface, not the only one. Anything that needs to answer "is this information verified, fresh, and uncontested?" can sit on top of Surface — code-change governance (Veritas), public-data records, fact resolution, dependency audits, and any other domain where you need to make claims and back them with evidence.

You do not need Veritas to use Surface.

## How they relate

Veritas and Surface enforce a strict boundary:

- **Surface** owns: the schema for `claims`, `evidence`, `policies`, `events`; the derivation of trust status; the shape of a `TrustReport`. It does not know what a "repo" or an "AI agent" is.
- **Veritas** owns: rules, policy packs, proof lanes, shadow runs, governance blocks, eval drafts. It knows everything about repos and agents. At the boundary, it emits a `surface.input` block — and never anything else from Surface's report-only surface.

The full rule lives in [Surface-Veritas Boundary](architecture/surface-veritas-boundary.md). The pattern (separate workflow vocabulary, project to a common trust shape) is the same pattern any Surface consumer should follow.
