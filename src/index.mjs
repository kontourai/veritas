import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  loadJson,
  loadAdapterConfig,
  loadPolicyPack,
  loadTeamProfile,
  loadEvidenceArtifact,
  loadEvalDraftArtifact,
  loadMarkerBenchmarkScenario,
  loadMarkerBenchmarkTranscript,
  loadMarkerBenchmarkSuite,
} from './load.mjs';
import {
  parseTokens,
  parseArgs,
  parseBudgetArgs,
  parseInitArgs,
  parsePrintArgs,
  parseApplyArgs,
  parseEvalArgs,
  parseMarkerEvalArgs,
  parseMarkerSuiteEvalArgs,
  parseShadowArgs,
} from './args.mjs';
import { assertWithinDir, normalizeRepoPath, relativeRepoPath } from './paths.mjs';
import {
  slugifyProjectName,
  inferBootstrapRepoInsights,
  buildStarterAdapter,
  buildStarterPolicyPack,
  buildStarterTeamProfile,
  buildBootstrapReadme,
  buildInitRecommendation,
  writeBootstrapStarterKit,
  applyInitRecommendation,
  buildSuggestedPackageScripts,
  buildSuggestedCiSnippet,
} from './bootstrap.mjs';
import { shellQuote, runProofCommand } from './shell.mjs';
import {
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
  buildSuggestedCodexHookConfig,
  inspectCodexHookTarget,
  applyPackageScripts,
  applyCiSnippet,
  applyGitHook,
  applyRuntimeHook,
  applyStopHook,
  inspectRuntimeAdapterStatus,
  applyCodexHook,
} from './hooks.mjs';
import {
  applyGovernanceBlocks,
  buildGovernanceBlock,
  inspectGovernanceBlockFile,
} from './governance.mjs';

export {
  loadJson,
  loadAdapterConfig,
  loadPolicyPack,
  loadTeamProfile,
  loadEvidenceArtifact,
  loadEvalDraftArtifact,
  loadMarkerBenchmarkScenario,
  loadMarkerBenchmarkTranscript,
  loadMarkerBenchmarkSuite,
  parseTokens,
  parseArgs,
  parseBudgetArgs,
  parseInitArgs,
  parsePrintArgs,
  parseApplyArgs,
  parseEvalArgs,
  parseMarkerEvalArgs,
  parseMarkerSuiteEvalArgs,
  parseShadowArgs,
  normalizeRepoPath,
  slugifyProjectName,
  inferBootstrapRepoInsights,
  buildStarterAdapter,
  buildStarterPolicyPack,
  buildStarterTeamProfile,
  buildBootstrapReadme,
  buildInitRecommendation,
  writeBootstrapStarterKit,
  applyInitRecommendation,
  buildSuggestedPackageScripts,
  buildSuggestedCiSnippet,
  buildSuggestedGitHook,
  buildSuggestedRuntimeHook,
  buildSuggestedStopHook,
  buildSuggestedCodexHookConfig,
  buildGovernanceBlock,
  applyGovernanceBlocks,
  applyPackageScripts,
  applyCiSnippet,
  applyGitHook,
  applyRuntimeHook,
  applyStopHook,
  inspectRuntimeAdapterStatus,
  applyCodexHook,
};

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function matchesPatterns(filePath, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith('/') ? filePath.startsWith(pattern) : filePath === pattern,
  );
}

export function matchesPatternsForAnyFile(files, patterns) {
  return files.some((file) => matchesPatterns(file, patterns));
}

function uniqueStrings(items = []) {
  return [...new Set(items.filter((item) => typeof item === 'string' && item.length > 0))];
}

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

export function classifyNodes(files, config, rootDir) {
  const matchedNodeIds = new Set();
  const matchedLaneLabels = new Set();
  const unmatchedFiles = [];

  for (const file of files) {
    const normalized = normalizeRepoPath(file, rootDir);
    let matched = false;
    for (const node of config.graph.nodes) {
      if (matchesPatterns(normalized, node.patterns)) {
        matchedNodeIds.add(node.id);
        matchedLaneLabels.add(node.label);
        matched = true;
      }
    }
    if (!matched) {
      unmatchedFiles.push(normalized);
    }
  }

  return {
    affectedNodes: [...matchedNodeIds].sort(),
    affectedLanes: [...matchedLaneLabels].sort(),
    unmatchedFiles,
  };
}

function readSurfaceProofRoutes(config) {
  assertV2ProofLaneConfig(config);
  return Array.isArray(config.evidence?.surfaceProofRoutes)
    ? config.evidence.surfaceProofRoutes
    : [];
}

function readProofLanes(config) {
  assertV2ProofLaneConfig(config);
  return Array.isArray(config.evidence?.proofLanes) ? config.evidence.proofLanes : [];
}

function readDefaultProofLaneIds(config) {
  assertV2ProofLaneConfig(config);
  return uniqueStrings(config.evidence?.defaultProofLaneIds ?? []);
}

function readRequiredProofLaneIds(config) {
  assertV2ProofLaneConfig(config);
  return uniqueStrings(config.evidence?.requiredProofLaneIds ?? []);
}

function proofLaneById(config) {
  return new Map(readProofLanes(config).map((lane) => [lane.id, lane]));
}

function proofCommandsForLaneIds(config, laneIds) {
  const lanes = proofLaneById(config);
  return uniqueStrings(laneIds.map((id) => lanes.get(id)?.command).filter(Boolean));
}

function proofLaneRecordsForCommands(config, commands) {
  const lanes = readProofLanes(config);
  return commands.map((command) => {
    const lane = lanes.find((item) => item.command === command);
    return lane ?? {
      id: command.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'explicit-proof',
      command,
      method: 'validation',
      summary: `Explicit proof command: ${command}`,
    };
  });
}

function readProofFamilyManifestPaths(config) {
  return uniqueStrings(config.evidence?.proofFamilyManifests ?? []);
}

const PROOF_FAMILY_DISPOSITIONS = [
  'required',
  'candidate',
  'advisory',
  'move-to-test',
  'retire',
  'upstream-abstraction',
];

function readProofFamilyField(family, camelKey, snakeKey, fallback = null) {
  if (family[camelKey] !== undefined) return family[camelKey];
  if (snakeKey && family[snakeKey] !== undefined) return family[snakeKey];
  return fallback;
}

function assertProofFamilyString(value, label, { required = true } = {}) {
  if (!required && (value === undefined || value === null)) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function normalizeProofFamilyDisposition(family) {
  const disposition = family.defaultDisposition ?? family.disposition ?? 'candidate';
  if (family.currentBlockingStatus === 'required' || disposition === 'required') return 'required';
  if (disposition === 'retire') return 'retire';
  if (disposition === 'move-to-test') return 'move-to-test';
  if (disposition === 'upstream-abstraction') return 'upstream-abstraction';
  if (family.currentBlockingStatus === 'advisory' || disposition === 'advisory') return 'advisory';
  return 'candidate';
}

function validateProofFamilyManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`proof-family manifest must be an object: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.families) || manifest.families.length === 0) {
    throw new Error(`proof-family manifest requires a non-empty families array: ${manifestPath}`);
  }

  const ids = new Set();
  for (const family of manifest.families) {
    if (!family || typeof family !== 'object' || Array.isArray(family)) {
      throw new Error(`proof-family manifest family must be an object: ${manifestPath}`);
    }
    assertProofFamilyString(family.id, `proof-family id in ${manifestPath}`);
    if (ids.has(family.id)) {
      throw new Error(`proof-family manifest contains duplicate family id: ${family.id}`);
    }
    ids.add(family.id);

    const rawDisposition = family.defaultDisposition ?? family.disposition;
    if (rawDisposition !== undefined && !PROOF_FAMILY_DISPOSITIONS.includes(rawDisposition)) {
      throw new Error(`proof-family ${family.id} has unsupported defaultDisposition: ${rawDisposition}`);
    }

    const disposition = normalizeProofFamilyDisposition(family);
    if (!PROOF_FAMILY_DISPOSITIONS.includes(disposition)) {
      throw new Error(`proof-family ${family.id} has unsupported disposition: ${disposition}`);
    }

    const required = disposition === 'required' || family.currentBlockingStatus === 'required';
    assertProofFamilyString(
      readProofFamilyField(family, 'laneId', 'lane_id', manifest.sourceProofLaneId),
      `proof-family ${family.id} laneId`,
    );
    assertProofFamilyString(family.owner, `proof-family ${family.id} owner`, { required });
    assertProofFamilyString(
      readProofFamilyField(family, 'expiryOrReviewTrigger', 'review_trigger'),
      `proof-family ${family.id} review trigger`,
      { required },
    );
    if (
      required &&
      readProofFamilyField(family, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown') === 'unknown'
    ) {
      throw new Error(`proof-family ${family.id} cannot be required with unknown recent catch evidence`);
    }
  }
}

function verificationWeightForDisposition(disposition) {
  if (disposition === 'required') return 'blocking';
  if (disposition === 'candidate' || disposition === 'move-to-test' || disposition === 'upstream-abstraction') {
    return 'advisory';
  }
  return 'informational';
}

function loadProofFamilyResults(config, rootDir, selectedProofLaneIds = []) {
  const selectedIds = new Set(selectedProofLaneIds);
  return readProofFamilyManifestPaths(config).flatMap((manifestPath) => {
    const resolvedManifestPath = resolve(rootDir, manifestPath);
    assertWithinDir(
      resolvedManifestPath,
      resolve(rootDir, '.veritas'),
      'proof-family manifests must live inside .veritas/',
    );
    const manifest = loadJson(resolvedManifestPath, 'proof-family manifest');
    const relativeManifestPath = relativeRepoPath(rootDir, resolvedManifestPath);
    validateProofFamilyManifest(manifest, relativeManifestPath);
    return (manifest.families ?? []).map((family) => {
      const disposition = normalizeProofFamilyDisposition(family);
      const laneId = family.laneId ?? family.proofLaneId ?? manifest.sourceProofLaneId ?? 'unknown';
      const recentCatchEvidence = readProofFamilyField(
        family,
        'recentCatchEvidence',
        'recent_catch_evidence',
        'unknown',
      );
      const reviewTrigger = readProofFamilyField(
        family,
        'expiryOrReviewTrigger',
        'review_trigger',
        null,
      );
      const lastReviewed = readProofFamilyField(family, 'lastReviewed', 'last_reviewed', null);
      const evidenceBasis = readProofFamilyField(
        family,
        'evidenceBasis',
        'evidence_basis',
        recentCatchEvidence === 'unknown' ? 'unknown' : 'recorded-catch-evidence',
      );
      const freshnessStatus =
        readProofFamilyField(family, 'freshnessStatus', 'freshness_status') ??
        (disposition === 'retire'
          ? 'retiring'
          : !reviewTrigger || recentCatchEvidence === 'unknown'
            ? 'review-needed'
            : 'current');
      return {
        id: family.id,
        lane_id: laneId,
        source_proof_lane_id: manifest.sourceProofLaneId ?? null,
        manifest_path: relativeManifestPath,
        destination: family.destination ?? null,
        owner: family.owner ?? null,
        disposition,
        blocking_status: family.currentBlockingStatus ?? disposition,
        verification_weight: verificationWeightForDisposition(disposition),
        selected: selectedIds.has(laneId),
        recent_catch_evidence: recentCatchEvidence,
        regression_severity: family.regressionSeverity ?? 'unknown',
        false_positive_risk: family.falsePositiveRisk ?? 'unknown',
        replacement_test_available: family.replacementTestAvailable ?? null,
        review_trigger: reviewTrigger,
        last_reviewed: lastReviewed,
        evidence_basis: evidenceBasis,
        freshness_status: freshnessStatus,
        rationale: family.rationale ?? '',
      };
    });
  });
}

export function buildVerificationBudget({ proofLanes, proofFamilyResults }) {
  const laneCount = proofLanes.length;
  const selectedLaneCount = proofLanes.filter((lane) => lane.selected).length;
  const requiredFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'required',
  ).length;
  const candidateFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'candidate',
  ).length;
  const advisoryFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'advisory',
  ).length;
  const moveToTestFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'move-to-test',
  ).length;
  const retireFamilyCount = proofFamilyResults.filter(
    (family) => family.disposition === 'retire',
  ).length;
  const upstreamCandidateCount = proofFamilyResults.filter(
    (family) => family.disposition === 'upstream-abstraction',
  ).length;

  const unknownCatchEvidenceFamilies = proofFamilyResults
    .filter((family) => family.recent_catch_evidence === 'unknown')
    .map((family) => family.id);
  const missingReviewTriggerFamilies = proofFamilyResults
    .filter((family) => !family.review_trigger)
    .map((family) => family.id);
  const staleFamilies = proofFamilyResults
    .filter(
      (family) =>
        family.freshness_status === 'review-needed' ||
        family.freshness_status === 'stale' ||
        family.disposition === 'retire'
    )
    .map((family) => family.id);
  const staleOrUnknownFamilies = uniqueStrings([
    ...unknownCatchEvidenceFamilies,
    ...missingReviewTriggerFamilies,
    ...staleFamilies,
  ]);

  return {
    proof_lane_count: laneCount,
    selected_proof_lane_count: selectedLaneCount,
    proof_family_count: proofFamilyResults.length,
    required_family_count: requiredFamilyCount,
    candidate_family_count: candidateFamilyCount,
    advisory_family_count: advisoryFamilyCount,
    move_to_test_family_count: moveToTestFamilyCount,
    retire_family_count: retireFamilyCount,
    upstream_candidate_count: upstreamCandidateCount,
    unknown_catch_evidence_family_ids: unknownCatchEvidenceFamilies,
    missing_review_trigger_family_ids: missingReviewTriggerFamilies,
    stale_family_ids: staleFamilies,
    stale_or_unknown_family_ids: staleOrUnknownFamilies,
    recommendation:
      staleOrUnknownFamilies.length > 0
        ? 'Review unknown, retiring, or triggerless proof families before promoting more checks.'
        : 'Verification budget has owners, review triggers, and no unknown catch-evidence families.',
  };
}

function assertV2ProofLaneConfig(config) {
  const evidence = config.evidence ?? {};
  const legacyFields = ['requiredProofLanes', 'defaultProofLanes', 'surfaceProofLanes'].filter((field) => field in evidence);
  if (legacyFields.length > 0) {
    throw new Error(
      `Veritas adapter proof lane config uses legacy field(s): ${legacyFields.join(', ')}. Migrate to evidence.proofLanes[].command, requiredProofLaneIds, defaultProofLaneIds, and surfaceProofRoutes; see docs/reference/artifacts-and-schemas.md#adapter-proof-lane-migration.`,
    );
  }

  if (!Array.isArray(evidence.proofLanes) || evidence.proofLanes.length === 0) {
    throw new Error('Veritas adapter evidence.proofLanes must contain proof-lane objects with id, command, and method.');
  }

  const laneIds = new Set();
  for (const lane of evidence.proofLanes) {
    assertProofLaneObject(lane);
    if (laneIds.has(lane.id)) throw new Error(`Veritas adapter evidence.proofLanes contains duplicate id: ${lane.id}`);
    laneIds.add(lane.id);
  }

  for (const field of ['requiredProofLaneIds', 'defaultProofLaneIds']) {
    for (const id of uniqueStrings(evidence[field] ?? [])) {
      if (!laneIds.has(id)) throw new Error(`Veritas adapter evidence.${field} references unknown proof lane id: ${id}`);
    }
  }

  for (const route of evidence.surfaceProofRoutes ?? []) {
    if (!Array.isArray(route.proofLaneIds)) {
      throw new Error('Veritas adapter evidence.surfaceProofRoutes[].proofLaneIds must reference proof lane ids.');
    }
    for (const id of uniqueStrings(route.proofLaneIds)) {
      if (!laneIds.has(id)) throw new Error(`Veritas adapter surface proof route references unknown proof lane id: ${id}`);
    }
  }

  for (const manifestPath of readProofFamilyManifestPaths(config)) {
    if (manifestPath.startsWith('/') || manifestPath.includes('..')) {
      throw new Error('Veritas adapter evidence.proofFamilyManifests must contain repo-local paths inside .veritas/.');
    }
    if (!manifestPath.startsWith('.veritas/')) {
      throw new Error('Veritas adapter evidence.proofFamilyManifests paths must start with .veritas/.');
    }
  }
}

function assertProofLaneObject(lane) {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) {
    throw new Error('Veritas adapter evidence.proofLanes entries must be objects.');
  }
  for (const field of ['id', 'command', 'method']) {
    if (typeof lane[field] !== 'string' || lane[field].length === 0) {
      throw new Error(`Veritas adapter evidence.proofLanes[].${field} must be a non-empty string.`);
    }
  }
  if (!['observation', 'extraction', 'validation', 'corroboration', 'attestation', 'auditability', 'anchoring', 'monitoring'].includes(lane.method)) {
    throw new Error(`Veritas adapter evidence.proofLanes[].method contains unsupported value: ${lane.method}`);
  }
  if (lane.surfaceClaimIds !== undefined && !Array.isArray(lane.surfaceClaimIds)) {
    throw new Error('Veritas adapter evidence.proofLanes[].surfaceClaimIds must be an array of strings.');
  }
}

function readUncoveredPathPolicy(config) {
  const policy = config.evidence?.uncoveredPathPolicy;
  if (policy === 'ignore' || policy === 'fail') {
    return policy;
  }
  return 'warn';
}

function routeMatchesAnyNode(route, affectedNodes) {
  return (route.nodeIds ?? []).some((nodeId) => affectedNodes.includes(nodeId));
}

function serializeSurfaceProofRoutes(config) {
  return readSurfaceProofRoutes(config).map((route) => ({
    node_ids: uniqueStrings(route.nodeIds ?? []),
    proof_lane_ids: uniqueStrings(route.proofLaneIds ?? []),
  }));
}

export function resolveProofPlan({
  files,
  config,
  rootDir,
  explicitProofCommand,
}) {
  const { affectedNodes, affectedLanes, unmatchedFiles } = classifyNodes(files, config, rootDir);
  const uncoveredPathPolicy = readUncoveredPathPolicy(config);
  const surfaceRoutes = readSurfaceProofRoutes(config);
  const matchedRoutes = surfaceRoutes.filter((route) => routeMatchesAnyNode(route, affectedNodes));
  let proofCommands = [];
  let resolutionSource = 'none';

  if (explicitProofCommand) {
    proofCommands = [explicitProofCommand];
    resolutionSource = 'explicit';
  } else if (matchedRoutes.length > 0) {
    const routedNodeIds = new Set(
      matchedRoutes.flatMap((route) => (route.nodeIds ?? []).filter((nodeId) => affectedNodes.includes(nodeId))),
    );
    proofCommands = proofCommandsForLaneIds(config, uniqueStrings(matchedRoutes.flatMap((route) => route.proofLaneIds ?? [])));
    if (affectedNodes.some((nodeId) => !routedNodeIds.has(nodeId))) {
      const defaultProofLaneIds = readDefaultProofLaneIds(config);
      const requiredProofLaneIds = readRequiredProofLaneIds(config);
      proofCommands = uniqueStrings([
        ...proofCommands,
        ...proofCommandsForLaneIds(config, defaultProofLaneIds.length > 0 ? defaultProofLaneIds : requiredProofLaneIds),
      ]);
    }
    resolutionSource = 'surface';
  } else {
    const defaultProofLaneIds = readDefaultProofLaneIds(config);
    const requiredProofLaneIds = readRequiredProofLaneIds(config);

    if (defaultProofLaneIds.length > 0) {
      proofCommands = proofCommandsForLaneIds(config, defaultProofLaneIds);
      resolutionSource = 'default';
    } else if (requiredProofLaneIds.length > 0) {
      proofCommands = proofCommandsForLaneIds(config, requiredProofLaneIds);
      resolutionSource = 'required';
    }
  }

  return {
    affectedNodes,
    affectedLanes,
    unmatchedFiles,
    uncoveredPathPolicy,
    uncoveredPathResult: unmatchedFiles.length > 0 ? uncoveredPathPolicy : 'clear',
    proofCommands,
    proofLanes: proofLaneRecordsForCommands(config, proofCommands),
    resolutionSource,
  };
}

export function resolveWorkstream(options, config, normalizedFiles = []) {
  if (options.workstream) {
    const resolvedPhase =
      options.phase ??
      config.graph.activePhase ??
      config.graph.defaultResolution?.phase;
    return {
      resolvedPhase,
      resolvedWorkstream: options.workstream,
      matchedArtifacts: ['explicit-workstream'],
      promotionAllowed: options.workstream !== 'multi-workstream',
    };
  }

  for (const rule of config.graph.resolutionRules ?? []) {
    if (matchesPatternsForAnyFile(normalizedFiles, rule.match.patterns)) {
      return {
        resolvedPhase: rule.resolution.phase,
        resolvedWorkstream: rule.resolution.workstream,
        matchedArtifacts: rule.resolution.matchedArtifacts,
        promotionAllowed: true,
      };
    }
  }

  const defaultResolution = config.graph.defaultResolution;
  return {
    resolvedPhase: defaultResolution.phase,
    resolvedWorkstream: defaultResolution.workstream,
    matchedArtifacts: defaultResolution.matchedArtifacts,
    promotionAllowed: true,
  };
}

export function parseBaselineCiFastStatus(status) {
  if (status === 'success') return true;
  if (status === 'failed') return false;
  return null;
}

export function formatTriState(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

export function buildEvidenceRecord({
  files,
  options = {},
  config,
  policyPack,
  rootDir,
}) {
  const frameworkVersion = config.frameworkVersion ?? config.graph?.version;
  const runId = options.runId ?? `veritas-${Date.now()}`;
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalizedFiles = files.map((file) => normalizeRepoPath(file, rootDir));
  const proofPlan =
    options.proofPlan ??
    resolveProofPlan({
      files,
      config,
      rootDir,
      explicitProofCommand: options.explicitProofCommand,
    });
  const { affectedNodes, affectedLanes, unmatchedFiles } = proofPlan;
  const unresolvedMessage =
    proofPlan.uncoveredPathResult === 'fail'
      ? 'Some files do not match a configured surface and fail the uncovered-path policy.'
      : proofPlan.uncoveredPathResult === 'ignore'
        ? 'Some files do not match a configured surface and were ignored by policy.'
        : 'Some files do not match a configured surface and need manual review.';
  const recommendations = unmatchedFiles.length
    ? [
        {
          kind: 'unmatched-files',
          severity: proofPlan.uncoveredPathResult,
          message: unresolvedMessage,
          files: unmatchedFiles,
        },
      ]
    : [];
  const resolution = resolveWorkstream(options, config, normalizedFiles);
  const baselineCiFastPassed = parseBaselineCiFastStatus(
    options.baselineCiFastStatus,
  );
  const policyDefaults = {
    false_positive_review: config.policy?.defaultFalsePositiveReview ?? 'unknown',
    promotion_candidate: config.policy?.defaultPromotionCandidate ?? false,
    override_or_bypass: config.policy?.defaultOverrideOrBypass ?? false,
  };
  const adapterName = config.name ?? config.adapter?.name;
  const adapterKind = config.kind ?? config.adapter?.kind;
  const resolvedPolicyPack =
    policyPack ??
    (() => {
      throw new Error('buildEvidenceRecord requires a policyPack');
    })();
  const policyResults =
    options.policyResults ??
    evaluatePolicyPack(resolvedPolicyPack, {
      rootDir,
      changedFiles: normalizedFiles,
    });
  const selectedProofLanes = (
    proofPlan.proofLanes ?? proofLaneRecordsForCommands(config, proofPlan.proofCommands)
  ).map((lane) => ({
    id: lane.id,
    command: lane.command,
    method: lane.method,
    surface_claim_ids: uniqueStrings(lane.surfaceClaimIds ?? []),
    summary: lane.summary ?? `Proof lane ${lane.id}: ${lane.command}`,
  }));
  const selectedProofLaneIds = selectedProofLanes.map((lane) => lane.id);
  const proofFamilyResults = loadProofFamilyResults(config, rootDir, selectedProofLaneIds);
  const allProofLanes = readProofLanes(config).map((lane) => ({
    id: lane.id,
    command: lane.command,
    method: lane.method,
    surface_claim_ids: uniqueStrings(lane.surfaceClaimIds ?? []),
    summary: lane.summary ?? '',
    selected: selectedProofLaneIds.includes(lane.id),
  }));

  return {
    framework_version: frameworkVersion,
    run_id: runId,
    timestamp,
    source_ref: options.sourceRef ?? 'local-dry-run',
    source_kind: options.sourceKind ?? 'explicit-files',
    source_scope: options.sourceScope ?? ['explicit'],
    resolved_phase: resolution.resolvedPhase,
    resolved_workstream: resolution.resolvedWorkstream,
    matched_artifacts: resolution.matchedArtifacts,
    affected_nodes: affectedNodes,
    affected_lanes: affectedLanes,
    selected_proof_commands: proofPlan.proofCommands,
    selected_proof_lanes: selectedProofLanes,
    proof_resolution_source: proofPlan.resolutionSource,
    proof_family_results: proofFamilyResults,
    verification_budget: buildVerificationBudget({
      proofLanes: allProofLanes,
      proofFamilyResults,
    }),
    uncovered_path_result: proofPlan.uncoveredPathResult,
    baseline_ci_fast_passed: baselineCiFastPassed,
    recommendations,
    false_positive_review: policyDefaults.false_positive_review,
    promotion_candidate: policyDefaults.promotion_candidate,
    override_or_bypass: policyDefaults.override_or_bypass,
    owner: options.owner ?? null,
    files: normalizedFiles,
    unresolved_files: unmatchedFiles,
    promotion_allowed: resolution.promotionAllowed,
    framework: {
      version: frameworkVersion,
      resolver_precedence: config.graph.resolverPrecedence,
      policy_defaults: policyDefaults,
    },
    adapter: {
      name: adapterName,
      kind: adapterKind,
      report_transport: config.evidence.reportTransport,
      default_resolution: config.graph.defaultResolution,
      non_sliceable_invariants: config.graph.nonSliceableInvariants,
      proof_lanes: allProofLanes.map(({ selected, ...lane }) => lane),
      required_proof_lane_ids: readRequiredProofLaneIds(config),
      default_proof_lane_ids: readDefaultProofLaneIds(config),
      surface_proof_lanes: serializeSurfaceProofRoutes(config),
      uncovered_path_policy: proofPlan.uncoveredPathPolicy,
    },
    policy_pack: {
      name: resolvedPolicyPack.name,
      version: resolvedPolicyPack.version,
      rule_count: resolvedPolicyPack.rules.length,
    },
    policy_results: policyResults,
  };
}

export function buildEvalRecord({
  evidenceRecord,
  evidenceRaw,
  evidencePath,
  teamProfile,
  options = {},
  rootDir,
}) {
  const reviewerConfidenceScale =
    teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high'];
  if (!evidenceRecord?.run_id) {
    throw new Error('buildEvalRecord requires an evidence record with run_id');
  }
  if (!teamProfile?.id) {
    throw new Error('buildEvalRecord requires a team profile with id');
  }
  if (typeof options.timeToGreenMinutes !== 'number' || Number.isNaN(options.timeToGreenMinutes)) {
    throw new Error('buildEvalRecord requires timeToGreenMinutes');
  }
  if (typeof options.overrideCount !== 'number' || Number.isNaN(options.overrideCount)) {
    throw new Error('buildEvalRecord requires overrideCount');
  }
  if (typeof options.acceptedWithoutMajorRewrite !== 'boolean') {
    throw new Error('buildEvalRecord requires acceptedWithoutMajorRewrite');
  }
  if (typeof options.requiredFollowup !== 'boolean') {
    throw new Error('buildEvalRecord requires requiredFollowup');
  }
  if (options.timeToGreenMinutes < 0) {
    throw new Error('timeToGreenMinutes must be zero or greater');
  }
  if (!Number.isInteger(options.overrideCount) || options.overrideCount < 0) {
    throw new Error('overrideCount must be a non-negative integer');
  }
  if (
    options.reviewerConfidence &&
    options.reviewerConfidence !== 'unknown' &&
    !reviewerConfidenceScale.includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the team profile scale or be unknown',
    );
  }
  const evidence = buildEvalEvidenceContext({
    evidenceRecord,
    evidenceRaw,
    evidencePath,
    rootDir,
  });

  return {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: teamProfile.id,
    mode: teamProfile.defaults?.mode ?? 'shadow',
    evidence,
    governance: buildEvalGovernanceContext(evidenceRecord),
    outcome: {
      accepted_without_major_rewrite: options.acceptedWithoutMajorRewrite,
      required_followup: options.requiredFollowup,
      reviewer_confidence: options.reviewerConfidence ?? 'unknown',
    },
    measurements: {
      time_to_green_minutes: options.timeToGreenMinutes,
      override_count: options.overrideCount,
      false_positive_rules: options.falsePositiveRules ?? [],
      missed_issues: options.missedIssues ?? [],
    },
    notes: options.notes ?? [],
  };
}

function buildEvalEvidenceContext({ evidenceRecord, evidenceRaw, evidencePath, rootDir }) {
  assertWithinDir(
    evidencePath,
    resolve(rootDir, '.veritas/evidence'),
    'eval record requires a repo-local evidence artifact inside .veritas/evidence/',
  );
  const evidenceRelativePath = relativeRepoPath(rootDir, evidencePath);
  const requiredEvidenceKeys = [
    'framework_version',
    'run_id',
    'timestamp',
    'source_ref',
    'source_kind',
    'source_scope',
    'affected_nodes',
    'affected_lanes',
  ];
  for (const key of requiredEvidenceKeys) {
    if (!(key in evidenceRecord)) {
      throw new Error(`evidence artifact is missing required key: ${key}`);
    }
  }
  const evidenceDigest = sha256Hex(
    evidenceRaw ?? loadEvidenceArtifact(evidencePath, { includeRaw: true }).raw,
  );

  return {
    artifact_path: evidenceRelativePath,
    artifact_digest: evidenceDigest,
    timestamp: evidenceRecord.timestamp,
    source_ref: evidenceRecord.source_ref,
    source_kind: evidenceRecord.source_kind,
    source_scope: evidenceRecord.source_scope ?? [],
    affected_nodes: evidenceRecord.affected_nodes ?? [],
    affected_lanes: evidenceRecord.affected_lanes ?? [],
  };
}

function isGovernanceAffectedNode(nodeId) {
  return typeof nodeId === 'string' && nodeId.startsWith('governance.');
}

function isGovernancePath(filePath) {
  return (
    filePath === '.veritas/repo.adapter.json' ||
    filePath === '.veritas/GOVERNANCE.md' ||
    (typeof filePath === 'string' && filePath.startsWith('.veritas/policy-packs/')) ||
    (typeof filePath === 'string' && filePath.startsWith('.veritas/team/'))
  );
}

function buildEvalGovernanceContext(evidenceRecord) {
  const changedPaths = (evidenceRecord.files ?? []).filter(isGovernancePath);
  const surfaceTouched =
    (evidenceRecord.affected_nodes ?? []).some(isGovernanceAffectedNode) ||
    changedPaths.length > 0;
  const classification =
    evidenceRecord.governance_surface?.classification ??
    (surfaceTouched ? 'unknown' : 'clean');

  return {
    surface_touched: surfaceTouched,
    classification,
    human_review_required: classification === 'constitutional-modification',
    changed_paths: changedPaths,
  };
}

export function buildEvalDraft({
  evidenceRecord,
  evidencePath,
  teamProfile,
  options = {},
  rootDir,
}) {
  if (!evidenceRecord?.run_id) {
    throw new Error('buildEvalDraft requires an evidence record with run_id');
  }
  if (!teamProfile?.id) {
    throw new Error('buildEvalDraft requires a team profile with id');
  }
  if (
    options.reviewerConfidence &&
    options.reviewerConfidence !== 'unknown' &&
    !(
      teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']
    ).includes(options.reviewerConfidence)
  ) {
    throw new Error(
      'reviewerConfidence must be listed in the team profile scale or be unknown',
    );
  }
  if (
    options.timeToGreenMinutes !== undefined &&
    (Number.isNaN(options.timeToGreenMinutes) || options.timeToGreenMinutes < 0)
  ) {
    throw new Error('timeToGreenMinutes must be zero or greater when provided');
  }
  if (
    options.overrideCount !== undefined &&
    (!Number.isInteger(options.overrideCount) || options.overrideCount < 0)
  ) {
    throw new Error('overrideCount must be a non-negative integer when provided');
  }

  const prefilledMeasurements = {
    time_to_green_minutes: options.timeToGreenMinutes ?? null,
    override_count: options.overrideCount ?? 0,
    false_positive_rules: options.falsePositiveRules ?? [],
    missed_issues: options.missedIssues ?? [],
  };
  const draft = {
    version: 1,
    run_id: evidenceRecord.run_id,
    team_profile_id: teamProfile.id,
    mode: teamProfile.defaults?.mode ?? 'shadow',
    evidence: buildEvalEvidenceContext({ evidenceRecord, evidencePath, rootDir }),
    governance: buildEvalGovernanceContext(evidenceRecord),
    reviewer_confidence_scale: [
      ...(teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
      'unknown',
    ],
    prefilled_outcome: {
      reviewer_confidence: options.reviewerConfidence ?? 'unknown',
    },
    prefilled_measurements: prefilledMeasurements,
    notes: options.notes ?? [],
    missing_confirmation_fields: [
      'accepted_without_major_rewrite',
      'required_followup',
      ...(prefilledMeasurements.time_to_green_minutes === null
        ? ['time_to_green_minutes']
        : []),
    ],
  };

  return draft;
}

function mergeEvalRecordOptions(options, draft) {
  const falsePositiveRules = options.falsePositiveRules ?? [];
  const missedIssues = options.missedIssues ?? [];
  const notes = options.notes ?? [];

  return {
    acceptedWithoutMajorRewrite: options.acceptedWithoutMajorRewrite,
    requiredFollowup: options.requiredFollowup,
    reviewerConfidence:
      options.reviewerConfidence ?? draft?.prefilled_outcome?.reviewer_confidence,
    timeToGreenMinutes:
      options.timeToGreenMinutes ??
      draft?.prefilled_measurements?.time_to_green_minutes,
    overrideCount:
      options.overrideCount ?? draft?.prefilled_measurements?.override_count,
    falsePositiveRules:
      falsePositiveRules.length > 0
        ? falsePositiveRules
        : (draft?.prefilled_measurements?.false_positive_rules ?? []),
    missedIssues:
      missedIssues.length > 0
        ? missedIssues
        : (draft?.prefilled_measurements?.missed_issues ?? []),
    notes: notes.length > 0 ? notes : (draft?.notes ?? []),
  };
}

function buildEvalRecordCommand(draftPath, draft) {
  const args = [
    'npm',
    'exec',
    '--',
    'veritas',
    'eval',
    'record',
    '--draft',
    draftPath,
    '--accepted-without-major-rewrite',
    '<true|false>',
    '--required-followup',
    '<true|false>',
    '--reviewer-confidence',
    draft.prefilled_outcome.reviewer_confidence,
    '--time-to-green-minutes',
    draft.prefilled_measurements.time_to_green_minutes === null
      ? '<minutes>'
      : String(draft.prefilled_measurements.time_to_green_minutes),
    '--override-count',
    String(draft.prefilled_measurements.override_count),
  ];

  for (const rule of draft.prefilled_measurements.false_positive_rules) {
    args.push('--false-positive-rule', rule);
  }
  for (const issue of draft.prefilled_measurements.missed_issues) {
    args.push('--missed-issue', issue);
  }
  for (const note of draft.notes) {
    args.push('--note', note);
  }

  return args.map(shellQuote).join(' ');
}

function validateEvalDraftContext({ draftPath, draftRecord, rootDir, teamProfile }) {
  assertWithinDir(
    draftPath,
    resolve(rootDir, '.veritas/eval-drafts'),
    'eval record requires a repo-local draft artifact inside .veritas/eval-drafts/',
  );
  const requiredDraftKeys = [
    'version',
    'run_id',
    'team_profile_id',
    'mode',
    'evidence',
    'reviewer_confidence_scale',
    'prefilled_outcome',
    'prefilled_measurements',
    'notes',
    'missing_confirmation_fields',
  ];
  for (const key of requiredDraftKeys) {
    if (!(key in draftRecord)) {
      throw new Error(`eval draft is missing required key: ${key}`);
    }
  }
  if (teamProfile.id !== draftRecord.team_profile_id) {
    throw new Error(
      'eval record draft must be completed with the same team profile that created it',
    );
  }
  const expectedScale = [
    ...(teamProfile.review_preferences?.reviewer_confidence_scale ?? ['low', 'medium', 'high']),
    'unknown',
  ];
  if (JSON.stringify(expectedScale) !== JSON.stringify(draftRecord.reviewer_confidence_scale)) {
    throw new Error(
      'eval record draft reviewer confidence scale must match the team profile scale',
    );
  }
}

function buildRuleResult(rule, overrides = {}) {
  return {
    rule_id: rule.id,
    classification: rule.classification,
    stage: rule.stage,
    message: rule.message,
    owner: rule.owner ?? null,
    rollback_switch: rule.rollback_switch ?? null,
    implemented: false,
    passed: null,
    summary: `Rule ${rule.id} is metadata-only in the current framework.`,
    findings: [],
    ...overrides,
  };
}

export function evaluateRequiredArtifactsRule(rule, { rootDir }) {
  const missingArtifacts = (rule.match?.artifacts ?? []).filter(
    (artifact) => !existsSync(resolve(rootDir, artifact)),
  );

  return buildRuleResult(rule, {
    implemented: true,
    passed: missingArtifacts.length === 0,
    summary:
      missingArtifacts.length === 0
        ? 'All required repository artifacts are present.'
        : 'Some required repository artifacts are missing.',
    findings: missingArtifacts.map((artifact) => ({
      kind: 'missing-artifact',
      artifact,
    })),
  });
}

export function evaluateGovernanceBlockRule(rule, { rootDir }) {
  const targets = rule.match?.['governance-block'] ?? [];
  const findings = targets
    .map((artifact) => inspectGovernanceBlockFile({ rootDir, filePath: artifact }))
    .filter((status) => !status.canonical)
    .map((status) => ({
      kind: status.exists
        ? status.stale
          ? 'stale-governance-block'
          : 'missing-governance-block'
        : 'missing-governance-file',
      artifact: status.path,
    }));

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? 'All required AI instruction files contain the canonical Veritas governance block.'
        : 'Some AI instruction files are missing the canonical Veritas governance block.',
    findings,
  });
}

export function evaluateDiffRequiredRule(rule, { changedFiles = [] }) {
  const ifChanged = rule.match?.['if-changed'];
  const thenRequire = rule.match?.['then-require'];
  const triggerMatches =
    typeof ifChanged === 'string'
      ? changedFiles.filter((file) => matchesPatterns(file, [ifChanged]))
      : [];
  const requirementMatches =
    typeof thenRequire === 'string'
      ? changedFiles.filter((file) => matchesPatterns(file, [thenRequire]))
      : [];
  const triggered = triggerMatches.length > 0;
  const passed = !triggered || requirementMatches.length > 0;

  return buildRuleResult(rule, {
    implemented: true,
    passed,
    summary: !triggered
      ? `No changed files matched ${ifChanged}.`
      : passed
        ? `Changed files matched ${ifChanged} and included required companion changes under ${thenRequire}.`
        : `Changed files matched ${ifChanged} but no companion changes matched ${thenRequire}.`,
    findings: passed
      ? []
      : triggerMatches.map((artifact) => ({
          kind: 'missing-required-diff-companion',
          artifact,
          required: thenRequire,
        })),
  });
}

export function evaluatePolicyRule(rule, context) {
  if (Array.isArray(rule.match?.artifacts)) {
    return evaluateRequiredArtifactsRule(rule, context);
  }
  if (Array.isArray(rule.match?.['governance-block'])) {
    return evaluateGovernanceBlockRule(rule, context);
  }
  if (
    typeof rule.match?.['if-changed'] === 'string' &&
    typeof rule.match?.['then-require'] === 'string'
  ) {
    return evaluateDiffRequiredRule(rule, context);
  }

  return buildRuleResult(rule);
}

export function evaluatePolicyPack(policyPack, context, options = {}) {
  const selectedRuleIds = new Set(options.ruleIds ?? []);
  return policyPack.rules
    .filter((rule) => selectedRuleIds.size === 0 || selectedRuleIds.has(rule.id))
    .map((rule) => evaluatePolicyRule(rule, context));
}

// bootstrap/install domains live in dedicated modules

// hook/install runtime lives in dedicated modules

export function writeEvidenceArtifact(record, config, rootDir) {
  const artifactDir = resolve(rootDir, config.evidence.artifactDir);
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = resolve(artifactDir, `${record.run_id}.json`);
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export function writeEvalArtifact(
  record,
  rootDir,
  outputPath = `.veritas/evals/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    resolve(rootDir, '.veritas/evals'),
    'eval artifacts may only be written inside .veritas/evals/',
  );
  const relativeArtifactPath = relativeRepoPath(rootDir, artifactPath);
  if (existsSync(artifactPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeArtifactPath} (use --force to replace it)`,
    );
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export function appendEvalHistory(record, rootDir) {
  const historyPath = resolve(rootDir, '.veritas/evals/history.jsonl');
  mkdirSync(dirname(historyPath), { recursive: true });
  const historyRecord = {
    timestamp: record.timestamp,
    run_id: record.run_id,
    accepted: record.outcome.accepted_without_major_rewrite,
    time_to_green_min: record.measurements.time_to_green_minutes,
    override_count: record.measurements.override_count,
    confidence: record.outcome.reviewer_confidence,
    false_positive_rules: record.measurements.false_positive_rules,
    required_followup: record.outcome.required_followup,
  };
  appendFileSync(historyPath, `${JSON.stringify(historyRecord)}\n`, 'utf8');
  return historyPath;
}

export function writeEvalDraftArtifact(
  record,
  rootDir,
  outputPath = `.veritas/eval-drafts/${record.run_id}.json`,
  force = false,
) {
  const artifactPath = resolve(rootDir, outputPath);
  assertWithinDir(
    artifactPath,
    resolve(rootDir, '.veritas/eval-drafts'),
    'eval drafts may only be written inside .veritas/eval-drafts/',
  );
  const relativeArtifactPath = relativeRepoPath(rootDir, artifactPath);
  if (existsSync(artifactPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeArtifactPath} (use --force to replace it)`,
    );
  }
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export function listChangedFiles(fromRef, toRef, rootDir) {
  if (!fromRef || !toRef) return [];

  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', fromRef, toRef], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function listGitFiles(args, rootDir) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listWorkingTreeFiles(
  { staged = false, unstaged = false, untracked = false } = {},
  rootDir,
) {
  const files = new Set();

  if (staged) {
    for (const file of listGitFiles(
      ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  if (unstaged) {
    for (const file of listGitFiles(
      ['diff', '--name-only', '--diff-filter=ACMR'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  if (untracked) {
    for (const file of listGitFiles(
      ['ls-files', '--others', '--exclude-standard'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  return [...files].sort();
}

export function resolveReportInputs(explicitFiles, options, rootDir) {
  if (explicitFiles.length > 0) {
    return {
      files: explicitFiles,
      sourceKind: 'explicit-files',
      sourceScope: ['explicit'],
      sourceRef: options.sourceRef ?? 'local-dry-run',
    };
  }

  if (options.changedFrom || options.changedTo) {
    if (!options.changedFrom || !options.changedTo) {
      throw new Error(
        'branch-diff reporting requires both --changed-from and --changed-to',
      );
    }
    const sourceRef =
      options.sourceRef ??
      `${options.changedFrom}..${options.changedTo}`;
    return {
      files: listChangedFiles(options.changedFrom, options.changedTo, rootDir),
      sourceKind: 'branch-diff',
      sourceScope: [
        ...(options.changedFrom ? [`changed-from:${options.changedFrom}`] : []),
        ...(options.changedTo ? [`changed-to:${options.changedTo}`] : []),
      ],
      sourceRef,
    };
  }

  const workingTreeScopes = [
    ...(options.workingTree ? ['staged', 'unstaged', 'untracked'] : []),
    ...(options.staged ? ['staged'] : []),
    ...(options.unstaged ? ['unstaged'] : []),
    ...(options.untracked ? ['untracked'] : []),
  ];

  if (workingTreeScopes.length > 0) {
    const uniqueScopes = [...new Set(workingTreeScopes)];
    return {
      files: listWorkingTreeFiles(
        {
          staged: uniqueScopes.includes('staged'),
          unstaged: uniqueScopes.includes('unstaged'),
          untracked: uniqueScopes.includes('untracked'),
        },
        rootDir,
      ),
      sourceKind: 'working-tree',
      sourceScope: uniqueScopes,
      sourceRef: options.sourceRef ?? 'working-tree',
    };
  }

  return {
    files: [],
    sourceKind: 'explicit-files',
    sourceScope: ['explicit'],
    sourceRef: options.sourceRef ?? 'local-dry-run',
  };
}

export function buildMarkdownSummary(record, artifactPath) {
  const policyPassCount = record.policy_results.filter((result) => result.passed === true).length;
  const policyFailCount = record.policy_results.filter((result) => result.passed === false).length;
  const policyMetadataOnlyCount = record.policy_results.filter(
    (result) => result.passed === null,
  ).length;
  const lines = [
    '## Veritas Report',
    '',
    `- **Adapter:** ${record.adapter.name} (${record.adapter.kind})`,
    `- **Source:** ${record.source_kind} (${record.source_scope.join(', ')})`,
    `- **Phase:** ${record.resolved_phase}`,
    `- **Workstream:** ${record.resolved_workstream}`,
    `- **Affected nodes:** ${
      record.affected_nodes.length ? record.affected_nodes.join(', ') : 'none'
    }`,
    `- **Affected lanes:** ${
      record.affected_lanes.length ? record.affected_lanes.join(', ') : 'none'
    }`,
    `- **Selected proof commands:** \`${record.selected_proof_commands.join(', ') || 'none'}\``,
    `- **Proof resolution source:** ${record.proof_resolution_source}`,
    `- **Proof families:** ${record.verification_budget?.proof_family_count ?? 0} total, ${record.verification_budget?.required_family_count ?? 0} required, ${record.verification_budget?.candidate_family_count ?? 0} candidate, ${record.verification_budget?.move_to_test_family_count ?? 0} move-to-test, ${record.verification_budget?.retire_family_count ?? 0} retiring`,
    `- **Uncovered path result:** ${record.uncovered_path_result}`,
    `- **Baseline \`ci:fast\` passed:** ${formatTriState(record.baseline_ci_fast_passed)}`,
    `- **Report transport:** ${record.adapter.report_transport}`,
    `- **Policy results:** ${policyPassCount} passed, ${policyFailCount} failed, ${policyMetadataOnlyCount} metadata-only`,
    `- **Artifact:** \`${artifactPath}\``,
  ];

  if (record.policy_results.length > 0) {
    lines.push('', '### Policy Results');
    for (const result of record.policy_results) {
      const status =
        result.passed === true ? 'pass' : result.passed === false ? 'fail' : 'metadata-only';
      lines.push(`- ${result.rule_id}: ${status} — ${result.summary}`);
      for (const finding of result.findings ?? []) {
        if (finding.artifact) {
          lines.push(`  - Artifact: ${finding.artifact}`);
        }
      }
    }
  }

  if (record.proof_family_results?.length > 0) {
    lines.push('', '### Proof Families');
    for (const family of record.proof_family_results) {
      const selected = family.selected ? 'selected' : 'not selected';
      lines.push(
        `- ${family.id}: ${family.disposition} / ${family.verification_weight} (${selected}) — ${family.rationale || 'No rationale recorded.'}`,
      );
      if (family.review_trigger) {
        lines.push(`  - Review trigger: ${family.review_trigger}`);
      }
    }
  }

  if (record.verification_budget) {
    lines.push('', '### Verification Budget');
    lines.push(`- ${record.verification_budget.recommendation}`);
    if (record.verification_budget.stale_or_unknown_family_ids.length > 0) {
      lines.push(
        `- Review candidates: ${record.verification_budget.stale_or_unknown_family_ids.join(', ')}`,
      );
    }
  }

  if (record.recommendations.length > 0) {
    lines.push('', '### Recommendations');
    for (const recommendation of record.recommendations) {
      lines.push(`- ${recommendation.message}`);
      if (recommendation.files?.length) {
        lines.push(`  - Files: ${recommendation.files.join(', ')}`);
      }
    }
  } else {
    lines.push('', '- No recommendations.');
  }

  return `${lines.join('\n')}\n`;
}

function feedbackStatusForPolicyResult(result) {
  if (result.passed === true) return 'PASS';
  if (result.passed === false && result.stage === 'block') return 'FAIL';
  if (result.passed === false) return 'WARN';
  return 'INFO';
}

function summarizeFeedbackCounts(record, proofFailure = null) {
  let failures = proofFailure ? 1 : 0;
  let warnings = 0;
  let passes = 0;

  for (const result of record?.policy_results ?? []) {
    const status = feedbackStatusForPolicyResult(result);
    if (status === 'FAIL') failures += 1;
    if (status === 'WARN') warnings += 1;
    if (status === 'PASS') passes += 1;
  }

  for (const family of record?.proof_family_results ?? []) {
    if (family.verification_weight === 'blocking' && family.blocking_status === 'failed') {
      failures += 1;
    }
  }

  return { failures, warnings, passes };
}

export function buildFeedbackSummary({
  record,
  reportArtifactPath = null,
  draftArtifactPath = null,
  evalArtifactPath = null,
  proofCommands = [],
  proofRan = false,
  proofFailure = null,
} = {}) {
  const affectedNodes = record?.affected_nodes?.length
    ? record.affected_nodes.join(', ')
    : 'no matched nodes';
  const files = record?.files ?? [];
  const lines = [
    `veritas: ${files.length} ${files.length === 1 ? 'file' : 'files'} changed -> ${affectedNodes}`,
  ];

  if (proofRan) {
    if (proofFailure) {
      lines.push(`FAIL  proof-command: ${proofFailure.command}`);
      lines.push(`      -> ${proofFailure.message}`);
    } else {
      for (const command of proofCommands) {
        lines.push(`PASS  proof-command: ${command}`);
      }
    }
  }

  for (const result of record?.policy_results ?? []) {
    const status = feedbackStatusForPolicyResult(result);
    if (status === 'INFO') continue;
    lines.push(`${status.padEnd(5)} ${result.rule_id}: ${result.summary}`);
    for (const finding of result.findings ?? []) {
      const target = finding.artifact ?? finding.path ?? finding.required;
      if (target) {
        lines.push(`      -> ${target}`);
      }
    }
  }

  for (const family of record?.proof_family_results ?? []) {
    if (!family.selected) continue;
    const status = family.verification_weight === 'blocking' ? 'PASS' : 'INFO';
    lines.push(
      `${status.padEnd(5)} proof-family:${family.id}: ${family.disposition} / ${family.verification_weight}`,
    );
    if (family.review_trigger) {
      lines.push(`      -> review: ${family.review_trigger}`);
    }
  }

  const counts = summarizeFeedbackCounts(record, proofFailure);
  const nouns = [
    `${counts.failures} ${counts.failures === 1 ? 'failure' : 'failures'}`,
    `${counts.warnings} ${counts.warnings === 1 ? 'warning' : 'warnings'}`,
  ];
  lines.push('', `${nouns.join(' · ')} · run \`veritas report\` for full evidence`);

  const footer = [];
  if (reportArtifactPath) footer.push(`report: ${reportArtifactPath}`);
  if (draftArtifactPath) footer.push(`eval draft: ${draftArtifactPath}`);
  if (evalArtifactPath) footer.push(`eval: ${evalArtifactPath}`);
  if (record?.run_id) footer.push(`run: ${record.run_id}`);
  if (footer.length > 0) {
    lines.push(footer.join(' · '));
  }

  return `${lines.join('\n')}\n`;
}

export function feedbackHasFailures(record, proofFailure = null) {
  return summarizeFeedbackCounts(record, proofFailure).failures > 0;
}

export function buildEvalMarkdownSummary(record, artifactPath) {
  const lines = [
    '## Veritas Eval',
    '',
    `- **Run ID:** ${record.run_id}`,
    `- **Mode:** ${record.mode}`,
    `- **Team profile:** ${record.team_profile_id}`,
    `- **Evidence artifact:** \`${record.evidence.artifact_path}\``,
    `- **Eval artifact:** \`${artifactPath}\``,
    `- **Accepted without major rewrite:** ${record.outcome.accepted_without_major_rewrite ? 'yes' : 'no'}`,
    `- **Required follow-up:** ${record.outcome.required_followup ? 'yes' : 'no'}`,
    `- **Reviewer confidence:** ${record.outcome.reviewer_confidence}`,
    `- **Time to green:** ${record.measurements.time_to_green_minutes} minutes`,
    `- **Override count:** ${record.measurements.override_count}`,
    `- **Governance surface touched:** ${record.governance.surface_touched ? 'yes' : 'no'}`,
    `- **Governance classification:** ${record.governance.classification}`,
    `- **Human governance review required:** ${record.governance.human_review_required ? 'yes' : 'no'}`,
  ];

  if (record.governance.changed_paths.length > 0) {
    lines.push(`- **Governance paths:** ${record.governance.changed_paths.join(', ')}`);
  }

  if (record.measurements.false_positive_rules.length > 0) {
    lines.push(`- **False-positive rules:** ${record.measurements.false_positive_rules.join(', ')}`);
  }

  if (record.measurements.missed_issues.length > 0) {
    lines.push(`- **Missed issues:** ${record.measurements.missed_issues.join(', ')}`);
  }

  if (record.notes.length > 0) {
    lines.push('', '### Notes');
    for (const note of record.notes) {
      lines.push(`- ${note}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function buildEvalDraftMarkdownSummary(record, artifactPath, suggestedRecordCommand) {
  const lines = [
    '## Veritas Eval Draft',
    '',
    `- **Run ID:** ${record.run_id}`,
    `- **Mode:** ${record.mode}`,
    `- **Team profile:** ${record.team_profile_id}`,
    `- **Evidence artifact:** \`${record.evidence.artifact_path}\``,
    `- **Draft artifact:** \`${artifactPath}\``,
    `- **Missing confirmation fields:** ${record.missing_confirmation_fields.join(', ')}`,
    `- **Governance surface touched:** ${record.governance.surface_touched ? 'yes' : 'no'}`,
    `- **Governance classification:** ${record.governance.classification}`,
    `- **Human governance review required:** ${record.governance.human_review_required ? 'yes' : 'no'}`,
    '',
    '### Next Step',
    '',
    `\`${suggestedRecordCommand}\``,
  ];

  if (record.governance.changed_paths.length > 0) {
    lines.splice(8, 0, `- **Governance paths:** ${record.governance.changed_paths.join(', ')}`);
  }

  return `${lines.join('\n')}\n`;
}

function resolveVeritasPaths(options, defaults = {}) {
  const rootDir = options.rootDir ? resolve(options.rootDir) : defaults.rootDir;
  const defaultAdapterPath =
    defaults.adapterPath ??
    (rootDir ? resolve(rootDir, '.veritas/repo.adapter.json') : undefined);
  const defaultPolicyPackPath =
    defaults.policyPackPath ??
    (rootDir
      ? resolve(rootDir, '.veritas/policy-packs/default.policy-pack.json')
      : undefined);
  const defaultTeamProfilePath =
    defaults.teamProfilePath ??
    (rootDir ? resolve(rootDir, '.veritas/team/default.team-profile.json') : undefined);

  return {
    rootDir,
    adapterPath: options.adapterPath
      ? resolve(rootDir ?? process.cwd(), options.adapterPath)
      : defaultAdapterPath,
    policyPackPath: options.policyPackPath
      ? resolve(rootDir ?? process.cwd(), options.policyPackPath)
      : defaultPolicyPackPath,
    teamProfilePath: options.teamProfilePath
      ? resolve(rootDir ?? process.cwd(), options.teamProfilePath)
      : defaultTeamProfilePath,
  };
}

export function generateVeritasReport(options = {}, defaults = {}, explicitFiles = []) {
  const { rootDir, adapterPath, policyPackPath } = resolveVeritasPaths(options, defaults);

  if (!rootDir || !adapterPath || !policyPackPath) {
    throw new Error(
      'Veritas report requires rootDir, adapterPath, and policyPackPath',
    );
  }

  const reportInputs = resolveReportInputs(explicitFiles, options, rootDir);
  const files = reportInputs.files;

  if (files.length === 0 && reportInputs.sourceKind === 'explicit-files') {
    throw new Error('veritas report requires at least one file path');
  }

  const config = loadAdapterConfig(adapterPath);
  const policyPack = loadPolicyPack(policyPackPath);
  const proofPlan = resolveProofPlan({
    files,
    config,
    rootDir,
    explicitProofCommand: options.explicitProofCommand,
  });
  const record = buildEvidenceRecord({
    files,
    options: {
      ...options,
      sourceRef: reportInputs.sourceRef,
      sourceKind: reportInputs.sourceKind,
      sourceScope: reportInputs.sourceScope,
      proofPlan,
    },
    config,
    policyPack,
    rootDir,
  });
  const artifactPath = writeEvidenceArtifact(record, config, rootDir);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const markdownSummary = buildMarkdownSummary(record, relativeArtifactPath);
  const resolvedSummaryPath =
    options.summaryPath ??
    (config.evidence.reportTransport === 'github-step-summary'
      ? process.env.GITHUB_STEP_SUMMARY
      : undefined);

  if (resolvedSummaryPath) {
    appendFileSync(resolvedSummaryPath, markdownSummary, 'utf8');
  }

  return {
    rootDir,
    config,
    record,
    artifactPath: relativeArtifactPath,
    markdownSummary,
  };
}

export function generateEvalDraft(options = {}, defaults = {}) {
  const { rootDir, teamProfilePath } = resolveVeritasPaths(options, defaults);
  const evidencePath = options.evidencePath
    ? resolve(rootDir, options.evidencePath)
    : undefined;

  if (!rootDir || !teamProfilePath) {
    throw new Error('Veritas eval draft requires rootDir and teamProfilePath');
  }
  if (!evidencePath) {
    throw new Error('veritas eval draft requires --evidence <path>');
  }

  const evidenceRecord = loadEvidenceArtifact(evidencePath);
  const teamProfile = loadTeamProfile(teamProfilePath);
  const record = buildEvalDraft({
    evidenceRecord,
    evidencePath,
    teamProfile,
    options,
    rootDir,
  });
  const artifactPath = writeEvalDraftArtifact(
    record,
    rootDir,
    options.outputPath,
    options.force ?? false,
  );
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const suggestedRecordCommand = buildEvalRecordCommand(relativeArtifactPath, record);
  const markdownSummary = buildEvalDraftMarkdownSummary(
    record,
    relativeArtifactPath,
    suggestedRecordCommand,
  );

  return {
    rootDir,
    teamProfile,
    record,
    artifactPath: relativeArtifactPath,
    suggestedRecordCommand,
    markdownSummary,
  };
}

export function generateEvalRecord(options = {}, defaults = {}) {
  const { rootDir, teamProfilePath } = resolveVeritasPaths(options, defaults);
  if (!rootDir || !teamProfilePath) {
    throw new Error('Veritas eval record requires rootDir and teamProfilePath');
  }
  if (options.evidencePath && options.draftPath) {
    throw new Error('veritas eval record accepts either --evidence or --draft, not both');
  }
  if (!options.evidencePath && !options.draftPath) {
    throw new Error('veritas eval record requires --evidence <path> or --draft <path>');
  }

  const teamProfile = loadTeamProfile(teamProfilePath);
  const draft = options.draftPath
    ? loadEvalDraftArtifact(resolve(rootDir, options.draftPath))
    : null;
  if (draft) {
    validateEvalDraftContext({
      draftPath: resolve(rootDir, options.draftPath),
      draftRecord: draft,
      rootDir,
      teamProfile,
    });
  }
  const evidencePath = options.evidencePath
    ? resolve(rootDir, options.evidencePath)
    : resolve(rootDir, draft.evidence.artifact_path);
  const { data: evidenceRecord, raw: evidenceRaw } = loadEvidenceArtifact(evidencePath, {
    includeRaw: true,
  });
  const record = buildEvalRecord({
    evidenceRecord,
    evidenceRaw,
    evidencePath,
    teamProfile,
    options: mergeEvalRecordOptions(options, draft),
    rootDir,
  });
  const artifactPath = writeEvalArtifact(
    record,
    rootDir,
    options.outputPath,
    options.force ?? false,
  );
  const historyPath = appendEvalHistory(record, rootDir);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const relativeHistoryPath = relative(rootDir, historyPath).replaceAll('\\', '/');
  const markdownSummary = buildEvalMarkdownSummary(record, relativeArtifactPath);

  return {
    rootDir,
    teamProfile,
    record,
    artifactPath: relativeArtifactPath,
    historyPath: relativeHistoryPath,
    markdownSummary,
  };
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

function averageNumber(values) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function incrementCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function formatAverage(value, suffix = '') {
  return value === null ? 'n/a' : `${Number(value.toFixed(1))}${suffix}`;
}

export function generateEvalSummary(options = {}, defaults = {}) {
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const historyPath = resolve(rootDir, '.veritas/evals/history.jsonl');
  if (!existsSync(historyPath)) {
    return {
      rootDir,
      historyPath: relativeRepoPath(rootDir, historyPath),
      total: 0,
      accepted: 0,
      requiredRewrite: 0,
      averageTimeToGreenMinutes: null,
      averageOverrideCount: null,
      confidenceCounts: {},
      mostFlaggedRule: null,
      markdownSummary: 'No Veritas eval history found.\n',
    };
  }

  const records = readFileSync(historyPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const lastRecords = records.slice(-10);
  const accepted = lastRecords.filter((record) => record.accepted === true).length;
  const requiredRewrite = lastRecords.length - accepted;
  const confidenceCounts = new Map();
  const flaggedRuleCounts = new Map();

  for (const record of lastRecords) {
    incrementCount(confidenceCounts, record.confidence ?? 'unknown');
    for (const ruleId of record.false_positive_rules ?? []) {
      incrementCount(flaggedRuleCounts, ruleId);
    }
  }

  const sortedRules = [...flaggedRuleCounts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const averageTimeToGreenMinutes = averageNumber(
    lastRecords
      .map((record) => record.time_to_green_min)
      .filter((value) => typeof value === 'number' && !Number.isNaN(value)),
  );
  const averageOverrideCount = averageNumber(
    lastRecords
      .map((record) => record.override_count)
      .filter((value) => typeof value === 'number' && !Number.isNaN(value)),
  );
  const confidenceSummary = [...confidenceCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([confidence, count]) => `${confidence} (${count})`)
    .join(', ');
  const mostFlaggedRule = sortedRules.length > 0
    ? { rule_id: sortedRules[0][0], count: sortedRules[0][1] }
    : null;
  const lines = [
    `Last ${lastRecords.length} evals: ${accepted} accepted, ${requiredRewrite} required rewrite`,
    `Avg time to green: ${formatAverage(averageTimeToGreenMinutes, ' min')} | Avg overrides: ${formatAverage(averageOverrideCount)} | Confidence: ${confidenceSummary || 'n/a'}`,
    `Most flagged rule: ${mostFlaggedRule ? `${mostFlaggedRule.rule_id} (${mostFlaggedRule.count})` : 'n/a'}`,
  ];

  return {
    rootDir,
    historyPath: relativeRepoPath(rootDir, historyPath),
    total: lastRecords.length,
    accepted,
    requiredRewrite,
    averageTimeToGreenMinutes,
    averageOverrideCount,
    confidenceCounts: Object.fromEntries(confidenceCounts),
    mostFlaggedRule,
    markdownSummary: `${lines.join('\n')}\n`,
  };
}

export function resolveProofCommands({ adapterPath, files = [], rootDir, explicitProofCommand }) {
  if (!adapterPath || !rootDir) {
    return {
      proofCommands: explicitProofCommand ? [explicitProofCommand] : [],
      resolutionSource: explicitProofCommand ? 'explicit' : 'none',
      affectedNodes: [],
      affectedLanes: [],
      unmatchedFiles: [],
      uncoveredPathPolicy: 'warn',
      uncoveredPathResult: 'clear',
    };
  }
  const config = loadAdapterConfig(adapterPath);
  return resolveProofPlan({
    files,
    config,
    rootDir,
    explicitProofCommand,
  });
}

function hasShadowOutcomeInputs(options) {
  return (
    typeof options.acceptedWithoutMajorRewrite === 'boolean' &&
    typeof options.requiredFollowup === 'boolean' &&
    typeof options.timeToGreenMinutes === 'number' &&
    !Number.isNaN(options.timeToGreenMinutes)
  );
}

function normalizeOutputFormat(format, defaultFormat) {
  const resolvedFormat = format ?? defaultFormat;
  if (!['json', 'feedback'].includes(resolvedFormat)) {
    throw new Error('--format must be json or feedback');
  }
  return resolvedFormat;
}

export function runVeritasReportCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseArgs(argv);
  const format = normalizeOutputFormat(options.format, 'json');
  const result = generateVeritasReport(options, defaults, explicitFiles);

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: result.record,
        reportArtifactPath: result.artifactPath,
      }),
    );
    if (feedbackHasFailures(result.record)) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

function formatVerificationBudgetHuman(record) {
  const budget = record.verification_budget ?? buildVerificationBudget({
    proofLanes: [],
    proofFamilyResults: [],
  });
  const lines = [
    'Veritas Verification Budget',
    '',
    `Proof lanes: ${budget.selected_proof_lane_count}/${budget.proof_lane_count} selected`,
    `Proof families: ${budget.proof_family_count} total`,
    `Required: ${budget.required_family_count}`,
    `Candidate: ${budget.candidate_family_count}`,
    `Advisory: ${budget.advisory_family_count}`,
    `Move to test: ${budget.move_to_test_family_count}`,
    `Retiring: ${budget.retire_family_count}`,
    `Upstream candidates: ${budget.upstream_candidate_count}`,
    '',
    budget.recommendation,
  ];

  if (budget.unknown_catch_evidence_family_ids?.length > 0) {
    lines.push(`Unknown catch evidence: ${budget.unknown_catch_evidence_family_ids.join(', ')}`);
  }
  if (budget.missing_review_trigger_family_ids?.length > 0) {
    lines.push(`Missing review triggers: ${budget.missing_review_trigger_family_ids.join(', ')}`);
  }
  if (budget.stale_family_ids?.length > 0) {
    lines.push(`Stale or retiring families: ${budget.stale_family_ids.join(', ')}`);
  }

  return `${lines.join('\n')}\n`;
}

export function runVerificationBudgetCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, files: explicitFiles } = parseBudgetArgs(argv);
  const format = options.format ?? 'human';
  if (!['human', 'feedback', 'json'].includes(format)) {
    throw new Error('--format must be human, feedback, or json');
  }
  const result = generateVeritasReport(
    {
      ...options,
      runId: options.runId ?? `budget-${Date.now()}`,
    },
    defaults,
    explicitFiles,
  );

  if (format === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          artifactPath: result.artifactPath,
          verification_budget: result.record.verification_budget,
          proof_family_results: result.record.proof_family_results,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: result.record,
        reportArtifactPath: result.artifactPath,
      }),
    );
    return;
  }

  process.stdout.write(formatVerificationBudgetHuman(result.record));
}

export function runInitCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseInitArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const projectName = options.projectName ?? defaults.projectName ?? basename(rootDir);
  if (options.explore && options.apply) {
    throw new Error('veritas init cannot combine --explore and --apply');
  }
  if (options.apply && !options.planPath) {
    throw new Error('veritas init --apply requires --plan <path>');
  }
  if (options.answersPath && !options.guided) {
    throw new Error('veritas init --answers requires --guided');
  }

  if (options.explore || options.guided) {
    const answers = options.answersPath ? loadJson(resolve(rootDir, options.answersPath), 'init answers') : undefined;
    const recommendation = buildInitRecommendation({
      rootDir,
      projectName,
      proofLane: options.proofLane ?? defaults.proofLane,
      answers,
      mode: options.guided ? 'guided' : 'explore',
    });
    if (options.outputPath) {
      const outputPath = resolve(rootDir, options.outputPath);
      const allowedDir = resolve(rootDir, '.veritas/init-plans');
      assertWithinDir(outputPath, allowedDir, 'init --output must stay inside .veritas/init-plans/');
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(recommendation, null, 2)}\n`, 'utf8');
      recommendation.output_path = relative(rootDir, outputPath).replaceAll('\\', '/');
    }
    process.stdout.write(`${JSON.stringify(recommendation, null, 2)}\n`);
    return;
  }

  if (options.apply) {
    const planPath = resolve(rootDir, options.planPath);
    const recommendation = loadJson(planPath, 'init recommendation');
    const result = applyInitRecommendation({
      rootDir,
      recommendation,
      force: options.force ?? false,
    });
    process.stderr.write(
      `Next Steps\n\nSuggested CODEOWNERS block (not written automatically):\n\n${result.codeownersBlock}\n\n`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const result = writeBootstrapStarterKit({
    rootDir,
    projectName,
    proofLane: options.proofLane ?? defaults.proofLane,
    force: options.force ?? false,
  });

  process.stderr.write(
    `Next Steps\n\nSuggested CODEOWNERS block (not written automatically):\n\n${result.codeownersBlock}\n\n`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runPrintPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        proofLane,
        repoInsights,
        scripts: buildSuggestedPackageScripts({
          proofLane,
          baseRef: repoInsights.baseRef,
        }),
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        proofLane,
        repoInsights,
        ciSnippet: buildSuggestedCiSnippet({
          proofLane,
          baseRef: repoInsights.baseRef,
        }),
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const hook = options.hook ?? 'post-commit';

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        hook,
        hookBody: buildSuggestedGitHook({ hook }),
        suggestedHooksPath: '.githooks',
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        outputPath: '.veritas/hooks/agent-runtime.sh',
        hookBody: buildSuggestedRuntimeHook(),
        defaultInvocation: '.veritas/hooks/agent-runtime.sh',
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintStopHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const tool = options.tool ?? 'generic';
  const suggestion = buildSuggestedStopHook({ tool });

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        ...suggestion,
      },
      null,
      2,
    )}\n`,
  );
}

export function runPrintGovernanceBlockCli() {
  process.stdout.write(`${buildGovernanceBlock()}\n`);
}

export function runPrintCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const targetStatus = inspectCodexHookTarget(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });
  const suggestedApplyCommand = options.codexHome
    ? `npm exec -- veritas apply codex-hook --codex-home ${shellQuote(options.codexHome)}`
    : options.targetHooksFile
      ? `npm exec -- veritas apply codex-hook --target-hooks-file ${shellQuote(options.targetHooksFile)}`
      : null;

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        outputPath: '.veritas/runtime/codex-hooks.json',
        targetHooksFile: options.targetHooksFile ?? null,
        codexHome: options.codexHome ?? null,
        targetStatus,
        suggestedApplyCommand,
        hookConfig: buildSuggestedCodexHookConfig(),
      },
      null,
      2,
    )}\n`,
  );
}

export function runRuntimeStatusCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePrintArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const status = inspectRuntimeAdapterStatus(rootDir, {
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        rootDir,
        ...status,
      },
      null,
      2,
    )}\n`,
  );
}

export function runApplyPackageScriptsCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;
  const result = applyPackageScripts({
    rootDir,
    proofLane,
    baseRef: repoInsights.baseRef,
    force: options.force ?? false,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        repoInsights,
      },
      null,
      2,
    )}\n`,
  );
}

export function runApplyCiSnippetCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const proofLane = options.proofLane ?? repoInsights.proofLane;
  const result = applyCiSnippet({
    rootDir,
    proofLane,
    baseRef: repoInsights.baseRef,
    outputPath: options.outputPath ?? '.veritas/snippets/ci-snippet.yml',
    force: options.force ?? false,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...result,
        repoInsights,
      },
      null,
      2,
    )}\n`,
  );
}

export function runApplyGitHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const hook = options.hook ?? 'post-commit';
  const result = applyGitHook({
    rootDir,
    hook,
    outputPath: options.outputPath ?? `.githooks/${hook}`,
    force: options.force ?? false,
    configureGit: options.configureGit ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyRuntimeHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyRuntimeHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/hooks/agent-runtime.sh',
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyStopHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyStopHook({
    rootDir,
    tool: options.tool ?? 'generic',
    outputPath: options.outputPath ?? '.veritas/hooks/stop.sh',
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyGovernanceBlocksCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyGovernanceBlocks({
    rootDir,
    force: options.force ?? false,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runApplyCodexHookCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = applyCodexHook({
    rootDir,
    outputPath: options.outputPath ?? '.veritas/runtime/codex-hooks.json',
    force: options.force ?? false,
    targetHooksFile: options.targetHooksFile,
    codexHome: options.codexHome,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runEvalRecordCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalRecord(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        historyPath: result.historyPath,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runEvalSummaryCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalSummary(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(result.markdownSummary);
}

export function runEvalMarkerCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerEvalArgs(argv);
  const result = generateMarkerBenchmarkComparison(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runEvalMarkerSuiteCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerSuiteEvalArgs(argv);
  const result = generateMarkerBenchmarkSuiteReport(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runEvalDraftCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseEvalArgs(argv);
  const result = generateEvalDraft(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        suggestedRecordCommand: result.suggestedRecordCommand,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runShadowRunCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseShadowArgs(argv);
  const format = normalizeOutputFormat(options.format, 'feedback');
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const { adapterPath } = resolveVeritasPaths(
    { ...options, rootDir },
    { ...defaults, rootDir },
  );
  const reportInputs = resolveReportInputs(
    [],
    {
      ...options,
      workingTree:
        options.workingTree || (!options.changedFrom && !options.changedTo),
    },
    rootDir,
  );
  const proofPlan = resolveProofCommands({
    adapterPath,
    files: reportInputs.files,
    rootDir,
    explicitProofCommand: options.proofCommand,
  });
  const proofCommands = proofPlan.proofCommands;
  if (!options.skipProof && proofCommands.length === 0) {
    throw new Error(
      'veritas shadow run requires a proof command or an adapter required proof lane',
    );
  }

  let proofFailure = null;
  if (!options.skipProof) {
    for (const proofCommand of proofCommands) {
      try {
        runProofCommand(proofCommand, rootDir, {
          stdio: format === 'feedback' ? 'pipe' : 'inherit',
          encoding: format === 'feedback' ? 'utf8' : undefined,
        });
      } catch (error) {
        proofFailure = {
          command: proofCommand,
          message: error.message,
        };
        break;
      }
    }
  }

  const reportResult = generateVeritasReport(
    {
      ...options,
      rootDir,
      workingTree:
        options.workingTree || (!options.changedFrom && !options.changedTo),
      baselineCiFastStatus:
        options.baselineCiFastStatus ??
        (options.skipProof ? undefined : proofFailure ? 'failed' : 'success'),
      explicitProofCommand: options.proofCommand,
    },
    { ...defaults, rootDir },
  );
  if (reportResult.record.uncovered_path_result === 'fail') {
    throw new Error(
      'veritas shadow run encountered changed files outside configured surfaces and the uncovered-path policy is fail',
    );
  }
  const draftResult = generateEvalDraft(
    {
      ...options,
      rootDir,
      evidencePath: reportResult.artifactPath,
      force: options.force ?? false,
    },
    { ...defaults, rootDir },
  );

  if (!hasShadowOutcomeInputs(options)) {
    if (format === 'feedback') {
      process.stdout.write(
        buildFeedbackSummary({
          record: reportResult.record,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          proofCommands: options.skipProof ? [] : proofCommands,
          proofRan: !options.skipProof,
          proofFailure,
        }),
      );
      if (feedbackHasFailures(reportResult.record, proofFailure)) {
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'report-and-draft',
          proofCommands: options.skipProof ? [] : proofCommands,
          proofResolutionSource: proofPlan.resolutionSource,
          proofRan: !options.skipProof,
          proofFailure,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          suggestedEvalCommand: draftResult.suggestedRecordCommand,
          message:
            'Proof, report, and eval draft completed. The final judgment fields still need confirmation.',
        },
        null,
        2,
      )}\n`,
    );
    if (proofFailure) {
      process.exitCode = 1;
    }
    return;
  }

  const evalResult = generateEvalRecord(
    {
      ...options,
      rootDir,
      draftPath: draftResult.artifactPath,
      force: options.force ?? false,
    },
    { ...defaults, rootDir },
  );

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: reportResult.record,
        reportArtifactPath: reportResult.artifactPath,
        draftArtifactPath: draftResult.artifactPath,
        evalArtifactPath: evalResult.artifactPath,
        proofCommands: options.skipProof ? [] : proofCommands,
        proofRan: !options.skipProof,
        proofFailure,
      }),
    );
    if (feedbackHasFailures(reportResult.record, proofFailure)) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
        {
          mode: 'report-draft-and-eval',
          proofCommands: options.skipProof ? [] : proofCommands,
          proofResolutionSource: proofPlan.resolutionSource,
          proofRan: !options.skipProof,
          proofFailure,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          evalArtifactPath: evalResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          evalMode: evalResult.record.mode,
        },
      null,
      2,
    )}\n`,
  );
  if (proofFailure) {
    process.exitCode = 1;
  }
}
