import { isDeepStrictEqual } from 'node:util';

const executionDefinitions = new WeakMap();
const executionResults = new WeakMap();

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function bindEvidenceCheckExecution(evidenceCheck) {
  executionDefinitions.set(evidenceCheck, {
    snapshot: deepFreeze(structuredClone(evidenceCheck)),
  });
  return evidenceCheck;
}

export function bindEvidenceCheckResult(result, evidenceCheck) {
  executionResults.set(result, executionDefinitions.get(evidenceCheck));
  return result;
}

export function isBoundEvidenceCheckResult(result, evidenceCheck) {
  const binding = executionResults.get(result);
  return Boolean(binding && isDeepStrictEqual(evidenceCheck, binding.snapshot));
}
