# Standards Feedback

Standards Feedback is the Veritas subcontext for learning whether Repo Standards are helping, missing coverage, creating noise, or failing to catch important issues.

## Language

**Standards Feedback**:
Observed evidence about how Repo Standards performed during readiness, review, exception, and recheck workflows. Standards Feedback is evidence for improving the standards, not an automatic policy change.
_Avoid_: Eval as the product term, generic reviewer confidence

**Standards Feedback Draft**:
An incomplete feedback artifact created from a Readiness Run before the human outcome fields are confirmed. A draft helps collect the missing facts needed to form durable feedback.
_Avoid_: Final recommendation, check-in

**Standards Feedback Record**:
A completed feedback artifact that includes outcome and measurement facts such as whether the change was accepted without major rewrite, whether follow-up was required, time to green, exceptions, false positives, and missed issues.
_Avoid_: Draft, raw readiness report

**Standards Recommendation**:
A suggested change to Repo Standards based on feedback. A recommendation can add, relax, require, retire, or clarify standards only after the appropriate authority decision.
_Avoid_: Automatic standards mutation, generic proposal

**Feedback Trend**:
A repeated pattern across Standards Feedback that indicates a useful standards change may be needed. A trend is evidence for a recommendation, not proof that the recommendation should be accepted.
_Avoid_: One-off complaint, aggregate score

**Example Dialogue**:
Developer: "This requirement blocked us twice but both were false positives."
Domain Expert: "That belongs in Standards Feedback. If the pattern holds, it can support a Standards Recommendation."

Agent: "Can I edit Repo Standards from this recommendation?"
Domain Expert: "Only after the appropriate authority accepts it. Standards Feedback informs standards growth; it does not mutate Protected Standards by itself."
