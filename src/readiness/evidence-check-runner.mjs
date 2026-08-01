import { runBash, createMcpServerPool } from '../runner/index.mjs';
import { evidenceCheckLabel } from '../evidence/index.mjs';
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
    runner,
    label,
    passed: runner === 'mcp' ? !result.isError : result.passed,
    exitCode: runner === 'bash' ? result.exitCode ?? null : null,
    signal: runner === 'bash' ? result.signal ?? null : null,
    stdout: runner === 'bash' ? result.stdout ?? '' : '',
    stderr: runner === 'bash' ? result.stderr ?? '' : '',
    content: runner === 'mcp' ? result.content ?? [] : [],
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
    reason: runner === 'bash' && evidenceCheckResult.timedOut ? 'timeout' : 'failed',
    id: evidenceCheckResult.id,
    runner,
    label,
    message: runner === 'mcp'
      ? status
      : evidenceCheckResult.timedOut
        ? `Evidence Check command ${status}`
        : `Evidence Check command exited with ${status}`,
    ...(runner === 'bash' ? {
      stdout: evidenceCheckResult.stdout,
      stderr: evidenceCheckResult.stderr,
      exitCode: evidenceCheckResult.exitCode,
    } : {
      content: evidenceCheckResult.content,
      isError: evidenceCheckResult.isError,
    }),
  };
}

function isMcpTimeout(error) {
  return error?.code === ErrorCode.RequestTimeout;
}

async function runEvidenceChecks({ evidenceChecks, rootDir, signal, onOutput, onPhase, evidenceCheckTimeoutMs = DEFAULT_EVIDENCE_CHECK_TIMEOUT_MS }) {
  let evidenceCheckFailure = null;
  const evidenceCheckResults = [];
  const pool = createMcpServerPool({ signal });
  try {
    for (const evidenceCheck of evidenceChecks) {
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
        if (!evidenceCheckResult.passed) {
          evidenceCheckFailure = buildEvidenceCheckFailure(evidenceCheckResult, checkTimeoutMs);
          break;
        }
      } catch (error) {
        evidenceCheckFailure = {
          phase: 'evidence-check',
          reason: runner === 'mcp' && isMcpTimeout(error) ? 'timeout' : 'runner-error',
          id: evidenceCheck.id,
          runner,
          label,
          message: runner === 'mcp' && isMcpTimeout(error)
            ? `MCP Evidence Check timed out after ${checkTimeoutMs}ms`
            : error.message,
        };
        break;
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
