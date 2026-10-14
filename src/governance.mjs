import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { loadJson } from './load.mjs';
import { assertWithinDir, relativeRepoPath } from './paths.mjs';

const GOVERNANCE_BLOCK_START = '<!-- veritas:governance-block:start -->';
const GOVERNANCE_BLOCK_END = '<!-- veritas:governance-block:end -->';

export function buildGovernanceBlock() {
  return `${GOVERNANCE_BLOCK_START}
This repo uses Veritas for AI governance. Read \`.veritas/GOVERNANCE.md\` before making changes.
After changes, run \`npx --no @kontourai/veritas readiness\` and address any FAIL lines before finishing.
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

const INVALID_TARGET_REASON = 'a governance block target must be a repository-relative path to a file inside the repository';

function normalizeGovernanceTarget(target) {
  if (typeof target === 'string') {
    return { path: target, tool: null, required: true };
  }
  return {
    path: target?.path,
    tool: target?.tool ?? null,
    required: target?.required !== false,
  };
}

/**
 * The repository-relative, `/`-separated form of a target path, so `./AGENTS.md` and `AGENTS.md`
 * name one target. Null for a path that is not a file inside the repository: empty, absolute, the
 * root itself, or escaping it (`..`, or a symlinked parent that leads outside).
 */
function repoRelativeTargetPath(rootDir, path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) return null;
  const resolvedPath = resolve(rootDir, path);
  try {
    assertWithinDir(resolvedPath, rootDir);
  } catch {
    return null;
  }
  const relativePath = relative(resolve(rootDir), resolvedPath).split(sep).join('/');
  return relativePath === '' ? null : relativePath;
}

/**
 * The single answer to "which AI instruction files carry the governance block",
 * shared by `apply governance-blocks` and the `governance-block` readiness rule.
 *
 * Two settings name these files: the Repo Map's `activation.aiInstructionFiles`
 * and each `governance-block` rule's `match['governance-block']`. `init` writes
 * both from the same selection, and writes `[]` to both when the repository has
 * no instruction files, so an explicit `[]` is a recorded choice of "none", not
 * an unset value. The schemas set no `minItems` on either list.
 *
 * - A list that is present counts as configured, even when it is empty.
 * - When either list is configured, the targets are the union of the configured
 *   lists. A path named by a rule is required, because readiness requires it; a
 *   Repo Map entry keeps its own `required` flag.
 * - Only when neither list is configured do the built-in defaults apply.
 * - Paths are compared in repository-relative form. A path that does not name a file inside
 *   the repository is returned in `invalidTargets`, never in `targets`, so no caller reads or
 *   writes outside the repository.
 *
 * @param {object} options
 * @param {string} options.rootDir
 * @param {object} [options.repoMap] Repo Map config.
 * @param {object[]|null} [options.governanceRules] `governance-block` rules, or
 *   null when no Repo Standards were loaded.
 */
export function resolveGovernanceBlockTargets({ rootDir, repoMap, governanceRules = null } = {}) {
  const mapTargets = repoMap?.activation?.aiInstructionFiles;
  const mapConfigured = Array.isArray(mapTargets);
  const rules = Array.isArray(governanceRules) ? governanceRules : [];
  const rulesConfigured = rules.length > 0;

  if (!mapConfigured && !rulesConfigured) {
    return { source: 'default', targets: defaultInstructionTargets(rootDir), invalidTargets: [] };
  }

  const byPath = new Map();
  const invalidPaths = new Set();
  const add = (candidate) => {
    const path = repoRelativeTargetPath(rootDir, candidate.path);
    if (path === null) {
      invalidPaths.add(String(candidate.path ?? ''));
      return;
    }
    const target = { ...candidate, path };
    const existing = byPath.get(path);
    if (!existing) {
      byPath.set(path, target);
      return;
    }
    byPath.set(path, {
      path,
      tool: existing.tool ?? target.tool,
      required: existing.required || target.required,
    });
  };

  if (mapConfigured) {
    for (const target of mapTargets) add(normalizeGovernanceTarget(target));
  }
  for (const rule of rules) {
    const rulePaths = rule.match?.['governance-block'];
    for (const path of Array.isArray(rulePaths) ? rulePaths : []) {
      add({ path, tool: null, required: true });
    }
  }

  return {
    source: 'configured',
    targets: [...byPath.values()],
    invalidTargets: [...invalidPaths].map((path) => ({ path, reason: INVALID_TARGET_REASON })),
  };
}

function loadOptionalJson(filePath, label) {
  return existsSync(filePath) ? loadJson(filePath, label) : null;
}

function loadGovernanceTargetSources({ rootDir, repoMapPath, repoStandardsPath } = {}) {
  const repoMap = loadOptionalJson(
    repoMapPath ?? resolve(rootDir, '.veritas/repo-map.json'),
    'Repo Map',
  );
  const repoStandards = loadOptionalJson(
    repoStandardsPath ?? resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json'),
    'Repo Standards',
  );
  const governanceRules = Array.isArray(repoStandards?.rules)
    ? repoStandards.rules.filter((rule) => rule?.kind === 'governance-block')
    : null;
  return { repoMap: repoMap ?? {}, governanceRules };
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
      diagnostic: 'missing-governance-file',
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
  repoStandardsPath,
  force = false,
  block = buildGovernanceBlock(),
} = {}) {
  const { repoMap, governanceRules } = loadGovernanceTargetSources({
    rootDir,
    repoMapPath,
    repoStandardsPath,
  });
  const { targets, invalidTargets } = resolveGovernanceBlockTargets({ rootDir, repoMap, governanceRules });
  // Checked before any write, so a bad entry never leaves the targets half applied.
  if (invalidTargets.length > 0) {
    throw new Error(
      `Refusing to apply governance blocks: ${invalidTargets.map(({ path }) => JSON.stringify(path)).join(', ')} `
        + `in activation.aiInstructionFiles or a governance-block requirement is not valid; ${INVALID_TARGET_REASON}. Correct or remove it.`,
    );
  }
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
    ...(targets.length === 0
      ? {
          message:
            'No AI instruction files are configured: activation.aiInstructionFiles in the Repo Map and the governance-block requirement both list none. Nothing was written.',
        }
      : {}),
  };
}
