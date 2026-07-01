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

const FEEDBACK_JUDGMENT_TOKEN_SPEC = {
  '--accepted-without-major-rewrite': {
    type: 'boolean-string',
    key: 'acceptedWithoutMajorRewrite',
  },
  '--required-followup': { type: 'boolean-string', key: 'requiredFollowup' },
  '--reviewer-confidence': { type: 'string', key: 'reviewerConfidence' },
  '--time-to-green-minutes': { type: 'number', key: 'timeToGreenMinutes' },
  '--exception-count': { type: 'number', key: 'exceptionCount' },
  '--false-positive-rule': { type: 'array', key: 'falsePositiveRules' },
  '--missed-issue': { type: 'array', key: 'missedIssues' },
  '--note': { type: 'array', key: 'notes' },
};

const FEEDBACK_JUDGMENT_DEFAULTS = {
  falsePositiveRules: [],
  missedIssues: [],
  notes: [],
};

function parseFeedbackJudgmentTokens(argv, spec) {
  return parseTokens(
    argv,
    {
      ...spec,
      ...FEEDBACK_JUDGMENT_TOKEN_SPEC,
    },
    {
      defaults: FEEDBACK_JUDGMENT_DEFAULTS,
    },
  ).options;
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
    '--repo-map': { type: 'string', key: 'repoMapPath' },
    '--repo-standards': { type: 'string', key: 'repoStandardsPath' },
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
    '--trend': { type: 'flag', key: 'trend' },
  });

  return { options, files: rest };
}

export function parseCoverageArgs(argv) {
  return parseArgs(argv);
}

export function parseInitArgs(argv) {
  const { options, rest } = parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--project-name': { type: 'string', key: 'projectName' },
      '--evidence-check': { type: 'string', key: 'evidenceCheck' },
      '--template': { type: 'string', key: 'template' },
      '--force': { type: 'flag', key: 'force' },
      '--non-interactive': { type: 'flag', key: 'nonInteractive' },
      '--explore': { type: 'flag', key: 'explore' },
      '--guided': { type: 'flag', key: 'guided' },
      '--apply': { type: 'flag', key: 'apply' },
      '--plan': { type: 'string', key: 'planPath' },
      '--answers': { type: 'string', key: 'answersPath' },
      '--output': { type: 'string', key: 'outputPath' },
    },
  );
  if (rest.length > 0) {
    throw new Error(`Unknown init argument(s): ${rest.join(', ')}`);
  }
  return options;
}

export function parseAttestArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--actor': { type: 'string', key: 'actor' },
      '--display-name': { type: 'string', key: 'displayName' },
      '--message': { type: 'string', key: 'message' },
      '--approval-ref': { type: 'string', key: 'approvalRef' },
      '--valid-until-days': { type: 'number', key: 'validUntilDays' },
      '--non-interactive': { type: 'flag', key: 'nonInteractive' },
      // Authorizing block fields
      '--executed-by': { type: 'string', key: 'executedBy' },
      '--authorizing-statement': { type: 'string', key: 'authorizingStatement' },
      '--authorizing-prompt': { type: 'string', key: 'authorizingPrompt' },
      '--authorizing-response': { type: 'string', key: 'authorizingResponse' },
      '--excerpt-source': { type: 'string', key: 'excerptSource' },
      '--prompt-ref': { type: 'string', key: 'promptRef' },
      '--rendered-prompt': { type: 'string', key: 'renderedPrompt' },
      '--action': { type: 'string', key: 'action' },
      '--authority-ref': { type: 'string', key: 'authorityRef' },
    },
  ).options;
}

export function parsePrintArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--evidence-check': { type: 'string', key: 'evidenceCheck' },
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
      '--evidence-check': { type: 'string', key: 'evidenceCheck' },
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

export function parseSetupArgs(argv) {
  const { options, rest } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--force': { type: 'flag', key: 'force' },
  });
  if (rest.length > 0) {
    throw new Error(`Unknown setup argument(s): ${rest.join(', ')}`);
  }
  return options;
}

export function parsePreToolUseArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--file': { type: 'string', key: 'filePath' },
      '--actor': { type: 'string', key: 'actor' },
    },
  ).options;
}

export function parseStandardsFeedbackArgs(argv) {
  return parseFeedbackJudgmentTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--evidence': { type: 'string', key: 'evidencePath' },
      '--session-log': { type: 'string', key: 'sessionLogPath' },
      '--tool': { type: 'string', key: 'tool' },
      '--authority-settings': { type: 'string', key: 'authoritySettingsPath' },
      '--draft': { type: 'string', key: 'draftPath' },
      '--output': { type: 'string', key: 'outputPath' },
      '--rewrite-threshold': { type: 'number', key: 'rewriteThreshold' },
      '--verbose': { type: 'flag', key: 'verbose' },
      '--force': { type: 'flag', key: 'force' },
      '--format': { type: 'string', key: 'format' },
    },
  );
}

export function parseMarkerStandardsFeedbackArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--scenario': { type: 'string', key: 'scenarioPath' },
      '--without-veritas-session-log': {
        type: 'string',
        key: 'withoutVeritasSessionLogPath',
      },
      '--with-veritas-session-log': { type: 'string', key: 'withVeritasSessionLogPath' },
    },
  ).options;
}

export function parseMarkerSuiteStandardsFeedbackArgs(argv) {
  return parseTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--suite': { type: 'string', key: 'suitePath' },
    },
  ).options;
}

export function parseReadinessArgs(argv) {
  return parseFeedbackJudgmentTokens(
    argv,
    {
      '--root': { type: 'string', key: 'rootDir' },
      '--repo-map': { type: 'string', key: 'repoMapPath' },
      '--repo-standards': { type: 'string', key: 'repoStandardsPath' },
      '--authority-settings': { type: 'string', key: 'authoritySettingsPath' },
      '--run-id': { type: 'string', key: 'runId' },
      '--working-tree': { type: 'flag', key: 'workingTree' },
      '--changed-from': { type: 'string', key: 'changedFrom' },
      '--changed-to': { type: 'string', key: 'changedTo' },
      '--evidence-check-command': { type: 'string', key: 'evidenceCheckCommand' },
      '--skip-evidence-check': { type: 'flag', key: 'skipEvidenceCheck' },
      '--baseline-ci-fast-status': { type: 'string', key: 'baselineCiFastStatus' },
      '--force': { type: 'flag', key: 'force' },
      '--format': { type: 'string', key: 'format' },
    },
  );
}
