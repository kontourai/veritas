import { execFileSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { gitReadOptions, resolveCommitRef } from './git.mjs';
import { normalizeRepoPath } from '../paths.mjs';
import { matchesPatterns } from '../util/patterns.mjs';
import { uniqueStrings } from '../util/strings.mjs';

function readBaseNodes(baseRef, repoMapPath, rootDir, gitTimeoutMs) {
  const commit = resolveCommitRef(baseRef, rootDir, gitTimeoutMs);
  const mapPath = relative(rootDir, resolve(rootDir, repoMapPath ?? '.veritas/repo-map.json')).replaceAll('\\', '/');
  const raw = execFileSync('git', ['show', `${commit}:./${mapPath}`, '--'], gitReadOptions(rootDir, gitTimeoutMs));
  let map;
  try {
    map = JSON.parse(raw);
  } catch (error) {
    throw new Error('base Repo Map contains invalid JSON', { cause: error });
  }
  if (!Array.isArray(map?.graph?.nodes) || !map.graph.nodes.every((node) =>
    node && typeof node.id === 'string' && Array.isArray(node.patterns) && node.patterns.every((pattern) => typeof pattern === 'string'))) {
    throw new Error('base Repo Map has no valid graph.nodes');
  }
  return map.graph.nodes;
}

export function classifyNodes(files, config, rootDir, { baseRef, removedFiles = [], repoMapPath, gitTimeoutMs } = {}) {
  const removedPaths = new Set(removedFiles.map((file) => normalizeRepoPath(file, rootDir)));
  const classificationWarnings = [];
  let baseNodes = [];
  if (removedPaths.size > 0) {
    try {
      baseNodes = readBaseNodes(baseRef, repoMapPath, rootDir, gitTimeoutMs);
    } catch (error) {
      baseNodes = config.graph.nodes;
      classificationWarnings.push({
        kind: 'base-map-unavailable',
        severity: 'warn',
        message: `Warning: base Repo Map unavailable; removed paths use the current Repo Map. Reason: ${error.message}`,
        files: [...removedPaths].sort(),
      });
    }
  }
  const matchedNodeIds = new Set();
  const matchedLaneLabels = new Set();
  const matchedNodes = [];
  const fileNodes = {};
  const unmatchedFiles = [];

  for (const file of files) {
    const normalized = normalizeRepoPath(file, rootDir);
    let matched = false;
    for (const node of removedPaths.has(normalized) ? baseNodes : config.graph.nodes) {
      if (matchesPatterns(normalized, node.patterns)) {
        matchedNodeIds.add(node.id);
        matchedLaneLabels.add(node.label);
        const nodeSummary = {
          id: node.id,
          label: node.label,
          kind: node.kind,
          owners: uniqueStrings(node.owners ?? []),
          boundary: node.boundary ?? 'advisory',
          boundaryAllow: uniqueStrings(node.boundaryAllow ?? []),
        };
        if (!matchedNodes.some((item) => item.id === node.id)) {
          matchedNodes.push(nodeSummary);
        }
        fileNodes[normalized] = fileNodes[normalized] ?? [];
        fileNodes[normalized].push(nodeSummary);
        matched = true;
      }
    }
    if (!matched) {
      unmatchedFiles.push(normalized);
    }
  }

  return {
    affectedNodes: [...matchedNodeIds].sort(),
    affectedEvidenceChecks: [...matchedLaneLabels].sort(),
    matchedNodes,
    fileNodes,
    unmatchedFiles,
    classificationWarnings,
  };
}
