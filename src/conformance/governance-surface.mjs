import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const governanceRoots = ['.veritas/repo-map.json', '.veritas/repo-standards', '.veritas/authority'];

function git(rootDir, args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isGovernancePath(filePath) {
  return (
    filePath === '.veritas/repo-map.json' ||
    (filePath.startsWith('.veritas/repo-standards/') && filePath.endsWith('.json')) ||
    (filePath.startsWith('.veritas/authority/') && filePath.endsWith('.json'))
  );
}

function readGovernanceJsonAtRef(rootDir, ref, filePath) {
  try {
    return {
      exists: true,
      value: JSON.parse(git(rootDir, ['show', `${ref}:${filePath}`])),
    };
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
    if (
      detail.includes('exists on disk, but not in') ||
      detail.includes('does not exist in') ||
      detail.includes('Path \'.') ||
      detail.includes('Path ".')
    ) {
      return {
        exists: false,
        value: null,
      };
    }
    throw error;
  }
}

function listGovernancePathsAtRef(rootDir, ref) {
  try {
    return git(rootDir, ['ls-tree', '-r', '--name-only', ref, '--', ...governanceRoots])
      .split(/\r?\n/u)
      .map((filePath) => filePath.trim())
      .filter(Boolean)
      .filter(isGovernancePath)
      .sort();
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
    if (
      detail.includes('Not a valid object name') ||
      detail.includes('fatal: Not a valid object name')
    ) {
      return [];
    }
    throw error;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAdditiveJsonChange(baseValue, headValue) {
  if (Array.isArray(baseValue) || Array.isArray(headValue)) {
    if (!Array.isArray(baseValue) || !Array.isArray(headValue)) {
      return false;
    }
    if (headValue.length < baseValue.length) {
      return false;
    }
    for (let index = 0; index < baseValue.length; index += 1) {
      if (!isAdditiveJsonChange(baseValue[index], headValue[index])) {
        return false;
      }
    }
    return true;
  }

  if (isPlainObject(baseValue) || isPlainObject(headValue)) {
    if (!isPlainObject(baseValue) || !isPlainObject(headValue)) {
      return false;
    }
    for (const key of Object.keys(baseValue)) {
      if (!(key in headValue)) {
        return false;
      }
      if (!isAdditiveJsonChange(baseValue[key], headValue[key])) {
        return false;
      }
    }
    return true;
  }

  return isDeepStrictEqual(baseValue, headValue);
}

function describeGovernanceAssessment(assessment) {
  if (assessment.status === 'added') {
    return `${assessment.path} added`;
  }
  if (assessment.status === 'removed') {
    return `${assessment.path} removed`;
  }
  if (assessment.status === 'modified-additive') {
    return `${assessment.path} extended`;
  }
  if (assessment.status === 'equivalent') {
    return `${assessment.path} reformatted`;
  }
  return `${assessment.path} modified`;
}

function formatGovernanceSummary(classification, semanticAssessments, changedFiles, evaluated) {
  if (!evaluated) {
    return 'clean (no PR base/head diff)';
  }
  if (classification === 'clean') {
    return changedFiles.length > 0
      ? 'clean (no semantic governance changes)'
      : 'clean (no governance files changed)';
  }

  const descriptions = semanticAssessments.map(describeGovernanceAssessment);
  const preview = descriptions.slice(0, 2).join('; ');
  const remaining = descriptions.length - 2;
  const suffix = remaining > 0 ? `; +${remaining} more` : '';
  return `${classification} (${preview}${suffix})`;
}

function buildGovernanceTrendSummary(entries) {
  if (entries.length === 0) {
    return {
      available_runs: 0,
      sampled_runs: 0,
      clean: 0,
      additive_only: 0,
      protected_standards_modification: 0,
      latest_non_clean_run_id: null,
      latest_non_clean_classification: null,
      summary: 'no prior governance history',
    };
  }

  const counts = {
    clean: entries.filter((entry) => entry.classification === 'clean').length,
    additive_only: entries.filter((entry) => entry.classification === 'additive-only').length,
    protected_standards_modification: entries.filter(
      (entry) => entry.classification === 'protected-standards-modification',
    ).length,
  };
  const latestNonClean = [...entries]
    .reverse()
    .find((entry) => entry.classification !== 'clean');

  const summary = `last ${entries.length} governance run(s): ${counts.clean} clean, ${counts.additive_only} additive-only, ${counts.protected_standards_modification} protected-standards-modification`;

  return {
    available_runs: entries.length,
    sampled_runs: entries.length,
    ...counts,
    latest_non_clean_run_id: latestNonClean?.run_id ?? null,
    latest_non_clean_classification: latestNonClean?.classification ?? null,
    summary,
  };
}

export function summarizeGovernanceTrend({
  rootDir,
  currentRunId,
  currentGovernanceSurface,
}) {
  const conformanceDir = resolve(rootDir, '.veritas/repo-conformance');
  if (!existsSync(conformanceDir) || !readdirSync(conformanceDir, { withFileTypes: false }).length) {
    return buildGovernanceTrendSummary([
      {
        run_id: currentRunId,
        classification: currentGovernanceSurface.classification,
      },
    ]);
  }

  const historical = [];
  for (const entry of readdirSync(conformanceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'latest.json') {
      continue;
    }
    const filePath = resolve(conformanceDir, entry.name);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed?.governance_surface?.classification) {
      continue;
    }
    if (parsed.run_id === currentRunId) {
      continue;
    }
    historical.push({
      run_id: parsed.run_id,
      classification: parsed.governance_surface.classification,
      generated_at: parsed.generated_at ?? parsed.timestamp ?? null,
    });
  }

  historical.sort((left, right) =>
    String(left.generated_at ?? left.run_id).localeCompare(String(right.generated_at ?? right.run_id)),
  );
  const sampled = historical.slice(-9);
  sampled.push({
    run_id: currentRunId,
    classification: currentGovernanceSurface.classification,
    generated_at: null,
  });
  return buildGovernanceTrendSummary(sampled);
}

export function classifyGovernanceSurface({
  rootDir = process.cwd(),
  changedFrom,
  changedTo,
} = {}) {
  const evaluated = Boolean(changedFrom && changedTo);
  if (!evaluated) {
    return {
      classification: 'clean',
      summary: 'clean (no PR base/head diff)',
      evaluated: false,
      compared_refs: {
        base: changedFrom ?? null,
        head: changedTo ?? null,
      },
      files: [],
      changed_paths: [],
      semantic_changed_paths: [],
    };
  }

  const diffPaths = git(rootDir, [
    'diff',
    '--name-only',
    changedFrom,
    changedTo,
    '--',
    ...governanceRoots,
  ])
    .split(/\r?\n/u)
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .filter(isGovernancePath);
  const changedPathSet = new Set(diffPaths);
  const basePaths = listGovernancePathsAtRef(rootDir, changedFrom);
  const headPaths = listGovernancePathsAtRef(rootDir, changedTo);
  const candidatePaths = Array.from(new Set([...basePaths, ...headPaths, ...diffPaths])).sort();

  const fileAssessments = candidatePaths.map((filePath) => {
    const baseSnapshot = readGovernanceJsonAtRef(rootDir, changedFrom, filePath);
    const headSnapshot = readGovernanceJsonAtRef(rootDir, changedTo, filePath);

    if (!baseSnapshot.exists && headSnapshot.exists) {
      return {
        path: filePath,
        status: 'added',
        additive: true,
        semantic_change: true,
      };
    }

    if (baseSnapshot.exists && !headSnapshot.exists) {
      return {
        path: filePath,
        status: 'removed',
        additive: false,
        semantic_change: true,
      };
    }

    if (isDeepStrictEqual(baseSnapshot.value, headSnapshot.value)) {
      return {
        path: filePath,
        status: 'equivalent',
        additive: true,
        semantic_change: false,
      };
    }

    const additive = isAdditiveJsonChange(baseSnapshot.value, headSnapshot.value);
    return {
      path: filePath,
      status: additive ? 'modified-additive' : 'modified-protected-standards',
      additive,
      semantic_change: true,
    };
  });
  const relevantAssessments = fileAssessments.filter(
    (assessment) => assessment.semantic_change || changedPathSet.has(assessment.path),
  );

  const semanticAssessments = relevantAssessments.filter((assessment) => assessment.semantic_change);
  const classification =
    semanticAssessments.length === 0
      ? 'clean'
      : semanticAssessments.every((assessment) => assessment.additive)
        ? 'additive-only'
        : 'protected-standards-modification';

  return {
    classification,
    summary: formatGovernanceSummary(
      classification,
      semanticAssessments,
      diffPaths,
      true,
    ),
    evaluated: true,
    compared_refs: {
      base: changedFrom,
      head: changedTo,
    },
    files: relevantAssessments,
    changed_paths: Array.from(changedPathSet).sort(),
    semantic_changed_paths: semanticAssessments.map((assessment) => assessment.path),
  };
}

export function renderGovernanceSurfaceLine(governanceSurface) {
  return `- **Governance surface:** ${governanceSurface.summary}`;
}
