# Tune Veritas For Your Team

Tune Veritas by improving your repo standards, not by forking the product or adding one-off scripts for every complaint.

The goal is earned autonomy: requirements become stronger when evidence shows they help, and weaker or clearer when evidence shows they create noise.

## What To Adjust

Most teams adjust:

- **Requirements**: what must be true for merge readiness or repo conformance.
- **Evidence Checks**: which tests, scanners, CI jobs, or authority checks produce evidence.
- **Enforcement Levels**: Observe, Guide, or Require.
- **Change Boundaries**: where shared-code coordination or stronger authority is needed.
- **Verification Authorities**: who or what is trusted to verify each requirement.

The current implementation stores some of this in generated files under `.veritas/`. Treat exact file names as implementation details, not product concepts.

## Rollout Ladder

Start with the enforcement ladder:

- **Observe**: collect evidence and standards feedback.
- **Guide**: give developers and agents correction while they work.
- **Require**: require fresh evidence or authority-backed exception before readiness is complete.

Do not start by requiring everything. First learn which requirements are useful and which ones create noise.

## How To Decide What To Change

If a requirement keeps getting exceptions:

- clarify the requirement
- lower its enforcement level
- split one fuzzy requirement into clearer requirements
- add better change guidance

If humans keep catching the same issue:

- add a requirement
- add or strengthen an evidenceCheck
- add a work area or change boundary to the repo map
- make the requirement easier for agents to discover

If evidence often goes stale:

- add a recheck path
- tighten integrity references
- adjust the freshness policy
- make the evidenceCheck run closer to merge

If review still feels slow:

- improve the readiness report
- make readiness coverage easier to scan
- reduce checks that are not relevant to the change
- move product behavior into normal tests and have Veritas route those tests

## What Not To Tune First

Do not start with model fine-tuning or a large governance rollout.

Start with:

- clearer requirements
- better change guidance
- more trustworthy evidenceChecks
- stronger authority evidence for protected standards
- standards recommendations based on real outcomes

## What Success Looks Like

Veritas is tuned well when:

- agents self-correct before review
- developers understand why requirements apply
- readiness reports make review faster
- exceptions become rare and well-explained
- standards recommendations are grounded in evidence
- the team can reduce manual review for low-risk, well-evidenced changes
