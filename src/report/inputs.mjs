import { execFileSync } from 'node:child_process';
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

  return parseDiffPaths(execFileSync(
    'git',
    ['diff', '--name-status', '--find-renames', '--diff-filter=ACMRD', fromRef, toRef],
    gitExecOptions(rootDir, timeoutMs),
  ));
}

function parseDiffPaths(output) {
  const paths = new Set();
  for (const line of output.split('\n').filter(Boolean)) {
    const fields = line.split('\t');
    const status = fields[0] ?? '';
    if (status.startsWith('R') || status.startsWith('C')) {
      if (fields[1]) paths.add(fields[1]);
      if (fields[2]) paths.add(fields[2]);
    } else if (fields[1]) {
      paths.add(fields[1]);
    }
  }
  return [...paths].sort();
}

function listGitFiles(args, rootDir, timeoutMs) {
  return execFileSync('git', args, gitExecOptions(rootDir, timeoutMs))
    .split('\n')
    .map((line) => line.trim())
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
      ['diff', '--cached', '--name-status', '--find-renames', '--diff-filter=ACMRD'],
      gitExecOptions(rootDir, timeoutMs),
    ))) files.add(file);
  }

  if (unstaged) {
    for (const file of parseDiffPaths(execFileSync('git',
      ['diff', '--name-status', '--find-renames', '--diff-filter=ACMRD'],
      gitExecOptions(rootDir, timeoutMs),
    ))) files.add(file);
  }

  if (untracked) {
    for (const file of listGitFiles(
      ['ls-files', '--others', '--exclude-standard'],
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
    const sourceRef = options.sourceRef ?? `${options.changedFrom}..${options.changedTo}`;
    return {
      files: listChangedFiles(
        options.changedFrom,
        options.changedTo,
        rootDir,
        { timeoutMs: gitTimeoutMs },
      ),
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
        { timeoutMs: gitTimeoutMs },
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
