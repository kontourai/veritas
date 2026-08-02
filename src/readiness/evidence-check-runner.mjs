import { runBash, createMcpServerPool } from '../runner/index.mjs';
import { evidenceCheckDefinitionDigest, evidenceCheckLabel } from '../evidence/index.mjs';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Default per-evidence-check timeout (ms). Without it, a bash check waiting on
 * stdin/network hangs `veritas readiness` until manual SIGINT. Override per check
 * via `evidenceCheck.timeoutMs`, or globally via the `evidenceCheckTimeoutMs`
 * option. Generous so legitimately slow checks are not killed.
 */
const DEFAULT_EVIDENCE_CHECK_TIMEOUT_MS = 10 * 60_000;

function buildEvidenceCheckResult(evidenceCheck, runner, label, result) {
  return {
    id: evidenceCheck.id,
    definition_digest: evidenceCheckDefinitionDigest(evidenceCheck),
    runner,
    label,
    passed: runner === 'mcp' ? !result.isError : result.passed,
    exitCode: runner === 'bash' ? result.exitCode ?? null : null,
    signal: runner === 'bash' ? result.signal ?? null : null,
    stdout: runner === 'bash' ? result.stdout ?? '' : '',
    stderr: runner === 'bash' ? result.stderr ?? '' : '',
    content: runner === 'mcp' ? redactMcpContent(result.content ?? [], evidenceCheck) : [],
    isError: runner === 'mcp' ? result.isError ?? false : false,
    timedOut: runner === 'bash' ? result.timedOut ?? false : false,
    durationMs: result.durationMs ?? 0,
  };
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
    definition_digest: evidenceCheckResult.definition_digest,
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

function redactMcpContent(content, evidenceCheck) {
  const secrets = [...secretStrings(evidenceCheck.server?.env), ...secretStrings(evidenceCheck.input)];
  return redactValue(content, secrets);
}

function secretStrings(value) {
  if (typeof value === 'string') return value.length > 0 ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => secretStrings(item));
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => secretStrings(item));
  return [];
}

function redactValue(value, secrets) {
  if (typeof value === 'string') {
    return secrets.reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]));
  }
  return value;
}

function buildEvidenceCheckRunnerErrorResult(evidenceCheck, runner, label, timedOut) {
  return {
    id: evidenceCheck.id,
    definition_digest: evidenceCheckDefinitionDigest(evidenceCheck),
    runner,
    label,
    passed: false,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    content: [],
    isError: runner === 'mcp',
    timedOut,
    durationMs: 0,
  };
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
        const evidenceCheckResult = buildEvidenceCheckResult(evidenceCheck, runner, label, result);
        evidenceCheckResults.push(evidenceCheckResult);
        onOutput?.(evidenceCheckResult);
        if (!evidenceCheckResult.passed && requiredIds.has(evidenceCheck.id) && !evidenceCheckFailure) {
          evidenceCheckFailure = buildEvidenceCheckFailure(evidenceCheckResult, checkTimeoutMs);
        }
      } catch (error) {
        const evidenceCheckResult = buildEvidenceCheckRunnerErrorResult(
          evidenceCheck,
          runner,
          label,
          runner === 'mcp' && isMcpTimeout(error),
        );
        evidenceCheckResults.push(evidenceCheckResult);
        onOutput?.(evidenceCheckResult);
        if (requiredIds.has(evidenceCheck.id) && !evidenceCheckFailure) {
          evidenceCheckFailure = buildEvidenceCheckFailure(evidenceCheckResult, checkTimeoutMs);
        }
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

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    return await runEvidenceChecks({
      evidenceChecks,
      requiredEvidenceCheckIds,
      rootDir,
      signal: controller.signal,
      onOutput: runtime.onEvidenceCheckOutput,
      onPhase: runtime.onReadinessPhase,
      evidenceCheckTimeoutMs,
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
