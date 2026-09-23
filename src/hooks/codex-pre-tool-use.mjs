import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluatePreToolUse, formatPreToolUseGuidance } from './pre-tool-use.mjs';

const PATCH_PATH_PREFIXES = [
  '*** Update File: ',
  '*** Add File: ',
  '*** Delete File: ',
  '*** Move to: ',
];
const MAX_EDIT_PATHS = 32;

/** Codex's apply_patch hook carries patch text in tool_input.command. */
export function codexEditPaths(payload) {
  const tool = payload?.tool_name;
  const input = payload?.tool_input;
  if (tool === 'apply_patch') {
    const patch = input?.command;
    if (typeof patch !== 'string') return [];
    const lines = patch.split(/\r?\n/);
    if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') return [];
    return [...new Set(lines.flatMap((line) => {
      const prefix = PATCH_PATH_PREFIXES.find((candidate) => line.startsWith(candidate));
      return prefix && line.slice(prefix.length).trim() ? [line.slice(prefix.length)] : [];
    }))];
  }
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') {
    const path = input?.file_path ?? input?.path;
    return typeof path === 'string' && path.length > 0 ? [path] : [];
  }
  return null;
}

export function evaluateCodexPreToolUse({ rootDir, stdinText, actor } = {}) {
  let payload;
  try {
    payload = JSON.parse(stdinText);
  } catch {
    if (process.env.VERITAS_HOOK_SKIP === '1') {
      const skipped = evaluatePreToolUse({ rootDir, actor, stdinText });
      return { decision: 'approve', reason: skipped.reason, paths: [], skipped: true, exceptionPath: skipped.exceptionPath };
    }
    return { decision: 'block', reason: 'Malformed Codex PreToolUse payload.', paths: [] };
  }
  const paths = codexEditPaths(payload);
  if (process.env.VERITAS_HOOK_SKIP === '1') {
    const skipped = evaluatePreToolUse({ rootDir, filePath: paths?.[0], actor, stdinText });
    return {
      decision: 'approve',
      reason: skipped.reason,
      paths: paths ?? [],
      skipped: true,
      exceptionPath: skipped.exceptionPath,
    };
  }
  if (paths === null) {
    return { decision: 'approve', reason: 'No file edit was requested.', paths: [] };
  }
  if (paths.length === 0 || paths.length > MAX_EDIT_PATHS) {
    return {
      decision: 'block',
      reason: paths.length === 0
        ? 'Codex edit supplied no parseable file path; Veritas cannot select pre-edit guidance.'
        : `Codex edit names more than ${MAX_EDIT_PATHS} paths; split the patch for a bounded briefing.`,
      paths,
    };
  }
  if (!existsSync(resolve(rootDir, '.veritas/repo-map.json'))) {
    return { decision: 'approve', reason: 'This repository has no Veritas Repo Map.', paths };
  }
  const results = paths.map((filePath) => evaluatePreToolUse({ rootDir, filePath, actor, stdinText }));
  const blocked = results.filter((result) => result.decision === 'block');
  if (blocked.length > 0) {
    return {
      decision: 'block',
      reason: blocked.map((result) => `${result.file ?? 'unknown path'}: ${result.reason}`).join('\n'),
      paths,
    };
  }
  const guidanceContext = results
    .filter((result) => result.guidance?.rules?.length > 0 && !result.skipped)
    .map((result) => formatPreToolUseGuidance(result.guidance))
    .join('\n\n');
  return {
    decision: 'approve',
    reason: `Veritas PreToolUse checks passed for ${paths.length} edited path(s).`,
    paths,
    ...(guidanceContext ? { guidanceContext } : {}),
    ...(results.some((result) => result.skipped) ? { skipped: true } : {}),
  };
}
