import { randomBytes } from 'node:crypto';

const executionDefinitions = new WeakMap();
const executionResults = new WeakMap();

export function bindEvidenceCheckExecution(evidenceCheck) {
  executionDefinitions.set(evidenceCheck, randomBytes(32));
  return evidenceCheck;
}

export function bindEvidenceCheckResult(result, evidenceCheck) {
  executionResults.set(result, executionDefinitions.get(evidenceCheck));
  return result;
}

export function isBoundEvidenceCheckResult(result, evidenceCheck) {
  return Boolean(
    executionResults.has(result)
      && executionDefinitions.has(evidenceCheck)
      && executionResults.get(result) === executionDefinitions.get(evidenceCheck),
  );
}
