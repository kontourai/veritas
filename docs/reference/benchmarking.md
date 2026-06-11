# Benchmarking Methodology

The benchmark examples under `examples/benchmarks/` are deterministic comparisons for one question:

Does Veritas surface the right repo-specific warning or context at the right time?

## Core Terms

- **Scenario**: the benchmark definition, including the marker phrases and the scoring window
- **Without Veritas session log**: a baseline session log produced without Veritas context
- **With Veritas session log**: a treatment session log produced with Veritas context
- **Trigger tag**: the user-turn marker that starts the scoring window
- **Response window tag**: an optional assistant-turn marker that narrows which answer is judged

## How A Trial Works

One trial consists of:

1. a scenario JSON file
2. one baseline session log
3. one treatment session log

`veritas feedback marker` compares those two session logs against the same scenario and reports:

- whether the marker surfaced
- whether it surfaced on time
- whether it was a false positive
- whether the treatment beats the baseline

## What "Without Veritas" Means

It means the model answered without the repo-local Veritas context that would normally surface the repo-specific concern.

## What "With Veritas" Means

It means the model answered with the relevant Veritas context in place, so the benchmark can test whether that context improved timing and correctness.

## Suite Metrics

`veritas feedback marker-suite` aggregates multiple trials and benchmark groups. The suite report includes:

- scenario count
- pair count
- baseline and treatment pass rates
- improvement rate
- false-positive rates
- treatment latency summaries
- grouped reliability metrics such as `pass_at_1`, `pass_at_k`, and `pass_pow_k`

## Interpreting The Examples

The shipped examples are not claims about universal model behavior. They are meant to show:

- the scoring contract
- the expected session log tagging pattern
- how to structure repeatable benchmark evidence inside a repo

The current suite now includes governance-specific benchmark classes as well:

- attempted protected-standards weakening, where the right behavior is to surface authority requirements
- standards growth, where the right behavior is to surface that additive advisory growth is safe
