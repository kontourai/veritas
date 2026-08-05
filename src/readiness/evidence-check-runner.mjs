import { runBash, createMcpServerPool } from '../runner/index.mjs';
import {
  evidenceCheckLabel,
} from '../evidence/index.mjs';
import { bindEvidenceCheckExecution, bindEvidenceCheckResult } from '../evidence/execution-tokens.mjs';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Default per-evidence-check timeout (ms). Without it, a bash check waiting on
 * stdin/network hangs `veritas readiness` until manual SIGINT. Override per check
 * via `evidenceCheck.timeoutMs`, or globally via the `evidenceCheckTimeoutMs`
 * option. Generous so legitimately slow checks are not killed.
 */
const DEFAULT_EVIDENCE_CHECK_TIMEOUT_MS = 10 * 60_000;

function attachRuntimeTimeout(result, timedOut) {
  // record_schema_version 1 has no timedOut result field. Keep it available to
  // the live readiness decision without serializing a schema-incompatible
  // property into evidence artifacts or public JSON.
  Object.defineProperty(result, 'timedOut', {
    value: Boolean(timedOut),
    enumerable: false,
  });
  return result;
}

function buildEvidenceCheckResult(evidenceCheck, runner, label, result) {
  return attachRuntimeTimeout({
    id: evidenceCheck.id,
    runner,
    label,
    passed: runner === 'mcp' ? !result.isError : result.passed,
    exitCode: runner === 'bash' ? result.exitCode ?? null : null,
    signal: runner === 'bash' ? result.signal ?? null : null,
    stdout: runner === 'bash' ? result.stdout ?? '' : '',
    stderr: runner === 'bash' ? result.stderr ?? '' : '',
    ...(runner === 'bash' ? { content: [] } : {}),
    isError: runner === 'mcp' ? result.isError ?? false : false,
    durationMs: result.durationMs ?? 0,
  }, runner === 'bash' ? result.timedOut ?? false : false);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function emitEvidenceCheckOutput(onOutput, canonicalResult) {
  if (!onOutput) return;
  try {
    onOutput(deepFreeze(structuredClone(canonicalResult)));
  } catch {
    // Observers are diagnostic only and cannot affect readiness authority.
  }
}

function buildEvidenceCheckFailure(evidenceCheckResult, checkTimeoutMs) {
  const { runner, label } = evidenceCheckResult;
  const status = runner === 'mcp'
    ? 'MCP tool returned an error'
    : evidenceCheckResult.timedOut
      ? `timed out after ${checkTimeoutMs}ms`
      : (evidenceCheckResult.exitCode ?? evidenceCheckResult.signal ?? 'unknown status');
  return {
    phase: 'evidence-check',
    reason: evidenceCheckResult.timedOut ? 'timeout' : 'failed',
    id: evidenceCheckResult.id,
    runner,
    label,
    message: evidenceCheckResult.timedOut
      ? runner === 'mcp'
        ? `MCP Evidence Check timed out after ${checkTimeoutMs}ms`
        : `Evidence Check command ${status}`
      : runner === 'mcp'
        ? status
        : `Evidence Check command exited with ${status}`,
    ...(runner === 'bash' ? {
      stdout: evidenceCheckResult.stdout,
      stderr: evidenceCheckResult.stderr,
      exitCode: evidenceCheckResult.exitCode,
    } : {}),
  };
}

function buildEvidenceCheckRunnerErrorResult(evidenceCheck, runner, label, timedOut) {
  return attachRuntimeTimeout({
    id: evidenceCheck.id,
    runner,
    label,
    passed: false,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    ...(runner === 'bash' ? { content: [] } : {}),
    isError: runner === 'mcp',
    durationMs: 0,
  }, timedOut);
}

function isMcpTimeout(error) {
  return error?.code === ErrorCode.RequestTimeout;
}

async function runEvidenceChecks({ evidenceChecks, requiredEvidenceCheckIds, rootDir, signal, onOutput, onPhase, evidenceCheckTimeoutMs = DEFAULT_EVIDENCE_CHECK_TIMEOUT_MS }) {
  let evidenceCheckFailure = null;
  const evidenceCheckResults = [];
  const requiredIds = new Set(requiredEvidenceCheckIds ?? evidenceChecks.map((evidenceCheck) => evidenceCheck.id));
  const executionPlan = [
    ...evidenceChecks.filter((evidenceCheck) => requiredIds.has(evidenceCheck.id)),
    ...evidenceChecks.filter((evidenceCheck) => !requiredIds.has(evidenceCheck.id)),
  ];
  // Definitions stay caller-owned and mutable as normal configuration objects;
  // their execution association is private object identity, not a property.
  executionPlan.forEach(bindEvidenceCheckExecution);
  const pool = createMcpServerPool({ signal });
  try {
    for (const evidenceCheck of executionPlan) {
      const runner = evidenceCheck.runner ?? 'bash';
      const label = evidenceCheckLabel(evidenceCheck);
      const checkTimeoutMs = evidenceCheck.timeoutMs ?? evidenceCheckTimeoutMs;
      onPhase?.({
        phase: 'evidence-check',
        id: evidenceCheck.id,
        runner,
        label,
        timeoutMs: checkTimeoutMs,
      });
      try {
        const result = runner === 'mcp'
          ? await pool.call(
            evidenceCheck.server,
            evidenceCheck.tool,
            evidenceCheck.input ?? {},
            { signal, timeoutMs: checkTimeoutMs },
          )
          : await runBash(evidenceCheck.command, { cwd: rootDir, signal, timeoutMs: checkTimeoutMs });
        const evidenceCheckResult = deepFreeze(bindEvidenceCheckResult(
          buildEvidenceCheckResult(evidenceCheck, runner, label, result),
          evidenceCheck,
        ));
        evidenceCheckResults.push(evidenceCheckResult);
        if (!evidenceCheckResult.passed && requiredIds.has(evidenceCheck.id) && !evidenceCheckFailure) {
          evidenceCheckFailure = deepFreeze(bindEvidenceCheckResult(
            buildEvidenceCheckFailure(evidenceCheckResult, checkTimeoutMs),
            evidenceCheck,
          ));
        }
        emitEvidenceCheckOutput(onOutput, evidenceCheckResult);
      } catch (error) {
        const evidenceCheckResult = deepFreeze(bindEvidenceCheckResult(
          buildEvidenceCheckRunnerErrorResult(
            evidenceCheck,
            runner,
            label,
            runner === 'mcp' && isMcpTimeout(error),
          ),
          evidenceCheck,
        ));
        evidenceCheckResults.push(evidenceCheckResult);
        if (requiredIds.has(evidenceCheck.id) && !evidenceCheckFailure) {
          evidenceCheckFailure = deepFreeze(bindEvidenceCheckResult(
            buildEvidenceCheckFailure(evidenceCheckResult, checkTimeoutMs),
            evidenceCheck,
          ));
        }
        emitEvidenceCheckOutput(onOutput, evidenceCheckResult);
      }
    }
  } finally {
    await pool.close();
  }
  return { evidenceCheckFailure, evidenceCheckResults };
}

export async function runEvidenceCheckPlan({
  evidenceChecks,
  rootDir,
  runtime = {},
  evidenceCheckTimeoutMs,
  requiredEvidenceCheckIds,
}) {
  if (runtime.runEvidenceChecks === false) {
    return {
      evidenceCheckFailure: null,
      evidenceCheckResults: [],
    };
  }

  // This clone is the authority-bearing execution definition. Callers retain
  // their mutable config objects, while results are associated only with this
  // private, deeply immutable plan for the lifetime of the returned outcome.
  const executionEvidenceChecks = deepFreeze(structuredClone(evidenceChecks));
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const outcome = await runEvidenceChecks({
      evidenceChecks: executionEvidenceChecks,
      requiredEvidenceCheckIds,
      rootDir,
      signal: controller.signal,
      onOutput: runtime.onEvidenceCheckOutput,
      onPhase: runtime.onReadinessPhase,
      evidenceCheckTimeoutMs,
    });
    return outcome;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
