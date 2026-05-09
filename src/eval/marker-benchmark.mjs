import { dirname, resolve } from 'node:path';
import {
  loadMarkerBenchmarkScenario,
  loadMarkerBenchmarkTranscript,
  loadMarkerBenchmarkSuite,
} from '../load.mjs';
import { uniqueStrings } from '../util/strings.mjs';

function lowerIfNeeded(value, caseSensitive) {
  return caseSensitive ? value : value.toLowerCase();
}

function findMatchedPhrase(content, phrases, caseSensitive) {
  if (typeof content !== 'string' || content.length === 0) {
    return null;
  }

  const normalizedContent = lowerIfNeeded(content, caseSensitive);
  for (const phrase of phrases) {
    const normalizedPhrase = lowerIfNeeded(phrase, caseSensitive);
    if (normalizedContent.includes(normalizedPhrase)) {
      return phrase;
    }
  }

  return null;
}

function hasTag(turn, tag) {
  return typeof tag === 'string' && Array.isArray(turn.tags) && turn.tags.includes(tag);
}

function validateAllowedKeys(record, allowedKeys, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains unsupported key: ${key}`);
    }
  }
}

function validateIntegerField(value, label, { minimum = null } = {}) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  if (minimum !== null && value < minimum) {
    throw new Error(`${label} must be greater than or equal to ${minimum}`);
  }
}

function validateStringField(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function validateOptionalStringField(value, label) {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be a string when provided`);
  }
}

function validateBooleanField(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
}

function validateMarkerBenchmarkScenario(scenario) {
  validateAllowedKeys(scenario, ['version', 'id', 'title', 'description', 'marker', 'scoring'], 'marker benchmark scenario');
  const requiredKeys = ['version', 'id', 'title', 'marker', 'scoring'];
  for (const key of requiredKeys) {
    if (!(key in scenario)) {
      throw new Error(`marker benchmark scenario is missing required key: ${key}`);
    }
  }
  validateIntegerField(scenario.version, 'marker benchmark scenario version', { minimum: 1 });
  validateStringField(scenario.id, 'marker benchmark scenario id');
  validateStringField(scenario.title, 'marker benchmark scenario title');
  validateOptionalStringField(
    scenario.description,
    'marker benchmark scenario description',
  );
  validateAllowedKeys(
    scenario.marker,
    ['id', 'required_phrases'],
    'marker benchmark scenario marker',
  );
  validateStringField(scenario.marker.id, 'marker benchmark scenario marker.id');
  if (!Array.isArray(scenario.marker?.required_phrases) || scenario.marker.required_phrases.length === 0) {
    throw new Error(
      'marker benchmark scenario requires marker.required_phrases with at least one phrase',
    );
  }
  for (const phrase of scenario.marker.required_phrases) {
    validateStringField(phrase, 'marker benchmark scenario marker.required_phrases item');
  }
  validateAllowedKeys(
    scenario.scoring,
    [
      'trigger_tag',
      'response_tag',
      'max_assistant_turns_after_trigger',
      'allow_early',
      'case_sensitive',
    ],
    'marker benchmark scenario scoring',
  );
  const requiredScoringKeys = [
    'trigger_tag',
    'max_assistant_turns_after_trigger',
    'allow_early',
  ];
  for (const key of requiredScoringKeys) {
    if (!(key in scenario.scoring)) {
      throw new Error(`marker benchmark scenario scoring is missing required key: ${key}`);
    }
  }
  validateStringField(
    scenario.scoring.trigger_tag,
    'marker benchmark scenario scoring.trigger_tag',
  );
  validateIntegerField(
    scenario.scoring.max_assistant_turns_after_trigger,
    'marker benchmark scenario scoring.max_assistant_turns_after_trigger',
    { minimum: 1 },
  );
  validateBooleanField(
    scenario.scoring.allow_early,
    'marker benchmark scenario scoring.allow_early',
  );
  if (
    'response_tag' in scenario.scoring &&
    (typeof scenario.scoring.response_tag !== 'string' ||
      scenario.scoring.response_tag.length === 0)
  ) {
    throw new Error(
      'marker benchmark scenario scoring.response_tag must be a non-empty string when provided',
    );
  }
  if (scenario.scoring.response_tag === scenario.scoring.trigger_tag) {
    throw new Error(
      'marker benchmark scenario scoring.response_tag must differ from scoring.trigger_tag',
    );
  }
  if ('case_sensitive' in scenario.scoring) {
    validateBooleanField(
      scenario.scoring.case_sensitive,
      'marker benchmark scenario scoring.case_sensitive',
    );
  }
}

function validateMarkerBenchmarkTranscript(transcript, label) {
  validateAllowedKeys(
    transcript,
    ['version', 'benchmark_id', 'run_id', 'condition_id', 'turns'],
    `${label} transcript`,
  );
  const requiredKeys = ['version', 'benchmark_id', 'run_id', 'condition_id', 'turns'];
  for (const key of requiredKeys) {
    if (!(key in transcript)) {
      throw new Error(`${label} transcript is missing required key: ${key}`);
    }
  }
  validateIntegerField(transcript.version, `${label} transcript version`, { minimum: 1 });
  validateStringField(transcript.benchmark_id, `${label} transcript benchmark_id`);
  validateStringField(transcript.run_id, `${label} transcript run_id`);
  validateStringField(transcript.condition_id, `${label} transcript condition_id`);
  if (!['without-veritas', 'with-veritas'].includes(transcript.condition_id)) {
    throw new Error(
      `${label} transcript condition_id must be without-veritas or with-veritas`,
    );
  }
  if (!Array.isArray(transcript.turns) || transcript.turns.length === 0) {
    throw new Error(`${label} transcript requires at least one turn`);
  }
  for (const turn of transcript.turns) {
    validateAllowedKeys(turn, ['role', 'content', 'tags'], `${label} transcript turn`);
    if (!['system', 'user', 'assistant', 'tool'].includes(turn.role)) {
      throw new Error(`${label} transcript turn role must be one of system, user, assistant, tool`);
    }
    if (typeof turn.content !== 'string') {
      throw new Error(`${label} transcript turn content must be a string`);
    }
    if ('tags' in turn && !Array.isArray(turn.tags)) {
      throw new Error(`${label} transcript turn tags must be an array when provided`);
    }
    if (Array.isArray(turn.tags)) {
      for (const tag of turn.tags) {
        validateStringField(tag, `${label} transcript turn tag`);
      }
    }
  }
}

function validateMarkerBenchmarkPair({ scenario, transcript, label, expectedConditionId }) {
  validateMarkerBenchmarkTranscript(transcript, label);
  if (transcript.benchmark_id !== scenario.id) {
    throw new Error(
      `${label} transcript benchmark_id must match scenario id ${scenario.id}`,
    );
  }
  if (transcript.condition_id !== expectedConditionId) {
    throw new Error(
      `${label} transcript condition_id must be ${expectedConditionId}`,
    );
  }
}

function collectTaggedTurnIndices(turns, tag, role = null) {
  const matchedIndices = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (role && turn.role !== role) continue;
    if (hasTag(turn, tag)) {
      matchedIndices.push(index);
    }
  }
  return matchedIndices;
}

export function scoreMarkerBenchmarkCondition({
  scenario,
  transcript,
  label = 'marker benchmark',
}) {
  validateMarkerBenchmarkScenario(scenario);
  validateMarkerBenchmarkTranscript(transcript, label);

  const triggerTag = scenario.scoring.trigger_tag;
  const responseTag = 'response_tag' in scenario.scoring ? scenario.scoring.response_tag : null;
  const maxAssistantTurnsAfterTrigger = scenario.scoring.max_assistant_turns_after_trigger;
  const allowEarly = scenario.scoring.allow_early;
  const caseSensitive = scenario.scoring.case_sensitive === true;
  const requiredPhrases = uniqueStrings(scenario.marker.required_phrases);
  const triggerTurnIndices = collectTaggedTurnIndices(transcript.turns, triggerTag);
  if (triggerTurnIndices.length !== 1) {
    throw new Error(`${label} transcript must include exactly one trigger tag ${triggerTag}`);
  }
  const triggerTurnIndex = triggerTurnIndices[0];
  const allResponseTurnIndices =
    responseTag === null
      ? []
      : collectTaggedTurnIndices(transcript.turns, responseTag);
  const responseTurnIndices =
    responseTag === null
      ? []
      : collectTaggedTurnIndices(transcript.turns, responseTag, 'assistant');
  if (responseTag !== null && allResponseTurnIndices.length !== 1) {
    throw new Error(
      `${label} transcript must include exactly one response tag ${responseTag}`,
    );
  }
  if (responseTag !== null && responseTurnIndices.length !== 1) {
    throw new Error(
      `${label} transcript must include exactly one assistant response tag ${responseTag}`,
    );
  }
  const firstResponseWindowTurn = responseTurnIndices[0] !== undefined ? responseTurnIndices[0] + 1 : null;

  let assistantTurnsAfterTrigger = 0;
  let firstSurfaceTurn = null;
  let assistantTurnLatency = null;
  let matchedPhrase = null;
  let falsePositive = false;

  for (let index = 0; index < transcript.turns.length; index += 1) {
    const turn = transcript.turns[index];
    if (turn.role !== 'assistant') continue;

    const currentMatch = findMatchedPhrase(turn.content ?? '', requiredPhrases, caseSensitive);
    if (index < triggerTurnIndex) {
      if (!allowEarly && currentMatch) {
        falsePositive = true;
      }
      continue;
    }

    assistantTurnsAfterTrigger += 1;
    if (currentMatch && firstSurfaceTurn === null) {
      firstSurfaceTurn = index + 1;
      assistantTurnLatency = assistantTurnsAfterTrigger;
      matchedPhrase = currentMatch;
    }
  }

  const withinAssistantTurnLimit =
    assistantTurnLatency !== null &&
    assistantTurnLatency <= maxAssistantTurnsAfterTrigger;
  const withinTaggedResponseWindow =
    firstResponseWindowTurn === null ||
    firstSurfaceTurn === firstResponseWindowTurn;
  const timely =
    firstSurfaceTurn !== null &&
    withinAssistantTurnLimit &&
    withinTaggedResponseWindow;

  return {
    run_id: transcript.run_id,
    condition_id: transcript.condition_id,
    trigger_seen: true,
    trigger_turn: triggerTurnIndex + 1,
    response_window_tag_used: firstResponseWindowTurn !== null,
    first_response_window_turn: firstResponseWindowTurn,
    first_surface_turn: firstSurfaceTurn,
    assistant_turn_latency: assistantTurnLatency,
    surfaced: firstSurfaceTurn !== null,
    timely,
    false_positive: falsePositive,
    matched_phrase: matchedPhrase,
    pass: timely && !falsePositive,
  };
}

function toBinaryFlag(value) {
  return value ? 1 : 0;
}

function compareLatencyImprovement(baselineLatency, treatmentLatency) {
  if (typeof baselineLatency !== 'number' || typeof treatmentLatency !== 'number') {
    return null;
  }
  return baselineLatency - treatmentLatency;
}

export function compareMarkerBenchmarkRuns({
  scenario,
  withoutVeritas,
  withVeritas,
}) {
  validateMarkerBenchmarkScenario(scenario);
  validateMarkerBenchmarkPair({
    scenario,
    transcript: withoutVeritas,
    label: 'without-veritas',
    expectedConditionId: 'without-veritas',
  });
  validateMarkerBenchmarkPair({
    scenario,
    transcript: withVeritas,
    label: 'with-veritas',
    expectedConditionId: 'with-veritas',
  });
  if (withoutVeritas.run_id === withVeritas.run_id) {
    throw new Error('marker benchmark comparison requires distinct run_id values');
  }

  const withoutVeritasScore = scoreMarkerBenchmarkCondition({
    scenario,
    transcript: withoutVeritas,
    label: 'without-veritas',
  });
  const withVeritasScore = scoreMarkerBenchmarkCondition({
    scenario,
    transcript: withVeritas,
    label: 'with-veritas',
  });
  const latencyImprovementTurns = compareLatencyImprovement(
    withoutVeritasScore.assistant_turn_latency,
    withVeritasScore.assistant_turn_latency,
  );
  const treatmentBeatsBaseline =
    (withVeritasScore.pass &&
      (!withoutVeritasScore.pass ||
        (withoutVeritasScore.false_positive && !withVeritasScore.false_positive))) ||
    (withVeritasScore.pass && withoutVeritasScore.pass && latencyImprovementTurns > 0);

  return {
    benchmark_id: scenario.id,
    title: scenario.title,
    scoring_window_assistant_turns:
      scenario.scoring.max_assistant_turns_after_trigger ?? 1,
    conditions: {
      without_veritas: withoutVeritasScore,
      with_veritas: withVeritasScore,
    },
    comparison: {
      timely_recall_delta:
        toBinaryFlag(withVeritasScore.timely) - toBinaryFlag(withoutVeritasScore.timely),
      false_positive_improvement:
        toBinaryFlag(withoutVeritasScore.false_positive) -
        toBinaryFlag(withVeritasScore.false_positive),
      latency_improvement_turns: latencyImprovementTurns,
      treatment_beats_baseline: treatmentBeatsBaseline,
    },
  };
}

function validateMarkerBenchmarkSuite(suite) {
  validateAllowedKeys(
    suite,
    ['version', 'id', 'title', 'description', 'benchmarks'],
    'marker benchmark suite',
  );
  const requiredKeys = ['version', 'id', 'title', 'benchmarks'];
  for (const key of requiredKeys) {
    if (!(key in suite)) {
      throw new Error(`marker benchmark suite is missing required key: ${key}`);
    }
  }
  validateIntegerField(suite.version, 'marker benchmark suite version', { minimum: 1 });
  validateStringField(suite.id, 'marker benchmark suite id');
  validateStringField(suite.title, 'marker benchmark suite title');
  validateOptionalStringField(suite.description, 'marker benchmark suite description');
  if (!Array.isArray(suite.benchmarks) || suite.benchmarks.length === 0) {
    throw new Error('marker benchmark suite requires at least one benchmark entry');
  }

  const benchmarkIds = new Set();
  const trialIds = new Set();

  for (const benchmark of suite.benchmarks) {
    validateAllowedKeys(
      benchmark,
      [
        'benchmark_id',
        'title',
        'description',
        'marker_class',
        'repo_surface',
        'scenario_path',
        'trials',
      ],
      'marker benchmark suite benchmark',
    );
    const requiredBenchmarkKeys = [
      'benchmark_id',
      'title',
      'marker_class',
      'repo_surface',
      'scenario_path',
      'trials',
    ];
    for (const key of requiredBenchmarkKeys) {
      if (!(key in benchmark)) {
        throw new Error(`marker benchmark suite benchmark is missing required key: ${key}`);
      }
    }
    validateStringField(
      benchmark.benchmark_id,
      'marker benchmark suite benchmark benchmark_id',
    );
    validateStringField(benchmark.title, 'marker benchmark suite benchmark title');
    validateOptionalStringField(
      benchmark.description,
      'marker benchmark suite benchmark description',
    );
    validateStringField(
      benchmark.marker_class,
      'marker benchmark suite benchmark marker_class',
    );
    validateStringField(
      benchmark.repo_surface,
      'marker benchmark suite benchmark repo_surface',
    );
    validateStringField(
      benchmark.scenario_path,
      'marker benchmark suite benchmark scenario_path',
    );
    if (benchmarkIds.has(benchmark.benchmark_id)) {
      throw new Error(
        `marker benchmark suite benchmark_id must be unique: ${benchmark.benchmark_id}`,
      );
    }
    benchmarkIds.add(benchmark.benchmark_id);
    if (!Array.isArray(benchmark.trials) || benchmark.trials.length === 0) {
      throw new Error(
        `marker benchmark suite benchmark ${benchmark.benchmark_id} requires at least one trial`,
      );
    }
    for (const trial of benchmark.trials) {
      validateAllowedKeys(
        trial,
        ['trial_id', 'without_veritas_transcript_path', 'with_veritas_transcript_path'],
        'marker benchmark suite trial',
      );
      const requiredTrialKeys = [
        'trial_id',
        'without_veritas_transcript_path',
        'with_veritas_transcript_path',
      ];
      for (const key of requiredTrialKeys) {
        if (!(key in trial)) {
          throw new Error(`marker benchmark suite trial is missing required key: ${key}`);
        }
      }
      validateStringField(trial.trial_id, 'marker benchmark suite trial trial_id');
      validateStringField(
        trial.without_veritas_transcript_path,
        'marker benchmark suite trial without_veritas_transcript_path',
      );
      validateStringField(
        trial.with_veritas_transcript_path,
        'marker benchmark suite trial with_veritas_transcript_path',
      );
      if (trialIds.has(trial.trial_id)) {
        throw new Error(
          `marker benchmark suite trial_id must be unique: ${trial.trial_id}`,
        );
      }
      trialIds.add(trial.trial_id);
    }
  }
}

function resolveSuiteArtifactPath(suitePath, artifactPath) {
  return resolve(dirname(suitePath), artifactPath);
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

function buildBenchmarkPassMetrics(trialComparisons) {
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

function buildMarkerBenchmarkAggregateMetrics(trials, benchmarkSummaries = []) {
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

function buildMarkerBenchmarkSummary(benchmark, trialComparisons) {
  const passMetrics = buildBenchmarkPassMetrics(trialComparisons);
  const metrics = {
    ...buildMarkerBenchmarkAggregateMetrics(trialComparisons, []),
    ...passMetrics,
  };

  return {
    benchmark_id: benchmark.benchmark_id,
    title: benchmark.title,
    marker_class: benchmark.marker_class,
    repo_surface: benchmark.repo_surface,
    trial_count: trialComparisons.length,
    metrics,
    trials: trialComparisons,
  };
}

export function buildMarkerBenchmarkSuiteReport({ suite, suitePath }) {
  validateMarkerBenchmarkSuite(suite);

  const benchmarkSummaries = suite.benchmarks.map((benchmark) => {
    const scenarioPath = resolveSuiteArtifactPath(suitePath, benchmark.scenario_path);
    const scenario = loadMarkerBenchmarkScenario(scenarioPath);
    if (scenario.id !== benchmark.benchmark_id) {
      throw new Error(
        `marker benchmark suite benchmark_id ${benchmark.benchmark_id} must match scenario id ${scenario.id}`,
      );
    }

    const trialComparisons = benchmark.trials.map((trial) => ({
      trial_id: trial.trial_id,
      comparison: compareMarkerBenchmarkRuns({
        scenario,
        withoutVeritas: loadMarkerBenchmarkTranscript(
          resolveSuiteArtifactPath(suitePath, trial.without_veritas_transcript_path),
        ),
        withVeritas: loadMarkerBenchmarkTranscript(
          resolveSuiteArtifactPath(suitePath, trial.with_veritas_transcript_path),
        ),
      }),
    }));

    return buildMarkerBenchmarkSummary(benchmark, trialComparisons);
  });

  const allTrialComparisons = benchmarkSummaries.flatMap((benchmark) => benchmark.trials);

  return {
    suite_id: suite.id,
    title: suite.title,
    scenario_count: benchmarkSummaries.length,
    pair_count: allTrialComparisons.length,
    metrics: buildMarkerBenchmarkAggregateMetrics(allTrialComparisons, benchmarkSummaries),
    benchmarks: benchmarkSummaries,
  };
}

export function generateMarkerBenchmarkSuiteReport(options = {}, defaults = {}) {
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (!options.suitePath) {
    throw new Error('veritas eval marker-suite requires --suite <path>');
  }

  const suitePath = resolve(rootDir, options.suitePath);
  const suite = loadMarkerBenchmarkSuite(suitePath);
  const report = buildMarkerBenchmarkSuiteReport({
    suite,
    suitePath,
  });

  return report;
}


export function generateMarkerBenchmarkComparison(options = {}, defaults = {}) {
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (!options.scenarioPath) {
    throw new Error('veritas eval marker requires --scenario <path>');
  }
  if (!options.withoutVeritasTranscriptPath) {
    throw new Error(
      'veritas eval marker requires --without-veritas-transcript <path>',
    );
  }
  if (!options.withVeritasTranscriptPath) {
    throw new Error(
      'veritas eval marker requires --with-veritas-transcript <path>',
    );
  }

  const scenarioPath = resolve(rootDir, options.scenarioPath);
  const withoutVeritasTranscriptPath = resolve(
    rootDir,
    options.withoutVeritasTranscriptPath,
  );
  const withVeritasTranscriptPath = resolve(rootDir, options.withVeritasTranscriptPath);

  const scenario = loadMarkerBenchmarkScenario(scenarioPath);
  const withoutVeritas = loadMarkerBenchmarkTranscript(withoutVeritasTranscriptPath);
  const withVeritas = loadMarkerBenchmarkTranscript(withVeritasTranscriptPath);

  return compareMarkerBenchmarkRuns({
    scenario,
    withoutVeritas,
    withVeritas,
  });
}

