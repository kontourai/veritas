# Surface Projection

Surface Projection is the Veritas subcontext for translating Veritas-owned readiness and governance evidence into portable Surface trust state.

## Language

**Surface Projection**:
The Built with Surface representation of Veritas readiness state. It preserves Veritas meaning while expressing claims, evidence, policies, events, freshness, authority, and gaps in a portable trust format.
_Avoid_: Surface as the Veritas user interface, generic trust dump

**Trust Bundle**:
The portable Surface bundle emitted by Veritas for interoperability. In Veritas product language, it is generated evidence behind a Readiness Report, not the primary user-facing result.
_Avoid_: Readiness Report as a synonym, Surface report fields inside the bundle

**Readiness Verdict Claim**:
The Surface claim that represents Veritas Merge Readiness for a repository change. It is derived from blocking requirement claims and keeps advisory results visible without letting them cap the verdict.
_Avoid_: Trust score, summary-only verdict

**Projection Boundary**:
The one-way relationship where Veritas owns repo governance meaning and Surface owns portable transparency shape. Veritas may project into Surface; Surface does not own Veritas readiness semantics.
_Avoid_: Shared ownership, Surface module as product language

**Projection Validation**:
The check that emitted Surface state satisfies the Surface public API and the normative trust schema before Veritas accepts the projection. Projection validation protects the interoperability contract, not the correctness of the underlying code change.
_Avoid_: Proof of code correctness, optional formatting check

**Example Dialogue**:
Developer: "Should we document TrustBundle in the getting-started guide?"
Domain Expert: "Not as the primary Veritas term. Say Readiness Report first, then mention the Surface Projection where interoperability matters."

Agent: "A Guide-level requirement failed."
Domain Expert: "Keep its Surface claim visible, but the Readiness Verdict Claim should derive only from blocking Requirements."
