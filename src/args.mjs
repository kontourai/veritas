function parseBooleanFlag(value, optionName) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${optionName} must be true or false`);
}

function cloneDefaults(defaults) {
  const options = {};
  for (const [key, value] of Object.entries(defaults)) {
    options[key] = Array.isArray(value) ? [...value] : value;
  }
  return options;
}

export function parseTokens(argv, spec, { defaults = {} } = {}) {
  const options = cloneDefaults(defaults);
  const rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const rule = spec[token];

    if (!rule) {
      rest.push(token);
      continue;
    }

    if (rule.type === 'flag') {
      options[rule.key] = true;
      continue;
    }

    const nextValue = argv[index + 1];
    index += 1;

    if (rule.type === 'string') {
      options[rule.key] = nextValue;
      continue;
    }
    if (rule.type === 'number') {
      options[rule.key] = Number(nextValue);
      continue;
    }
    if (rule.type === 'boolean-string') {
      options[rule.key] = parseBooleanFlag(nextValue, token);
      continue;
    }
    if (rule.type === 'array') {
      const currentValues = Array.isArray(options[rule.key]) ? options[rule.key] : [];
      currentValues.push(nextValue);
      options[rule.key] = currentValues;
      continue;
    }

    throw new Error(`Unsupported token spec type: ${rule.type}`);
  }

  return { options, rest };
}

export function parseArgs(argv) {
  const { options, rest } = parseTokens(argv, {
    '--adapter': { type: 'string', key: 'adapterPath' },
    '--policy-pack': { type: 'string', key: 'policyPackPath' },
    '--root': { type: 'string', key: 'rootDir' },
    '--workstream': { type: 'string', key: 'workstream' },
    '--phase': { type: 'string', key: 'phase' },
    '--source-ref': { type: 'string', key: 'sourceRef' },
    '--owner': { type: 'string', key: 'owner' },
    '--baseline-ci-fast-status': { type: 'string', key: 'baselineCiFastStatus' },
    '--run-id': { type: 'string', key: 'runId' },
    '--changed-from': { type: 'string', key: 'changedFrom' },
    '--changed-to': { type: 'string', key: 'changedTo' },
    '--working-tree': { type: 'flag', key: 'workingTree' },
    '--staged': { type: 'flag', key: 'staged' },
    '--unstaged': { type: 'flag', key: 'unstaged' },
    '--untracked': { type: 'flag', key: 'untracked' },
    '--summary-path': { type: 'string', key: 'summaryPath' },
    '--format': { type: 'string', key: 'format' },
  });

  return { options, files: rest };
}

export function parseInitArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--project-name': { type: 'string', key: 'projectName' },
      '--proof-lane': { type: 'string', key: 'proofLane' },
      '--force': { type: 'flag', key: 'force' },
    },
  ).options;
}

export function parsePrintArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--proof-lane': { type: 'string', key: 'proofLane' },
      '--hook': { type: 'string', key: 'hook' },
      '--target-hooks-file': { type: 'string', key: 'targetHooksFile' },
      '--codex-home': { type: 'string', key: 'codexHome' },
      '--tool': { type: 'string', key: 'tool' },
    },
  ).options;
}

export function parseApplyArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--proof-lane': { type: 'string', key: 'proofLane' },
      '--output': { type: 'string', key: 'outputPath' },
      '--hook': { type: 'string', key: 'hook' },
      '--force': { type: 'flag', key: 'force' },
      '--configure-git': { type: 'flag', key: 'configureGit' },
      '--target-hooks-file': { type: 'string', key: 'targetHooksFile' },
      '--codex-home': { type: 'string', key: 'codexHome' },
      '--tool': { type: 'string', key: 'tool' },
    },
  ).options;
}

export function parseEvalArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--evidence': { type: 'string', key: 'evidencePath' },
      '--team-profile': { type: 'string', key: 'teamProfilePath' },
      '--draft': { type: 'string', key: 'draftPath' },
      '--output': { type: 'string', key: 'outputPath' },
      '--accepted-without-major-rewrite': {
        type: 'boolean-string',
        key: 'acceptedWithoutMajorRewrite',
      },
      '--required-followup': { type: 'boolean-string', key: 'requiredFollowup' },
      '--reviewer-confidence': { type: 'string', key: 'reviewerConfidence' },
      '--time-to-green-minutes': { type: 'number', key: 'timeToGreenMinutes' },
      '--override-count': { type: 'number', key: 'overrideCount' },
      '--false-positive-rule': { type: 'array', key: 'falsePositiveRules' },
      '--missed-issue': { type: 'array', key: 'missedIssues' },
      '--note': { type: 'array', key: 'notes' },
      '--force': { type: 'flag', key: 'force' },
      '--format': { type: 'string', key: 'format' },
    },
    {
      defaults: {
        falsePositiveRules: [],
        missedIssues: [],
        notes: [],
      },
    },
  ).options;
}

export function parseMarkerEvalArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--scenario': { type: 'string', key: 'scenarioPath' },
      '--without-veritas-transcript': {
        type: 'string',
        key: 'withoutVeritasTranscriptPath',
      },
      '--with-veritas-transcript': { type: 'string', key: 'withVeritasTranscriptPath' },
    },
  ).options;
}

export function parseMarkerSuiteEvalArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--suite': { type: 'string', key: 'suitePath' },
    },
  ).options;
}

export function parseShadowArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--adapter': { type: 'string', key: 'adapterPath' },
      '--policy-pack': { type: 'string', key: 'policyPackPath' },
      '--team-profile': { type: 'string', key: 'teamProfilePath' },
      '--run-id': { type: 'string', key: 'runId' },
      '--working-tree': { type: 'flag', key: 'workingTree' },
      '--changed-from': { type: 'string', key: 'changedFrom' },
      '--changed-to': { type: 'string', key: 'changedTo' },
      '--proof-command': { type: 'string', key: 'proofCommand' },
      '--skip-proof': { type: 'flag', key: 'skipProof' },
      '--baseline-ci-fast-status': { type: 'string', key: 'baselineCiFastStatus' },
      '--accepted-without-major-rewrite': {
        type: 'boolean-string',
        key: 'acceptedWithoutMajorRewrite',
      },
      '--required-followup': { type: 'boolean-string', key: 'requiredFollowup' },
      '--reviewer-confidence': { type: 'string', key: 'reviewerConfidence' },
      '--time-to-green-minutes': { type: 'number', key: 'timeToGreenMinutes' },
      '--override-count': { type: 'number', key: 'overrideCount' },
      '--false-positive-rule': { type: 'array', key: 'falsePositiveRules' },
      '--missed-issue': { type: 'array', key: 'missedIssues' },
      '--note': { type: 'array', key: 'notes' },
      '--force': { type: 'flag', key: 'force' },
      '--format': { type: 'string', key: 'format' },
    },
    {
      defaults: {
        falsePositiveRules: [],
        missedIssues: [],
        notes: [],
      },
    },
  ).options;
}
