import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertWithinDir } from '../paths.mjs';

export function assertExternalToolConfig(externalTool) {
  if (!externalTool || typeof externalTool !== 'object' || Array.isArray(externalTool)) {
    throw new Error('Veritas adapter evidence.proofLanes[].externalTool must be an object.');
  }
  for (const field of ['tool', 'format', 'artifactPath']) {
    if (typeof externalTool[field] !== 'string' || externalTool[field].length === 0) {
      throw new Error(`Veritas adapter evidence.proofLanes[].externalTool.${field} must be a non-empty string.`);
    }
  }
  if (typeof externalTool.blocking !== 'boolean') {
    throw new Error('Veritas adapter evidence.proofLanes[].externalTool.blocking must be a boolean.');
  }
  const artifactPath = externalTool.artifactPath;
  if (artifactPath.startsWith('/') || artifactPath.includes('..') || !artifactPath.startsWith('.veritas/')) {
    throw new Error('Veritas adapter evidence.proofLanes[].externalTool.artifactPath must be a repo-local path inside .veritas/.');
  }
}

export function readExternalToolPayload(rootDir, artifactPath) {
  const resolvedPath = resolve(rootDir, artifactPath);
  assertWithinDir(
    resolvedPath,
    resolve(rootDir, '.veritas'),
    'external tool artifacts may only be read from .veritas/',
  );
  if (!existsSync(resolvedPath)) return null;
  try {
    return JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read external tool artifact ${artifactPath}: ${error.message}`);
  }
}

export function normalizeExternalToolVerdict(payload) {
  if (payload?.verdict === 'pass' || payload?.verdict === 'warn' || payload?.verdict === 'fail') {
    return payload.verdict;
  }
  if (typeof payload?.total_issues === 'number') {
    return payload.total_issues > 0 ? 'warn' : 'pass';
  }
  if (payload?.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)) {
    const numericCounts = Object.values(payload.summary).filter((value) => typeof value === 'number');
    if (numericCounts.length > 0) {
      return numericCounts.some((value) => value > 0) ? 'warn' : 'pass';
    }
  }
  return 'unknown';
}

export function externalToolSummary(payload) {
  const summary = {};
  if (payload?.summary && typeof payload.summary === 'object' && !Array.isArray(payload.summary)) {
    Object.assign(summary, payload.summary);
  }
  if (typeof payload?.total_issues === 'number') summary.total_issues = payload.total_issues;
  if (Array.isArray(payload?.unused_exports)) summary.unused_exports = payload.unused_exports.length;
  if (Array.isArray(payload?.unused_files)) summary.unused_files = payload.unused_files.length;
  if (Array.isArray(payload?.unused_dependencies)) summary.unused_dependencies = payload.unused_dependencies.length;
  if (Array.isArray(payload?.boundary_violations)) summary.boundary_violations = payload.boundary_violations.length;
  if (Array.isArray(payload?.circular_dependencies)) summary.circular_dependencies = payload.circular_dependencies.length;
  if (Array.isArray(payload?.duplication?.clone_groups)) summary.duplication_clone_groups = payload.duplication.clone_groups.length;
  if (Array.isArray(payload?.dupes?.clone_groups)) summary.duplication_clone_groups = payload.dupes.clone_groups.length;
  if (typeof payload?.health?.summary?.functions_above_threshold === 'number') {
    summary.functions_above_threshold = payload.health.summary.functions_above_threshold;
  }
  return summary;
}

export function externalToolActions(payload) {
  if (!Array.isArray(payload?.actions)) return [];
  return payload.actions
    .filter((action) => action && typeof action === 'object')
    .slice(0, 20)
    .map((action) => ({
      type: String(action.type ?? 'external-tool-action'),
      description: String(action.description ?? action.message ?? 'External tool action'),
      auto_fixable: Boolean(action.auto_fixable),
      ...(Array.isArray(action.paths) ? { paths: action.paths.filter((path) => typeof path === 'string') } : {}),
    }));
}

export function buildExternalToolResults({ proofLanes, rootDir }) {
  return proofLanes
    .filter((lane) => lane.externalTool)
    .map((lane) => {
      const externalTool = lane.externalTool;
      const payload = readExternalToolPayload(rootDir, externalTool.artifactPath);
      if (!payload) {
        return {
          tool: externalTool.tool,
          format: externalTool.format,
          command: lane.command,
          proof_lane_id: lane.id,
          verdict: 'missing',
          blocking: externalTool.blocking,
          summary: { message: `External tool artifact ${externalTool.artifactPath} was not found.` },
          artifact_path: externalTool.artifactPath,
          actions: [],
        };
      }
      return {
        tool: externalTool.tool,
        format: externalTool.format,
        command: lane.command,
        proof_lane_id: lane.id,
        verdict: normalizeExternalToolVerdict(payload),
        blocking: externalTool.blocking,
        summary: externalToolSummary(payload),
        artifact_path: externalTool.artifactPath,
        actions: externalToolActions(payload),
      };
    });
}
