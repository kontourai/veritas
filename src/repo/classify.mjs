import { normalizeRepoPath } from '../paths.mjs';
import { matchesPatterns } from '../util/patterns.mjs';
import { uniqueStrings } from '../util/strings.mjs';

export function classifyNodes(files, config, rootDir) {
  const matchedNodeIds = new Set();
  const matchedLaneLabels = new Set();
  const matchedNodes = [];
  const fileNodes = {};
  const unmatchedFiles = [];

  for (const file of files) {
    const normalized = normalizeRepoPath(file, rootDir);
    let matched = false;
    for (const node of config.graph.nodes) {
      if (matchesPatterns(normalized, node.patterns)) {
        matchedNodeIds.add(node.id);
        matchedLaneLabels.add(node.label);
        const nodeSummary = {
          id: node.id,
          label: node.label,
          kind: node.kind,
          owners: uniqueStrings(node.owners ?? []),
          boundary: node.boundary ?? 'advisory',
          crossSurfaceAllow: uniqueStrings(node.crossSurfaceAllow ?? []),
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
    affectedLanes: [...matchedLaneLabels].sort(),
    matchedNodes,
    fileNodes,
    unmatchedFiles,
  };
}
