import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REPO_MAP_SCHEMA,
  REPO_STANDARDS_SCHEMA,
  validateAgainstSchema,
} from './schema-validation.mjs';

const MAX_REPORTED_ERRORS = 5;

const warnedConfigs = new Set();

function isStrictConfigMode(options) {
  if (options.strict !== undefined) return options.strict === true;
  return process.env.VERITAS_STRICT_CONFIG === '1';
}

export function formatConfigValidationReport({
  label,
  filePath,
  validation,
  limit = MAX_REPORTED_ERRORS,
}) {
  const shown = validation.errors.slice(0, limit);
  const remaining = validation.errors.length - shown.length;
  const lines = [
    `${label} at ${filePath} does not validate against ${validation.schema}:`,
    ...shown.map((error) => `  - ${error}`),
  ];
  if (remaining > 0) lines.push(`  - ... and ${remaining} more`);
  return lines.join('\n');
}

/**
 * Veritas ships the schema its config is authored against, so a config that does not
 * validate is drift Veritas can already see. Loading stays non-fatal by default: these
 * loaders sit on the Claude Code PreToolUse gate's path, where a throw would block every
 * edit in the repo until the config is repaired. `veritas readiness --check config` is
 * the exit-coded form to gate on; `VERITAS_STRICT_CONFIG=1` opts into failing the load today.
 */
function reportInvalidConfig({ label, filePath, validation, options }) {
  const report = formatConfigValidationReport({ label, filePath, validation });
  if (isStrictConfigMode(options)) {
    throw new Error(`${report}\nUnset VERITAS_STRICT_CONFIG to downgrade this to a warning.`);
  }
  const key = `${validation.schema}::${resolve(filePath)}`;
  if (warnedConfigs.has(key)) return;
  warnedConfigs.add(key);
  process.stderr.write(
    `Veritas: ${report}\n`
    + '  Veritas is evaluating it anyway; fields the schema does not define are ignored by the runtime.\n'
    + '  Run `veritas readiness --check config` for the full list. This becomes a hard load failure in a\n'
    + '  future major version; set VERITAS_STRICT_CONFIG=1 to opt in now.\n',
  );
}

export function loadJson(filePath, label = filePath, options = {}) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return options.includeRaw ? { data, raw } : data;
  } catch (error) {
    throw new Error(`Failed to load ${label} at ${filePath}: ${error.message}`);
  }
}

function loadValidatedJson(filePath, label, schemaFile, options) {
  const loaded = loadJson(filePath, label, options);
  const data = options.includeRaw ? loaded.data : loaded;
  const validation = validateAgainstSchema(schemaFile, data);
  if (!validation.valid) {
    reportInvalidConfig({ label, filePath, validation, options });
  }
  return loaded;
}

export function loadRepoMap(configPath, options = {}) {
  return loadValidatedJson(configPath, 'Repo Map', REPO_MAP_SCHEMA, options);
}

export function loadRepoStandards(repoStandardsPath, options = {}) {
  return loadValidatedJson(repoStandardsPath, 'Repo Standards', REPO_STANDARDS_SCHEMA, options);
}

export function loadAuthoritySettings(authoritySettingsPath, options = {}) {
  return loadJson(authoritySettingsPath, 'authority settings', options);
}

export function loadEvidenceArtifact(evidencePath, options = {}) {
  return loadJson(evidencePath, 'evidence artifact', options);
}

export function loadStandardsFeedbackDraftArtifact(draftPath, options = {}) {
  return loadJson(draftPath, 'standards feedback draft artifact', options);
}

export function loadMarkerBenchmarkScenario(scenarioPath, options = {}) {
  return loadJson(scenarioPath, 'marker benchmark scenario', options);
}

export function loadMarkerBenchmarkSessionLog(sessionLogPath, options = {}) {
  return loadJson(sessionLogPath, 'marker benchmark session log', options);
}

export function loadMarkerBenchmarkSuite(suitePath, options = {}) {
  return loadJson(suitePath, 'marker benchmark suite', options);
}
