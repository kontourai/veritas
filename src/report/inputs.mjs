import { execFileSync } from 'node:child_process';
import { resolveCommitRef } from '../repo/git.mjs';
import { resolveSourceRef } from './integrity.mjs';

function gitExecOptions(rootDir, timeoutMs) {
  return {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0
      ? { timeout: Math.max(1, Math.floor(timeoutMs)) }
      : {}),
  };
}

export function listChangedFiles(fromRef, toRef, rootDir, { timeoutMs } = {}) {
  if (!fromRef || !toRef) return [];

  const fromCommit = resolveCommitRef(fromRef, rootDir, timeoutMs);
  const toCommit = resolveCommitRef(toRef, rootDir, timeoutMs);
  return parseDiffPaths(execFileSync(
    'git',
    ['diff', '--relative', '--name-status', '-z', '--find-renames', '--diff-filter=ACMRDT', fromCommit, toCommit, '--'],
    gitExecOptions(rootDir, timeoutMs),
  ));
}

function parseDiffPaths(output) {
  const paths = new Set();
  const fields = output.split('\0');
  for (let index = 0; index < fields.length && fields[index];) {
    const status = fields[index++];
    const file = fields[index++];
    if (file) paths.add(file);
    if (status.startsWith('R') || status.startsWith('C')) {
      const destination = fields[index++];
      if (destination) paths.add(destination);
    }
  }
  return [...paths].sort();
}

function listGitFiles(args, rootDir, timeoutMs) {
  return execFileSync('git', args, gitExecOptions(rootDir, timeoutMs))
    .split('\0')
    .filter(Boolean);
}

export function listWorkingTreeFiles(
  { staged = false, unstaged = false, untracked = false } = {},
  rootDir,
  { timeoutMs } = {},
) {
  const files = new Set();

  if (staged) {
    for (const file of parseDiffPaths(execFileSync('git',
      ['diff', '--relative', '--cached', '--name-status', '-z', '--find-renames', '--diff-filter=ACMRDT', '--'],
      gitExecOptions(rootDir, timeoutMs),
    ))) files.add(file);
  }

  if (unstaged) {
    for (const file of parseDiffPaths(execFileSync('git',
      ['diff', '--relative', '--name-status', '-z', '--find-renames', '--diff-filter=ACMRDT', '--'],
      gitExecOptions(rootDir, timeoutMs),
    ))) files.add(file);
  }

  if (untracked) {
    for (const file of listGitFiles(
      ['ls-files', '-z', '--others', '--exclude-standard', '--'],
      rootDir,
      timeoutMs,
    )) {
      files.add(file);
    }
  }

  return [...files].sort();
}

export function resolveReportInputs(explicitFiles, options, rootDir, { gitTimeoutMs } = {}) {
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
    const baseRef = resolveCommitRef(options.changedFrom, rootDir, gitTimeoutMs);
    const headRef = resolveCommitRef(options.changedTo, rootDir, gitTimeoutMs);
    const sourceRef = options.sourceRef ?? `${options.changedFrom}..${options.changedTo}`;
    return {
      files: listChangedFiles(
        baseRef,
        headRef,
        rootDir,
        { timeoutMs: gitTimeoutMs },
      ),
      classificationScope: {
        baseRef,
        gitTimeoutMs,
        removedFiles: listGitFiles(
          ['diff', '--relative', '--no-renames', '--name-only', '-z', '--diff-filter=D', baseRef, headRef, '--'],
          rootDir,
          gitTimeoutMs,
        ),
      },
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
    const files = listWorkingTreeFiles(
      {
        staged: uniqueScopes.includes('staged'),
        unstaged: uniqueScopes.includes('unstaged'),
        untracked: uniqueScopes.includes('untracked'),
      },
      rootDir,
      { timeoutMs: gitTimeoutMs },
    );
    return {
      files,
      classificationScope: {
        baseRef: 'HEAD',
        gitTimeoutMs,
        removedFiles: [...new Set(uniqueScopes.flatMap((scope) => {
          if (scope === 'untracked') return [];
          return listGitFiles(
            ['diff', '--relative', ...(scope === 'staged' ? ['--cached'] : []), '--no-renames', '--name-only', '-z', '--diff-filter=D', '--'],
            rootDir,
            gitTimeoutMs,
          );
        }))].filter((file) => files.includes(file)),
      },
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
