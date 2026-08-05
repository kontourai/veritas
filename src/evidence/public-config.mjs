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

// Durable Repo Map identities must be independent of JSON formatting and of
// MCP execution inputs. Keep this alongside the redaction policy so every
// public or persisted integrity surface derives the identical policy value.
export function stablePublicJson(value) {
  if (Array.isArray(value)) return `[${value.map(stablePublicJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stablePublicJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function publicRepoMapPolicyIdentity(config) {
  return stablePublicJson(publicRepoMapConfig(config));
}
