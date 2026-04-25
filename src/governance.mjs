import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadJson } from './load.mjs';
import { assertWithinDir, relativeRepoPath } from './paths.mjs';

export const GOVERNANCE_BLOCK_START = '<!-- veritas:governance-block:start -->';
export const GOVERNANCE_BLOCK_END = '<!-- veritas:governance-block:end -->';

export function buildGovernanceBlock() {
  return `${GOVERNANCE_BLOCK_START}
This repo uses Veritas for AI governance. Read \`.veritas/GOVERNANCE.md\` before making changes.
After changes, run \`veritas shadow run\` and address any FAIL lines before finishing.
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

export function normalizeGovernanceTargets(config = {}, rootDir = process.cwd()) {
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

export function loadGovernanceTargetConfig({ rootDir, adapterPath } = {}) {
  const resolvedAdapterPath = adapterPath ?? resolve(rootDir, '.veritas/repo.adapter.json');
  if (!existsSync(resolvedAdapterPath)) {
    return {};
  }
  return loadJson(resolvedAdapterPath, 'adapter config');
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
  const startIndex = content.indexOf(GOVERNANCE_BLOCK_START);
  const endIndex = content.indexOf(GOVERNANCE_BLOCK_END);
  if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
    const afterEndIndex = endIndex + GOVERNANCE_BLOCK_END.length;
    return `${content.slice(0, startIndex)}${block}${content.slice(afterEndIndex)}`;
  }

  const trimmedContent = content.replace(/\s*$/, '');
  return trimmedContent.length > 0 ? `${trimmedContent}\n\n${block}\n` : `${block}\n`;
}

export function fileContainsCanonicalGovernanceBlock(content, block = buildGovernanceBlock()) {
  return content.includes(block);
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
  const hasStart = content.includes(GOVERNANCE_BLOCK_START);
  const hasEnd = content.includes(GOVERNANCE_BLOCK_END);
  const canonical = fileContainsCanonicalGovernanceBlock(content, block);

  return {
    path: filePath,
    exists: true,
    canonical,
    stale: (hasStart || hasEnd) && !canonical,
  };
}

export function applyGovernanceBlocks({
  rootDir,
  adapterPath,
  force = false,
  block = buildGovernanceBlock(),
} = {}) {
  const config = loadGovernanceTargetConfig({ rootDir, adapterPath });
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
