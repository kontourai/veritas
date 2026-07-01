# Merge Readiness

Merge Readiness is the Veritas subcontext for deciding whether a specific repository change has enough current evidence to merge under the Repo Standards.

## Language

**Readiness Run**:
A single evaluation of a change against the applicable Repo Standards, Repo Map, evidence, freshness, authority, and exceptions. A Readiness Run produces a Readiness Report and may also create Standards Feedback.
_Avoid_: Check-in, eval run, confidence pass

**Readiness Report**:
The human- and agent-facing result of a Readiness Run. It explains Merge Readiness, Readiness Coverage, Boundary Crossings, missing or failing evidence, exceptions, and next recheck options.
_Avoid_: Raw evidence artifact, trust report as the Veritas term

**Readiness Coverage**:
The current evidence state for the requirements that apply to the change. Readiness Coverage is about satisfied, missing, stale, failing, advisory, recheckable, or accepted requirements.
_Avoid_: Test coverage, verification budget

**Evidence Check Plan**:
The selected set of Evidence Checks that apply to the change before those checks are run or inspected. The plan comes from changed files, Work Areas, Evidence Check routes, and explicit user selection.
_Avoid_: Script list, CI plan

**Readiness Gap**:
An unmet, stale, failing, or unresolved requirement that prevents or weakens Merge Readiness. A gap is closed by fresh evidence, a recheck, changed scope, or an authority-backed exception.
_Avoid_: Failure as the only term, generic issue

**Recheck**:
The action that verifies evidence, freshness, authority, or integrity again for the current change. A recheck is scoped to the current Readiness Run and the requirements that apply to it.
_Avoid_: Rerun as the full concept, refresh as a guarantee

**Example Dialogue**:
Developer: "The tests passed. Can this change merge?"
Domain Expert: "Only if the Readiness Run shows coverage for the applicable Requirements. Passing tests may be one Evidence Check, not the whole Readiness Report."

Agent: "The report says a docs Work Area was crossed."
Domain Expert: "That Boundary Crossing can add a Readiness Gap until the required evidence or authority-backed Exception is present."
