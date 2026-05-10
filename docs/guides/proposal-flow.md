# Proposal Flow

Veritas proposals turn repeated eval signal into reviewable governance changes. The loop is:

```bash
npx @kontourai/veritas run --working-tree
npx @kontourai/veritas eval propose
npx @kontourai/veritas proposal list
npx @kontourai/veritas proposal decide <id> --accept|--reject --actor <human-id> --message <reason>
```

## What gets proposed

`veritas eval propose` reads `.veritas/evals/history.jsonl` and creates proposal artifacts under `.veritas/proposals/`. Current proposal types cover:

- rules frequently overridden by humans
- warn-stage rules that fail without follow-up edits
- rules that have not failed across enough recent runs
- paths that repeatedly miss the adapter surface map

Open proposals also project into `surface.input` as proposed claims, so Surface reports can show that a governance change is pending rather than silently accepted.

## Accept

Accepting a rule proposal applies the policy diff and records a `proposal-acceptance` attestation:

```bash
npx @kontourai/veritas proposal decide <id> --accept --actor <human-id> --message "Evidence supports relaxing this rule"
```

The attestation keeps the accepted policy change in the Zone 1 human-review chain.

## Reject

Rejecting a proposal records the decision without applying the diff:

```bash
npx @kontourai/veritas proposal decide <id> --reject --actor <human-id> --message "Keep the rule strict"
```

Recently rejected proposals are suppressed during regeneration so the same suggestion does not immediately reappear.
