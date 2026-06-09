function toBinaryFlag(value) {
  return value ? 1 : 0;
}

export function compareLatencyImprovement(baselineLatency, treatmentLatency) {
  if (typeof baselineLatency !== 'number' || typeof treatmentLatency !== 'number') {
    return null;
  }
  return baselineLatency - treatmentLatency;
}

function safeRate(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function sortNumbers(values) {
  return [...values].sort((left, right) => left - right);
}

function medianNumber(values) {
  if (values.length === 0) return null;
  const sorted = sortNumbers(values);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function percentileNumber(values, percentile) {
  if (values.length === 0) return null;
  const sorted = sortNumbers(values);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function collectLatencyValues(trials) {
  return trials
    .map((trial) => trial.comparison.conditions.with_veritas.assistant_turn_latency)
    .filter((value) => typeof value === 'number');
}

export function buildBenchmarkPassMetrics(trialComparisons) {
  return {
    pass_at_1: trialComparisons[0]?.comparison.conditions.with_veritas.pass ? 1 : 0,
    pass_at_k: trialComparisons.some((trial) => trial.comparison.conditions.with_veritas.pass)
      ? 1
      : 0,
    pass_pow_k: trialComparisons.every((trial) => trial.comparison.conditions.with_veritas.pass)
      ? 1
      : 0,
  };
}

export function buildMarkerBenchmarkComparisonMetrics({
  withoutVeritasScore,
  withVeritasScore,
  latencyImprovementTurns,
}) {
  return {
    timely_recall_delta:
      toBinaryFlag(withVeritasScore.timely) - toBinaryFlag(withoutVeritasScore.timely),
    false_positive_improvement:
      toBinaryFlag(withoutVeritasScore.false_positive) -
      toBinaryFlag(withVeritasScore.false_positive),
    latency_improvement_turns: latencyImprovementTurns,
    treatment_beats_baseline:
      (withVeritasScore.pass &&
        (!withoutVeritasScore.pass ||
          (withoutVeritasScore.false_positive && !withVeritasScore.false_positive))) ||
      (withVeritasScore.pass && withoutVeritasScore.pass && latencyImprovementTurns > 0),
  };
}

export function buildMarkerBenchmarkAggregateMetrics(trials, benchmarkSummaries = []) {
  const baselinePassCount = trials.filter(
    (trial) => trial.comparison.conditions.without_veritas.pass,
  ).length;
  const treatmentPassCount = trials.filter(
    (trial) => trial.comparison.conditions.with_veritas.pass,
  ).length;
  const baselineFalsePositiveCount = trials.filter(
    (trial) => trial.comparison.conditions.without_veritas.false_positive,
  ).length;
  const treatmentFalsePositiveCount = trials.filter(
    (trial) => trial.comparison.conditions.with_veritas.false_positive,
  ).length;
  const improvementCount = trials.filter(
    (trial) => trial.comparison.comparison.treatment_beats_baseline,
  ).length;
  const latencies = collectLatencyValues(trials);

  return {
    baseline_pass_rate: safeRate(baselinePassCount, trials.length),
    treatment_pass_rate: safeRate(treatmentPassCount, trials.length),
    improvement_rate: safeRate(improvementCount, trials.length),
    baseline_false_positive_rate: safeRate(baselineFalsePositiveCount, trials.length),
    treatment_false_positive_rate: safeRate(treatmentFalsePositiveCount, trials.length),
    median_treatment_latency: medianNumber(latencies),
    p95_treatment_latency: percentileNumber(latencies, 95),
    pass_at_1: safeRate(
      benchmarkSummaries.filter((summary) => summary.metrics.pass_at_1 === 1).length,
      benchmarkSummaries.length,
    ),
    pass_at_k: safeRate(
      benchmarkSummaries.filter((summary) => summary.metrics.pass_at_k === 1).length,
      benchmarkSummaries.length,
    ),
    pass_pow_k: safeRate(
      benchmarkSummaries.filter((summary) => summary.metrics.pass_pow_k === 1).length,
      benchmarkSummaries.length,
    ),
  };
}
