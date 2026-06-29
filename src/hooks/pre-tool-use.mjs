import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRepoMap, loadRepoStandards } from '../load.mjs';
import { relativeRepoPath } from '../paths.mjs';
import { evaluateWorkAreaBoundaryRule, evaluateRepoStandards } from '../rules/evaluate.mjs';
import { readCurrentAttestation } from '../attestations.mjs';

function normalizeHookFilePath(rootDir, filePath) {
  if (!filePath) return null;
  const resolvedPath = resolve(rootDir, filePath);
  return relativeRepoPath(rootDir, resolvedPath);
}

function findFilePathInHookPayload(payload) {
  const candidates = [
    payload?.tool_input?.file_path,
    payload?.tool_input?.path,
    payload?.file_path,
    payload?.path,
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? null;
}

function readHookPayload(stdinText) {
  if (!stdinText.trim()) return {};
  try {
    return JSON.parse(stdinText);
  } catch (error) {
    return {
      __veritasHookPayloadError: error instanceof Error ? error.message : 'invalid JSON',
    };
  }
}

function resolveHookActor(rootDir, explicitActor) {
  if (explicitActor) return explicitActor;
  if (process.env.VERITAS_ACTOR) return process.env.VERITAS_ACTOR;
  return readCurrentAttestation(rootDir)?.actor?.id ?? null;
}

function buildBuiltinWorkAreaBoundaryRule() {
  return {
    id: 'work-area-boundary',
    kind: 'work-area-boundary',
    classification: 'hard-invariant',
    enforcementLevel: 'Require',
    enforcement: 'deny',
    message: 'Strict work areas cannot be edited by actors without ownership or explicit allowlist access.',
    owner: 'repo-core',
    rollback_switch: null,
    match: {},
  };
}

function deniedResults(results) {
  return results.filter((result) => result.enforcement === 'deny' && result.passed === false);
}

function formatDenyReason(results) {
  return results
    .map((result) => {
      const findings = (result.findings ?? [])
        .map((finding) => finding.artifact ?? finding.path ?? finding.required ?? finding.kind)
        .filter(Boolean)
        .join(', ');
      return findings ? `${result.rule_id}: ${result.summary} (${findings})` : `${result.rule_id}: ${result.summary}`;
    })
    .join('\n');
}

function writeExceptionRecord(rootDir, exception) {
  const exceptionsDir = resolve(rootDir, '.veritas/standards-feedback');
  mkdirSync(exceptionsDir, { recursive: true });
  const path = resolve(exceptionsDir, 'exceptions.jsonl');
  appendFileSync(path, `${JSON.stringify(exception)}\n`, 'utf8');
  return relativeRepoPath(rootDir, path);
}

export function evaluatePreToolUse({
  rootDir,
  filePath,
  stdinText = '',
  actor,
} = {}) {
  const payload = readHookPayload(stdinText);
  if (payload.__veritasHookPayloadError) {
    return {
      decision: 'block',
      reason: `Malformed PreToolUse payload: ${payload.__veritasHookPayloadError}`,
      file: null,
      actor: resolveHookActor(rootDir, actor),
      results: [],
    };
  }
  const relativeFile = normalizeHookFilePath(rootDir, filePath ?? findFilePathInHookPayload(payload));
  if (!relativeFile) {
    return {
      decision: 'approve',
      reason: 'No file path found in PreToolUse payload.',
      file: null,
      actor: resolveHookActor(rootDir, actor),
      results: [],
    };
  }
  const config = loadRepoMap(resolve(rootDir, '.veritas/repo-map.json'));
  const repoStandards = loadRepoStandards(resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json'));
  const effectiveActor = resolveHookActor(rootDir, actor);
  const policyResults = evaluateRepoStandards(repoStandards, {
    rootDir,
    changedFiles: [relativeFile],
    config,
    actor: effectiveActor,
  });
  const workAreaBoundaryResult = evaluateWorkAreaBoundaryRule(buildBuiltinWorkAreaBoundaryRule(), {
    rootDir,
    changedFiles: [relativeFile],
    config,
    actor: effectiveActor,
  });
  const results = [workAreaBoundaryResult, ...policyResults];
  const blocked = deniedResults(results);
  const exceptionRule = process.env.VERITAS_EXCEPTION_RULE;
  const exceptionReason = process.env.VERITAS_EXCEPTION_REASON;
  if (blocked.length > 0 && exceptionRule && exceptionReason) {
    const matching = blocked.find((result) => result.rule_id === exceptionRule);
    if (matching) {
      const exception = {
        ruleId: exceptionRule,
        reason: exceptionReason,
        actor: effectiveActor,
        timestamp: new Date().toISOString(),
        file: relativeFile,
      };
      return {
        decision: 'approve',
        reason: `Exception accepted for ${exceptionRule}: ${exceptionReason}`,
        file: relativeFile,
        actor: effectiveActor,
        results,
        exceptions: [exception],
        exceptionPath: writeExceptionRecord(rootDir, exception),
      };
    }
  }
  if (blocked.length > 0) {
    return {
      decision: 'block',
      reason: formatDenyReason(blocked),
      file: relativeFile,
      actor: effectiveActor,
      results,
    };
  }
  return {
    decision: 'approve',
    reason: `Veritas PreToolUse checks passed for ${relativeFile}.`,
    file: relativeFile,
    actor: effectiveActor,
    results,
  };
}
