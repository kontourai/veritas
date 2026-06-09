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

export function validateMarkerBenchmarkScenario(scenario) {
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

export function validateMarkerBenchmarkSessionLog(sessionLog, label) {
  validateAllowedKeys(
    sessionLog,
    ['version', 'benchmark_id', 'run_id', 'condition_id', 'turns'],
    `${label} session log`,
  );
  const requiredKeys = ['version', 'benchmark_id', 'run_id', 'condition_id', 'turns'];
  for (const key of requiredKeys) {
    if (!(key in sessionLog)) {
      throw new Error(`${label} session log is missing required key: ${key}`);
    }
  }
  validateIntegerField(sessionLog.version, `${label} session log version`, { minimum: 1 });
  validateStringField(sessionLog.benchmark_id, `${label} session log benchmark_id`);
  validateStringField(sessionLog.run_id, `${label} session log run_id`);
  validateStringField(sessionLog.condition_id, `${label} session log condition_id`);
  if (!['without-veritas', 'with-veritas'].includes(sessionLog.condition_id)) {
    throw new Error(
      `${label} session log condition_id must be without-veritas or with-veritas`,
    );
  }
  if (!Array.isArray(sessionLog.turns) || sessionLog.turns.length === 0) {
    throw new Error(`${label} session log requires at least one turn`);
  }
  for (const turn of sessionLog.turns) {
    validateAllowedKeys(turn, ['role', 'content', 'tags'], `${label} session log turn`);
    if (!['system', 'user', 'assistant', 'tool'].includes(turn.role)) {
      throw new Error(`${label} session log turn role must be one of system, user, assistant, tool`);
    }
    if (typeof turn.content !== 'string') {
      throw new Error(`${label} session log turn content must be a string`);
    }
    if ('tags' in turn && !Array.isArray(turn.tags)) {
      throw new Error(`${label} session log turn tags must be an array when provided`);
    }
    if (Array.isArray(turn.tags)) {
      for (const tag of turn.tags) {
        validateStringField(tag, `${label} session log turn tag`);
      }
    }
  }
}

export function validateMarkerBenchmarkPair({ scenario, sessionLog, label, expectedConditionId }) {
  validateMarkerBenchmarkSessionLog(sessionLog, label);
  if (sessionLog.benchmark_id !== scenario.id) {
    throw new Error(
      `${label} session log benchmark_id must match scenario id ${scenario.id}`,
    );
  }
  if (sessionLog.condition_id !== expectedConditionId) {
    throw new Error(
      `${label} session log condition_id must be ${expectedConditionId}`,
    );
  }
}

export function validateMarkerBenchmarkSuite(suite) {
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
        ['trial_id', 'without_veritas_session_log_path', 'with_veritas_session_log_path'],
        'marker benchmark suite trial',
      );
      const requiredTrialKeys = [
        'trial_id',
        'without_veritas_session_log_path',
        'with_veritas_session_log_path',
      ];
      for (const key of requiredTrialKeys) {
        if (!(key in trial)) {
          throw new Error(`marker benchmark suite trial is missing required key: ${key}`);
        }
      }
      validateStringField(trial.trial_id, 'marker benchmark suite trial trial_id');
      validateStringField(
        trial.without_veritas_session_log_path,
        'marker benchmark suite trial without_veritas_session_log_path',
      );
      validateStringField(
        trial.with_veritas_session_log_path,
        'marker benchmark suite trial with_veritas_session_log_path',
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
