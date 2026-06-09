import { dirname, isAbsolute, resolve } from 'node:path';
import {
  loadMarkerBenchmarkScenario,
  loadMarkerBenchmarkSessionLog,
  loadMarkerBenchmarkSuite,
} from '../load.mjs';
import { assertWithinDir } from '../paths.mjs';
import { uniqueStrings } from '../util/strings.mjs';
import {
  validateMarkerBenchmarkPair,
  validateMarkerBenchmarkScenario,
  validateMarkerBenchmarkSessionLog,
  validateMarkerBenchmarkSuite,
} from './marker-benchmark/validation.mjs';
import {
  buildBenchmarkPassMetrics,
  buildMarkerBenchmarkAggregateMetrics,
  buildMarkerBenchmarkComparisonMetrics,
  compareLatencyImprovement,
} from './marker-benchmark/metrics.mjs';

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
  sessionLog,
  label = 'marker benchmark',
}) {
  validateMarkerBenchmarkScenario(scenario);
  validateMarkerBenchmarkSessionLog(sessionLog, label);

  const triggerTag = scenario.scoring.trigger_tag;
  const responseTag = 'response_tag' in scenario.scoring ? scenario.scoring.response_tag : null;
  const maxAssistantTurnsAfterTrigger = scenario.scoring.max_assistant_turns_after_trigger;
  const allowEarly = scenario.scoring.allow_early;
  const caseSensitive = scenario.scoring.case_sensitive === true;
  const requiredPhrases = uniqueStrings(scenario.marker.required_phrases);
  const triggerTurnIndices = collectTaggedTurnIndices(sessionLog.turns, triggerTag);
  if (triggerTurnIndices.length !== 1) {
    throw new Error(`${label} session log must include exactly one trigger tag ${triggerTag}`);
  }
  const triggerTurnIndex = triggerTurnIndices[0];
  const allResponseTurnIndices =
    responseTag === null
      ? []
      : collectTaggedTurnIndices(sessionLog.turns, responseTag);
  const responseTurnIndices =
    responseTag === null
      ? []
      : collectTaggedTurnIndices(sessionLog.turns, responseTag, 'assistant');
  if (responseTag !== null && allResponseTurnIndices.length !== 1) {
    throw new Error(
      `${label} session log must include exactly one response tag ${responseTag}`,
    );
  }
  if (responseTag !== null && responseTurnIndices.length !== 1) {
    throw new Error(
      `${label} session log must include exactly one assistant response tag ${responseTag}`,
    );
  }
  const firstResponseWindowTurn = responseTurnIndices[0] !== undefined ? responseTurnIndices[0] + 1 : null;

  let assistantTurnsAfterTrigger = 0;
  let firstSurfaceTurn = null;
  let assistantTurnLatency = null;
  let matchedPhrase = null;
  let falsePositive = false;

  for (let index = 0; index < sessionLog.turns.length; index += 1) {
    const turn = sessionLog.turns[index];
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
    run_id: sessionLog.run_id,
    condition_id: sessionLog.condition_id,
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

export function compareMarkerBenchmarkRuns({
  scenario,
  withoutVeritas,
  withVeritas,
}) {
  validateMarkerBenchmarkScenario(scenario);
  validateMarkerBenchmarkPair({
    scenario,
    sessionLog: withoutVeritas,
    label: 'without-veritas',
    expectedConditionId: 'without-veritas',
  });
  validateMarkerBenchmarkPair({
    scenario,
    sessionLog: withVeritas,
    label: 'with-veritas',
    expectedConditionId: 'with-veritas',
  });
  if (withoutVeritas.run_id === withVeritas.run_id) {
    throw new Error('marker benchmark comparison requires distinct run_id values');
  }

  const withoutVeritasScore = scoreMarkerBenchmarkCondition({
    scenario,
    sessionLog: withoutVeritas,
    label: 'without-veritas',
  });
  const withVeritasScore = scoreMarkerBenchmarkCondition({
    scenario,
    sessionLog: withVeritas,
    label: 'with-veritas',
  });
  const latencyImprovementTurns = compareLatencyImprovement(
    withoutVeritasScore.assistant_turn_latency,
    withVeritasScore.assistant_turn_latency,
  );

  return {
    benchmark_id: scenario.id,
    title: scenario.title,
    scoring_window_assistant_turns:
      scenario.scoring.max_assistant_turns_after_trigger ?? 1,
    conditions: {
      without_veritas: withoutVeritasScore,
      with_veritas: withVeritasScore,
    },
    comparison: buildMarkerBenchmarkComparisonMetrics({
      withoutVeritasScore,
      withVeritasScore,
      latencyImprovementTurns,
    }),
  };
}

function resolveSuiteArtifactPath(suitePath, artifactPath) {
  const suiteDir = dirname(suitePath);
  const benchmarkRootDir = dirname(suiteDir);
  if (isAbsolute(artifactPath)) {
    throw new Error('marker benchmark suite artifact paths must be relative');
  }
  const resolvedArtifactPath = resolve(suiteDir, artifactPath);
  assertWithinDir(
    resolvedArtifactPath,
    benchmarkRootDir,
    'marker benchmark suite artifact paths must stay inside the benchmark directory',
  );
  return resolvedArtifactPath;
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
        withoutVeritas: loadMarkerBenchmarkSessionLog(
          resolveSuiteArtifactPath(suitePath, trial.without_veritas_session_log_path),
        ),
        withVeritas: loadMarkerBenchmarkSessionLog(
          resolveSuiteArtifactPath(suitePath, trial.with_veritas_session_log_path),
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
    throw new Error('veritas feedback marker-suite requires --suite <path>');
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
    throw new Error('veritas feedback marker requires --scenario <path>');
  }
  if (!options.withoutVeritasSessionLogPath) {
    throw new Error(
      'veritas feedback marker requires --without-veritas-session-log <path>',
    );
  }
  if (!options.withVeritasSessionLogPath) {
    throw new Error(
      'veritas feedback marker requires --with-veritas-session-log <path>',
    );
  }

  const scenarioPath = resolve(rootDir, options.scenarioPath);
  const withoutVeritasSessionLogPath = resolve(
    rootDir,
    options.withoutVeritasSessionLogPath,
  );
  const withVeritasSessionLogPath = resolve(rootDir, options.withVeritasSessionLogPath);

  const scenario = loadMarkerBenchmarkScenario(scenarioPath);
  const withoutVeritas = loadMarkerBenchmarkSessionLog(withoutVeritasSessionLogPath);
  const withVeritas = loadMarkerBenchmarkSessionLog(withVeritasSessionLogPath);

  return compareMarkerBenchmarkRuns({
    scenario,
    withoutVeritas,
    withVeritas,
  });
}
