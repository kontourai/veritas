# Veritas

Veritas is the product context for repo and AI-agent governance. This glossary defines the language humans and agents should share when discussing how a repository defines standards, evaluates changes, and earns autonomy.

## Language

**Veritas**:
A repo and AI-agent governance product for earning trust in AI-authored code changes. Veritas is not a generic lint framework; it helps teams define repo standards, evaluate changes against them, and inspect why a change is or is not ready to merge.
_Avoid_: Generic lint framework, Surface module, trust substrate

**Repo Standards**:
The maintained definition of what good looks like for a repository. Repo standards may include requirements, evidenceChecks, verification authorities, change boundaries, exception rules, enforcement levels, improvement rules, and merge thresholds.
_Avoid_: Checklist, style guide, repo standards, authority settings as separate human-facing terms

**Requirement**:
A condition in the repo standards that must be satisfied, evidenced, or explicitly waived for a change to earn merge readiness. Requirements are Veritas concepts; their evaluations may produce claims and evidence for transparency.
_Avoid_: Rule as the primary product term, Surface claim as the authoring concept

**Requirement Applicability**:
The condition that determines when a requirement matters for a change, repo state, release, recurring interval, work area, or boundary crossing. User-facing reports should usually explain applicability as "Required because..." rather than forcing the term into the interface.
_Avoid_: Claim applicability, hidden dynamic scope

**Verification Authority**:
A person, system, tool, environment, or policy source trusted by the repo standards to verify a requirement. A verification authority must be trusted for the specific requirement it verifies, not treated as universally authoritative.
_Avoid_: Human approver only, blanket approval source

**Authority Evidence**:
Evidence explaining why a verification authority was allowed to count for a requirement. Authority evidence may include protected CI context, scanner version and configuration, owner identity, authority settings membership, standard-file hash, or signed approval metadata.
_Avoid_: Trust by label, untraceable approval

**Attestation**:
Evidence from a verification authority asserting that something was verified, accepted, approved, or reviewed. An attestation should identify the authority, the subject, the integrity scope, and any validity window that affects merge readiness.
_Avoid_: Approval in general, waiver, signature as the only form

**Evidence**:
A traceable result, observation, artifact, attestation, or record that supports, challenges, or qualifies whether a requirement is satisfied. Evidence can pass, fail, warn, be missing, be stale, or require recheck.
_Avoid_: Evidence Check as the canonical term, source as a synonym

**Evidence Check**:
A runnable or inspectable check that produces evidence for one or more requirements. Evidence Checks may include tests, typechecks, scanners, protected CI results, owner lookups, approval checks, or external tool results.
_Avoid_: Generic check, evidenceCheck as human-facing prose, check as an unqualified synonym

**Change Guidance**:
Just-in-time instructions Veritas gives a developer or agent when a requirement, work area, change boundary, or evidence result matters to the current change. Change guidance should explain what to do next, what not to do, and why it matters for merge readiness.
_Avoid_: Agent-only guidance, static documentation dump, generic prompt advice, Surface agent guidance as the user-facing term

**Evidence Freshness**:
Whether evidence still applies to the current change. Evidence freshness depends on the commit, diff, files, standard version, authority state, dependent evidence, and any time-based validity policy.
_Avoid_: Recency only, timestamp age only

**Recheck**:
An action that verifies evidence, authority, freshness, or integrity again for the current change. A recheck may rerun tests, re-run a scanner, re-check owner authority, verify a standard-file hash, or confirm evidence is anchored to the current commit.
_Avoid_: Surface reverification as the user-facing term, guaranteed refresh

**Exception**:
A decision to accept an unmet or failing requirement for a specific change. An exception affects merge readiness only when it is backed by an attestation from a valid verification authority.
_Avoid_: Silent bypass, waiver without authority evidence

**Enforcement Level**:
How strongly Veritas applies a requirement while evaluating merge readiness or repo conformance. Use **Observe** to collect evidence only, **Guide** to give agent-facing correction, and **Require** when the requirement must be satisfied or accepted by exception.
_Avoid_: Shadow/warn/block as product language, requirement stage, promotion as the first mental model

**Observe**:
An enforcement level where Veritas records evidence and outcomes without guiding or blocking work.
_Avoid_: Shadow as the user-facing term

**Guide**:
An enforcement level where Veritas gives just-in-time correction or review feedback, but does not by itself prevent merge readiness.
_Avoid_: Warn as the user-facing term

**Require**:
An enforcement level where a requirement must be satisfied by fresh evidence or accepted by an authority-backed exception before merge readiness or repo conformance is complete.
_Avoid_: Block as the user-facing term, hard gate without evidence

**Work Area**:
A meaningful part of a repository with a purpose, ownership context, and change expectations. Work areas help Veritas understand where a change lives and who or what may depend on it.
_Avoid_: Surface, surface node, component as the universal term

**Change Boundary**:
A coordination or risk threshold around a work area. Crossing a change boundary is allowed, but it can add requirements for evidence, guidance, owner authority, or coordination.
_Avoid_: Wall, lane as the canonical term, ownership silo

**Boundary Crossing**:
A change that touches a work area outside the expected scope, authority, or dependency path for the current work. A boundary crossing affects merge readiness by adding or strengthening requirements.
_Avoid_: Violation by default, exception by default

**Protected Area**:
A high-risk work area where changes require stronger authority or evidence before merge readiness can be earned. Repo standards, shared contracts, security-sensitive code, and release infrastructure are common protected areas.
_Avoid_: Forbidden area, human-only area

**Repo Map**:
The repo-local model of work areas, change boundaries, protected areas, ownership context, and dependency relationships. A repo map explains the shape of the repository; the repo standards define what requirements apply to that shape.
_Avoid_: Adapter as the product term, repo surface, surface node, configuration catch-all

**Standards File**:
The repo-local artifact that stores repo standards in machine-readable form. The standards file is the source Veritas evaluates when deciding what evidence, boundaries, and guidance apply to a change.
_Avoid_: Policy pack, rules bundle, configuration blob

**Repo Standards Template**:
A reusable starting point for repo standards, usually tailored to a repo type, language stack, or team workflow. A template is adopted and modified; it is not the final authority for a repo.
_Avoid_: Pack, marketplace add-on, universal best practice

**Protected Standards**:
The parts of the repo standards and repo map that define what good looks like, where boundaries are, or who is trusted to verify requirements. Changes to protected standards require stronger authority because they can change how merge readiness and repo conformance are judged.
_Avoid_: Numbered governance areas as product language, unprotected self-modifying governance

**Standards Growth**:
Additive improvements to repo standards, such as new requirements, work areas, change guidance, evidenceChecks, or boundary coverage. Standards growth should not weaken existing protected standards without the required authority.
_Avoid_: Numbered governance areas as product language, automatic policy mutation

**Generated Evidence**:
Readiness reports, evidence records, repo conformance outputs, standards feedback, and other artifacts generated by Veritas. Generated evidence is inspectable output, not the source of repo standards.
_Avoid_: Numbered governance areas as product language, generated output as governance source

**Merge Readiness**:
The per-change trust state that says whether a change has enough current evidence to merge under the repo standards. Merge readiness is earned by satisfying the standards, not asserted by an agent's confidence.
_Avoid_: Approval, trust score, guaranteed correctness

**Readiness Report**:
The human- and agent-facing report that explains a change's merge readiness. A readiness report includes readiness coverage, boundary crossings, evidence freshness, exceptions, recheck options, and change guidance when relevant.
_Avoid_: Surface trust report as the user-facing term, raw evidence artifact

**Readiness Coverage**:
The current evidence state for the requirements that apply to a specific change. Readiness coverage explains which requirements are satisfied, missing, stale, failing, advisory, recheckable, or accepted by exception.
_Avoid_: Verification budget, full repo health, test coverage

**Repo Conformance**:
Whether the repository as a whole currently satisfies the standing requirements in its repo standards. Repo conformance is separate from merge readiness: a repo may have stale standing coverage while a specific low-risk change still has a defined path to merge readiness.
_Avoid_: Compliance as the default term, standard health, generic repo health

**Standards Feedback**:
Observed evidence about whether the repo standards are helping, missing coverage, creating noise, or failing to catch important issues. Standards feedback comes from readiness results, repo conformance, exceptions, rechecks, review outcomes, and agent correction history.
_Avoid_: Eval history as the user-facing term, reviewer confidence as the core concept

**Agent Session Log**:
A durable record of a developer or agent session that Veritas can inspect to generate standards feedback, benchmark guidance quality, or understand whether change guidance arrived at the right moment. Product docs should say agent session log or session log; implementation fields may use `sessionLog` or `session_log_*`.
_Avoid_: Transcript as product language, chat transcript, runtime-specific log names except when documenting external environment variables

**Standards Recommendation**:
A suggested change to the repo standards based on standards feedback. A standards recommendation may add, relax, require, retire, or clarify requirements, evidenceChecks, work areas, boundaries, authorities, or guidance.
_Avoid_: Generic proposal, automatic policy change

**Built with Surface**:
The product signal that Veritas uses Surface for portable transparency state. Veritas users should not need to configure Surface directly for normal repo governance workflows.
_Avoid_: Surface as a required user-facing setup step, Surface vocabulary in Veritas commands

## Flagged Ambiguities

**Check-in**:
Earlier Veritas artifacts used "check-in" for operational summaries. Do not treat check-in as canonical product language; use **Readiness Report** for change-level output, **Repo Conformance** for repo-wide state, and **Standards Feedback** for longitudinal improvement evidence.

**Eval**:
Earlier Veritas artifacts used "eval" for generated observations about whether Veritas guidance helped. Do not use eval as primary product language; use **Standards Feedback** for observed improvement evidence and **Standards Recommendation** for suggested changes to repo standards.

**Attestation**:
Use attestation only for an authority-backed assertion that something was verified, accepted, approved, or reviewed. Do not use it for every evidence result, generic approval, or readiness report.

**Governance Areas**:
Do not use numbered governance areas as canonical product language; use **Protected Standards**, **Standards Growth**, and **Generated Evidence**.

**Framework**:
Do not use framework as primary Veritas product language. Use **product** for Veritas, **CLI** for commands, and implementation-specific terms only where they literally describe code structure.

**Rule**:
Use rule only for implementation-specific executable checks when necessary. Product language should use **Requirement** so Veritas remains centered on repo standards and merge readiness rather than lint mechanics.

**Override**:
Do not use override as Veritas product language. Use **Exception** for an authority-backed decision to accept an unmet or failing requirement. Use runtime-specific names only when documenting an external API that cannot be renamed.

**Actor**:
Use actor only in schemas, audit metadata, or implementation code. Product language should say **Developer**, **Agent**, **Verification Authority**, or **Owner** depending on the role being described.

**Transcript**:
Use transcript only when a runtime exposes that exact external name, such as `CODEX_TRANSCRIPT_PATH` or `CLAUDE_TRANSCRIPT_PATH`. Veritas product language should use **Agent Session Log** or **session log**.

**Example Dialogue**:
Developer: "Can this agent-authored change merge with light review?"
Domain Expert: "Check its Merge Readiness. It needs to satisfy the Repo Standards for API changes before we reduce human review."

Agent: "This change also touched shared contracts."
Domain Expert: "That is a Boundary Crossing. The Repo Standards should add contract evidence and owner authority before Merge Readiness is complete."
