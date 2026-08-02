function redactMcpExecutionConfig(value) {
  if (Array.isArray(value)) return value.map(redactMcpExecutionConfig);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (value.runner === 'mcp' && (key === 'server' || key === 'input')) continue;
    result[key] = redactMcpExecutionConfig(child);
  }
  return result;
}

export function publicEvidenceCheck(evidenceCheck) {
  return redactMcpExecutionConfig(structuredClone(evidenceCheck));
}

export function publicRepoMapConfig(config) {
  return redactMcpExecutionConfig(structuredClone(config));
}
