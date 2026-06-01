import { readFileSync } from 'node:fs';

export function loadJson(filePath, label = filePath, options = {}) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return options.includeRaw ? { data, raw } : data;
  } catch (error) {
    throw new Error(`Failed to load ${label} at ${filePath}: ${error.message}`);
  }
}

export function loadRepoMap(configPath, options = {}) {
  return loadJson(configPath, 'Repo Map', options);
}

export function loadRepoStandards(repoStandardsPath, options = {}) {
  return loadJson(repoStandardsPath, 'Repo Standards', options);
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
