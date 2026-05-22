# Concepts

Veritas helps teams earn merge autonomy for AI-authored code by making repo standards executable, evidence-backed, and inspectable.

The product has four jobs:

1. Define what good looks like for the repository.
2. Give developers and agents just-in-time guidance while they work.
3. Produce evidence-backed readiness reports for changes.
4. Improve the repo standards from observed outcomes.

## Product Model

**Repo Standards** are the maintained definition of what good looks like for a repository. They include requirements, evidenceChecks, verification authorities, change boundaries, exception rules, enforcement levels, improvement rules, and merge thresholds.

**Repo Map** is the repo-local model of work areas, change boundaries, protected areas, ownership context, and dependency relationships. The map explains the shape of the repository; the standards define what requirements apply to that shape.

**Merge Readiness** is the per-change trust state that says whether a change has enough current evidence to merge under the repo standards. A change earns readiness by satisfying applicable requirements, not by an agent asserting confidence.

**Repo Conformance** is the repo-wide state: whether the repository currently satisfies standing requirements in its repo standards. A repo may have stale standing coverage while a specific low-risk change still has a defined path to merge readiness.

## Requirements

A **Requirement** is a condition in the repo standards that must be satisfied, evidenced, or explicitly accepted by exception for a change to earn merge readiness.

Requirements can be triggered by:

- changed paths or file types
- work areas in the repo map
- change boundaries or protected areas
- recurring intervals, such as weekly dependency health
- release branches or protected branches
- stale or missing standing evidence
- changes to the repo standards themselves

The implementation still has rule kinds such as `required-artifacts`, `governance-block`, `diff-required`, `forbidden-pattern`, `required-pattern`, `header-required`, and `cross-surface-write`. Those are executable requirement types. Product language should say requirement unless it is describing schema internals.

## Evidence

**Evidence** is a traceable result, observation, artifact, attestation, or record that supports, challenges, or qualifies whether a requirement is satisfied.

An **Evidence Check** is a runnable or inspectable check that produces evidence for one or more requirements. Evidence Checks include tests, typechecks, scanners, protected CI results, owner lookups, approval checks, and external tool results.

**Evidence Freshness** says whether evidence still applies to the current change. Freshness is not just timestamp age. Evidence can be stale because:

- the commit changed after the check ran
- the diff or file fingerprints changed
- the repo standards changed
- the verification authority changed
- the check configuration changed
- a validity window expired
- dependent evidence changed

**Recheck** is the action that verifies evidence, authority, freshness, or integrity again for the current change.

## Authority

A **Verification Authority** is a person, system, tool, environment, or policy source trusted by the repo standards to verify a requirement.

**Authority Evidence** explains why a verification authority was allowed to count. Examples include protected CI context, scanner version and configuration, owner identity, team membership, standards-file hash, or signed approval metadata.

An **Attestation** is evidence from a verification authority asserting that something was verified, accepted, approved, or reviewed. Attestations should identify the authority, subject, integrity scope, and any validity window that affects merge readiness.

An **Exception** is a decision to accept an unmet or failing requirement for a specific change. Exceptions affect merge readiness only when backed by an attestation from a valid verification authority.

## Boundaries

A **Work Area** is a meaningful part of a repository with a purpose, ownership context, and change expectations.

A **Change Boundary** is a coordination or risk threshold around a work area. Boundaries are not walls. Crossing one is allowed, but it can add requirements for evidence, guidance, owner authority, or coordination.

A **Boundary Crossing** is a change that touches a work area outside the expected scope, authority, or dependency path for the current work.

A **Protected Area** is a high-risk work area where changes require stronger authority or evidence before merge readiness can be earned. Repo standards, shared contracts, security-sensitive code, and release infrastructure are common protected areas.

## Readiness Reports

A **Readiness Report** is the human- and agent-facing output that explains a change's merge readiness.

It should show:

- applicable requirements
- readiness coverage
- boundary crossings
- evidence freshness
- missing or failing evidence
- exceptions
- recheck options
- change guidance

**Readiness Coverage** is the current evidence state for the requirements that apply to a specific change. It explains which requirements are satisfied, missing, stale, failing, advisory, recheckable, or accepted by exception.

The current CLI uses `veritas readiness --working-tree` as the primary user-facing command for readiness reports.

## Guidance

**Change Guidance** is just-in-time instruction Veritas gives a developer or agent when a requirement, work area, change boundary, or evidence result matters to the current change.

Good change guidance explains:

- what to do next
- what not to do
- why it matters
- what evidence will satisfy the requirement
- which authority can accept an exception

This is how repo standards survive long AI sessions, compaction, and context drift without becoming a static documentation dump.

## Enforcement

Requirements have an **Enforcement Level**:

- **Observe** records evidence and outcomes without guiding or blocking work.
- **Guide** gives just-in-time correction or review feedback, but does not by itself prevent merge readiness.
- **Require** means the requirement must be satisfied by fresh evidence or accepted by authority-backed exception before merge readiness or repo conformance is complete.

Current schema references may use lower-level enforcement fields. Treat those as implementation details unless a page is documenting exact schema fields.

## Protected Standards

**Protected Standards** are the parts of the repo standards and repo map that define what good looks like, where boundaries are, or who is trusted to verify requirements. Changes to protected standards require stronger authority because they can change how merge readiness and repo conformance are judged.

**Standards Growth** is additive improvement: new requirements, work areas, change guidance, evidenceChecks, or boundary coverage. Standards growth should not weaken protected standards without the required authority.

**Generated Evidence** includes readiness reports, evidence records, repo conformance outputs, standards feedback, and other artifacts generated by Veritas. Generated evidence is inspectable output, not the source of repo standards.

## Standards Feedback

Veritas should not be a static rule runner. It should help teams improve their repo standards over time.

**Standards Feedback** is observed evidence about whether the repo standards are helping, missing coverage, creating noise, or failing to catch important issues.

**Standards Recommendation** is a suggested change to the repo standards based on feedback. A recommendation may add, relax, require, retire, or clarify requirements, evidenceChecks, work areas, boundaries, authorities, or guidance.

The current CLI exposes this area through feedback and recommendation commands documented in the CLI reference.

## Built With Surface

Veritas is built with Surface, but normal Veritas users should not need to configure Surface directly.

Veritas owns the repo-native workflow:

- repo standards
- repo maps
- requirements
- evidenceChecks
- verification authorities
- readiness reports
- repo conformance
- standards feedback

Surface powers the portable transparency layer:

- claims
- evidence
- policies
- events
- freshness
- conflicts
- transparency gaps
- trust snapshots

At the boundary, Veritas emits Surface-format trust state and can use Surface-derived status, freshness, and gap analysis in its reports and console. The user-facing Veritas product should still use Veritas vocabulary.
