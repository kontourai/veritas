import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadJson } from './load.mjs';
import { assertWithinDir, relativeRepoPath } from './paths.mjs';

const GOVERNANCE_BLOCK_START = '<!-- veritas:governance-block:start -->';
const GOVERNANCE_BLOCK_END = '<!-- veritas:governance-block:end -->';

export function buildGovernanceBlock() {
  return `${GOVERNANCE_BLOCK_START}
This repo uses Veritas for AI governance. Read \`.veritas/GOVERNANCE.md\` before making changes.
After changes, run \`veritas readiness\` and address any FAIL lines before finishing.
${GOVERNANCE_BLOCK_END}`;
}

function defaultInstructionTargets(rootDir) {
  const targets = [
    { path: 'AGENTS.md', tool: 'codex', required: true },
    { path: 'CLAUDE.md', tool: 'claude-code', required: true },
  ];

  if (existsSync(resolve(rootDir, '.cursorrules'))) {
    targets.push({ path: '.cursorrules', tool: 'cursor', required: false });
  }

  return targets;
}

function normalizeGovernanceTargets(config = {}, rootDir = process.cwd()) {
  const configuredTargets = config.activation?.aiInstructionFiles;
  const rawTargets =
    Array.isArray(configuredTargets) && configuredTargets.length > 0
      ? configuredTargets
      : defaultInstructionTargets(rootDir);

  return rawTargets.map((target) => {
    if (typeof target === 'string') {
      return { path: target, tool: null, required: true };
    }
    return {
      path: target.path,
      tool: target.tool ?? null,
      required: target.required !== false,
    };
  });
}

function loadGovernanceTargetConfig({ rootDir, repoMapPath } = {}) {
  const resolvedRepoMapPath = repoMapPath ?? resolve(rootDir, '.veritas/repo-map.json');
  if (!existsSync(resolvedRepoMapPath)) {
    return {};
  }
  return loadJson(resolvedRepoMapPath, 'Repo Map');
}

function resolveTargetPath(rootDir, targetPath) {
  const resolvedPath = resolve(rootDir, targetPath);
  assertWithinDir(
    resolvedPath,
    rootDir,
    'governance block targets must stay inside the repository',
  );
  return resolvedPath;
}

export function replaceGovernanceBlock(content, block = buildGovernanceBlock()) {
  const markerPattern = new RegExp(
    `${GOVERNANCE_BLOCK_START}|${GOVERNANCE_BLOCK_END}`,
    'g',
  );
  const markers = [...content.matchAll(markerPattern)].map((match) => ({
    kind: match[0] === GOVERNANCE_BLOCK_START ? 'start' : 'end',
    start: match.index,
    end: match.index + match[0].length,
  }));

  if (markers.length > 0) {
    const pairedRanges = [];
    let openStart = null;
    for (const marker of markers) {
      if (marker.kind === 'start' && openStart === null) {
        openStart = marker;
      } else if (marker.kind === 'end' && openStart !== null) {
        pairedRanges.push({ start: openStart.start, end: marker.end });
        openStart = null;
      }
    }

    const removalRanges = [
      ...pairedRanges,
      ...markers
        .filter((marker) =>
          !pairedRanges.some((range) => marker.start >= range.start && marker.end <= range.end))
        .map((marker) => ({ start: marker.start, end: marker.end })),
    ].sort((left, right) => left.start - right.start);

    let normalized = '';
    let cursor = 0;
    for (const [index, range] of removalRanges.entries()) {
      normalized += content.slice(cursor, range.start);
      if (index === 0) normalized += block;
      cursor = range.end;
    }
    return normalized + content.slice(cursor);
  }

  const trimmedContent = content.replace(/\s*$/, '');
  return trimmedContent.length > 0 ? `${trimmedContent}\n\n${block}\n` : `${block}\n`;
}

function fileContainsCanonicalGovernanceBlock(content, block = buildGovernanceBlock()) {
  const startCount = content.split(GOVERNANCE_BLOCK_START).length - 1;
  const endCount = content.split(GOVERNANCE_BLOCK_END).length - 1;
  return startCount === 1 && endCount === 1 && content.includes(block);
}

export function inspectGovernanceBlockFile({ rootDir, filePath, block = buildGovernanceBlock() }) {
  const resolvedPath = resolveTargetPath(rootDir, filePath);
  if (!existsSync(resolvedPath)) {
    return {
      path: filePath,
      exists: false,
      canonical: false,
      stale: false,
    };
  }

  const content = readFileSync(resolvedPath, 'utf8');
  const startCount = content.split(GOVERNANCE_BLOCK_START).length - 1;
  const endCount = content.split(GOVERNANCE_BLOCK_END).length - 1;
  const startIndex = content.indexOf(GOVERNANCE_BLOCK_START);
  const endIndex = content.indexOf(GOVERNANCE_BLOCK_END);
  const hasAnyMarker = startCount > 0 || endCount > 0;
  const canonical = fileContainsCanonicalGovernanceBlock(content, block);
  const diagnostic = canonical
    ? null
    : !hasAnyMarker
      ? 'missing-governance-markers'
      : startCount > 1 || endCount > 1
        ? 'duplicate-governance-markers'
        : startCount !== 1 || endCount !== 1 || endIndex < startIndex
          ? 'malformed-governance-markers'
          : 'stale-governance-content';

  return {
    path: filePath,
    exists: true,
    canonical,
    diagnostic,
    missingMarkers: !hasAnyMarker,
    stale: hasAnyMarker && !canonical,
  };
}

export function applyGovernanceBlocks({
  rootDir,
  repoMapPath,
  force = false,
  block = buildGovernanceBlock(),
} = {}) {
  const config = loadGovernanceTargetConfig({ rootDir, repoMapPath });
  const targets = normalizeGovernanceTargets(config, rootDir);
  const applied = [];
  const skipped = [];

  for (const target of targets) {
    const resolvedPath = resolveTargetPath(rootDir, target.path);
    const relativePath = relativeRepoPath(rootDir, resolvedPath);
    const targetExists = existsSync(resolvedPath);

    if (!targetExists && !target.required && !force) {
      skipped.push({
        path: relativePath,
        reason: 'optional-target-missing',
      });
      continue;
    }

    const currentContent = targetExists ? readFileSync(resolvedPath, 'utf8') : '';
    const nextContent = replaceGovernanceBlock(currentContent, block);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, nextContent, 'utf8');
    applied.push({
      path: relativePath,
      tool: target.tool,
      created: !targetExists,
      required: target.required,
    });
  }

  return {
    rootDir,
    block,
    applied,
    skipped,
  };
}
