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

export function loadAdapterConfig(configPath, options = {}) {
  return loadJson(configPath, 'adapter config', options);
}

export function loadPolicyPack(policyPackPath, options = {}) {
  return loadJson(policyPackPath, 'policy pack', options);
}

export function loadTeamProfile(teamProfilePath, options = {}) {
  return loadJson(teamProfilePath, 'team profile', options);
}

export function loadEvidenceArtifact(evidencePath, options = {}) {
  return loadJson(evidencePath, 'evidence artifact', options);
}

export function loadEvalDraftArtifact(draftPath, options = {}) {
  return loadJson(draftPath, 'eval draft artifact', options);
}

export function loadMarkerBenchmarkScenario(scenarioPath, options = {}) {
  return loadJson(scenarioPath, 'marker benchmark scenario', options);
}

export function loadMarkerBenchmarkTranscript(transcriptPath, options = {}) {
  return loadJson(transcriptPath, 'marker benchmark transcript', options);
}

export function loadMarkerBenchmarkSuite(suitePath, options = {}) {
  return loadJson(suitePath, 'marker benchmark suite', options);
}
