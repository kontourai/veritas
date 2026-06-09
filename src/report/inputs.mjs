import { execFileSync } from 'node:child_process';
import { resolveSourceRef } from './integrity.mjs';

export function listChangedFiles(fromRef, toRef, rootDir) {
  if (!fromRef || !toRef) return [];

  return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', fromRef, toRef], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function listGitFiles(args, rootDir) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listWorkingTreeFiles(
  { staged = false, unstaged = false, untracked = false } = {},
  rootDir,
) {
  const files = new Set();

  if (staged) {
    for (const file of listGitFiles(
      ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  if (unstaged) {
    for (const file of listGitFiles(
      ['diff', '--name-only', '--diff-filter=ACMR'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  if (untracked) {
    for (const file of listGitFiles(
      ['ls-files', '--others', '--exclude-standard'],
      rootDir,
    )) {
      files.add(file);
    }
  }

  return [...files].sort();
}

export function resolveReportInputs(explicitFiles, options, rootDir) {
  if (explicitFiles.length > 0) {
    return {
      files: explicitFiles,
      sourceKind: 'explicit-files',
      sourceScope: ['explicit'],
      sourceRef: resolveSourceRef({
        explicitSourceRef: options.sourceRef,
        rootDir,
        sourceKind: 'explicit-files',
      }),
    };
  }

  if (options.changedFrom || options.changedTo) {
    if (!options.changedFrom || !options.changedTo) {
      throw new Error(
        'branch-diff reporting requires both --changed-from and --changed-to',
      );
    }
    const sourceRef = options.sourceRef ?? `${options.changedFrom}..${options.changedTo}`;
    return {
      files: listChangedFiles(options.changedFrom, options.changedTo, rootDir),
      sourceKind: 'branch-diff',
      sourceScope: [
        ...(options.changedFrom ? [`changed-from:${options.changedFrom}`] : []),
        ...(options.changedTo ? [`changed-to:${options.changedTo}`] : []),
      ],
      sourceRef,
    };
  }

  const workingTreeScopes = [
    ...(options.workingTree ? ['staged', 'unstaged', 'untracked'] : []),
    ...(options.staged ? ['staged'] : []),
    ...(options.unstaged ? ['unstaged'] : []),
    ...(options.untracked ? ['untracked'] : []),
  ];

  if (workingTreeScopes.length > 0) {
    const uniqueScopes = [...new Set(workingTreeScopes)];
    return {
      files: listWorkingTreeFiles(
        {
          staged: uniqueScopes.includes('staged'),
          unstaged: uniqueScopes.includes('unstaged'),
          untracked: uniqueScopes.includes('untracked'),
        },
        rootDir,
      ),
      sourceKind: 'working-tree',
      sourceScope: uniqueScopes,
      sourceRef: resolveSourceRef({
        explicitSourceRef: options.sourceRef,
        rootDir,
        sourceKind: 'working-tree',
      }),
    };
  }

  return {
    files: [],
    sourceKind: 'explicit-files',
    sourceScope: ['explicit'],
    sourceRef: resolveSourceRef({
      explicitSourceRef: options.sourceRef,
      rootDir,
      sourceKind: 'explicit-files',
    }),
  };
}
