# Standards Recommendations

Veritas should help teams improve their repo standards over time. Product language calls the underlying concepts **Standards Feedback** and **Standards Recommendations**.

## What Feedback Captures

Standards feedback can come from:

- requirements that are repeatedly accepted by exception
- evidenceChecks that catch real issues
- checks that are stale too often
- requirements that block changes but are later judged noisy
- work areas that are repeatedly unmapped
- boundary crossings that need clearer guidance
- agents repeatedly missing the same standard

## Generate Recommendations

Use the current CLI:

```bash
npx @kontourai/veritas feedback recommend
npx @kontourai/veritas recommendation list
npx @kontourai/veritas recommendation show <id>
```

These commands inspect generated evidence and feedback history, then write reviewable recommendation artifacts under `.veritas/recommendations/`.

## Decide A Recommendation

Accept or reject a recommendation explicitly:

```bash
npx @kontourai/veritas recommendation decide <id> --accept --actor <authority-id> --approval-ref <human-approval-reference> --message "Evidence supports requiring this check"
npx @kontourai/veritas recommendation decide <id> --reject --actor <authority-id> --message "Keep this requirement advisory until feedback shows it reliably catches issues"
```

Accepting a recommendation may change protected standards. When it does, Veritas records or requires an attestation so the standards cannot change silently.

## Product Rule

Standards recommendations are not automatic policy mutation. They are suggested changes backed by standards feedback. A team or trusted authority still decides whether the standards should change.
