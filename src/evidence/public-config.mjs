export function publicEvidenceCheck(evidenceCheck) {
  const publicCheck = structuredClone(evidenceCheck);
  if ((publicCheck.runner ?? 'bash') === 'mcp') {
    delete publicCheck.server;
    delete publicCheck.input;
  }
  return publicCheck;
}

export function publicRepoMapConfig(config) {
  const publicConfig = structuredClone(config);
  if (Array.isArray(publicConfig.evidence?.evidenceChecks)) {
    publicConfig.evidence.evidenceChecks = publicConfig.evidence.evidenceChecks.map(publicEvidenceCheck);
  }
  return publicConfig;
}
