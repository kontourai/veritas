import { randomBytes } from 'node:crypto';

const executionDefinitionToken = Symbol('veritas.executionDefinitionToken');

export function bindEvidenceCheckExecution(evidenceCheck) {
  Object.defineProperty(evidenceCheck, executionDefinitionToken, {
    configurable: true,
    value: randomBytes(32).toString('base64url'),
  });
  return evidenceCheck;
}

export function bindEvidenceCheckResult(result, evidenceCheck) {
  Object.defineProperty(result, executionDefinitionToken, {
    configurable: true,
    value: evidenceCheck[executionDefinitionToken],
  });
  return result;
}

export function isBoundEvidenceCheckResult(result, evidenceCheck) {
  return Boolean(
    result?.[executionDefinitionToken]
      && evidenceCheck?.[executionDefinitionToken]
      && result[executionDefinitionToken] === evidenceCheck[executionDefinitionToken],
  );
}
