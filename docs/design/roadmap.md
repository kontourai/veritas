# Roadmap

Open design questions and planned work, updated to the current product vocabulary.

## Standards Feedback Persistence

### Gap

Veritas can generate local evidence and feedback, but long-term trend data is still limited by local files and CI artifact retention.

The product claim is:

> Teams should be able to improve repo standards from observed outcomes.

That requires durable standards feedback: which requirements were noisy, which evidenceChecks helped, which exceptions repeated, and whether review time is falling.

### Options

**GitHub issue state**
Useful for current health and short-term history, but awkward as a durable machine-readable store.

**GitHub Actions cache**
Good for short-horizon comparison, weak for quiet repos and long-term trends.

**Configurable external sink**
Lets teams keep ownership of data, but adds setup friction.

**Hosted feedback sink**
Best UX for cross-repo longitudinal standards feedback, but requires infrastructure and a trust model for team data.

### Next

1. Be clear that local feedback is available now and durable cross-run aggregation is planned.
2. Stabilize the standards feedback payload before adding hosted infrastructure.
3. Make any hosted or external sink opt-in during setup.

## Protected Standards Integrity

### Gap

The repo standards and repo map define what good looks like. If an agent can freely weaken them, it can change the standard used to judge its own work.

Current attestations make protected standards changes visible, but the product should get better at classifying standards changes as:

- additive standards growth
- protected standards updates
- weakening or demotion
- generated evidence only

### Product Model

Use:

- **Protected Standards** for standards/map/authority definitions that require stronger authority to change.
- **Standards Growth** for additive improvements that do not weaken existing standards.
- **Generated Evidence** for outputs that should not become the source of standards.

Avoid numbered governance areas in product language.

### Next

1. Add machine-readable protected-standards metadata.
2. Classify standards diffs as additive, protected, weakening, or generated.
3. Include that classification in readiness reports and CI summaries.
4. Define when additive Standards Growth can merge with reduced review.
5. Keep CODEOWNERS as an optional implementation aid, not the primary model.

## Readiness Command

### Gap

`veritas readiness` is now the user-facing product command, but the output still needs to become a fuller Readiness Report rather than mostly command feedback.

### Next

Evolve `veritas readiness` into a complete Readiness Report:

- Merge Readiness
- Readiness Coverage
- Boundary Crossings
- Evidence Freshness
- Exceptions
- Recheck options
- Change Guidance



## Product Naming Migration

### Gap

Current generated files, schemas, and CLI groups still use pre-glossary names.

### Next

1. Rename generated README text and CLI help to canonical terms first.
2. Rename schemas and file paths to Repo Standards, Repo Map, Evidence Checks, Standards Feedback, Standards Recommendations, and Readiness Coverage.
3. Add migration notes only for contributors who encounter existing local artifacts.
4. Remove old names from product docs instead of treating them as a supported public surface.
