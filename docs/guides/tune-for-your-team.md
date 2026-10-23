# Tune Veritas For Your Team

Tune Veritas by improving your repo standards, not by forking the product or adding one-off scripts for every complaint.

Change enforcement when catch evidence and reviewer feedback justify it. A quiet rule may be useful or unexercised; silence alone does not justify retirement.

## What To Adjust

Most teams adjust:

- **Requirements**: what must be true for merge readiness or repo conformance.
- **Evidence Checks**: which tests, scanners, CI jobs, or authority checks produce evidence.
- **Enforcement Levels**: Observe, Guide, or Require.
- **Change Boundaries**: where shared-code coordination or stronger authority is needed.
- **Verification Authorities**: who or what is trusted to verify each requirement.

Initialization scaffolds configuration under `.veritas/`. After review, those files are maintained policy source, not disposable generated output. Generated evidence lives under `.kontourai/`.

## Rollout Ladder

Start with the enforcement ladder:

- **Observe**: collect evidence and standards feedback.
- **Guide**: give developers and agents correction while they work.
- **Require**: require fresh evidence before readiness is complete.

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
- reviewers can identify the evidence and gaps for a change; any decision to reduce review is separately evaluated by the team
