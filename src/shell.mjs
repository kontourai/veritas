import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const GIT_DIFF_TIMEOUT_MS = 30_000;

function timedGitDiff(rootDir, args) {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_DIFF_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') {
      const timeoutError = new Error(`Git diff resolution timed out after ${GIT_DIFF_TIMEOUT_MS}ms`);
      timeoutError.code = 'VERITAS_DIFF_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  }
}

export function shellQuote(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function tokenizeCommand(command) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('Evidence Check command must be a non-empty string');
  }

  const tokens = [];
  let current = '';
  let quote = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null;
        continue;
      }
      if (character === '\\') {
        const nextCharacter = command[index + 1];
        if (nextCharacter && ['\\', '"', '$', '`'].includes(nextCharacter)) {
          current += nextCharacter;
          index += 1;
          continue;
        }
      }
      current += character;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === '\\') {
      index += 1;
      if (index >= command.length) {
        throw new Error('Evidence Check command cannot end with a bare escape');
      }
      current += command[index];
      continue;
    }

    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (quote) {
    throw new Error(`Evidence Check command contains an unmatched ${quote}`);
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (tokens.length === 0) {
    throw new Error('Evidence Check command must contain an executable');
  }

  return tokens;
}

function runEvidenceCheckCommand(command, rootDir, options = {}) {
  const [executable, ...args] = tokenizeCommand(command);
  return execFileSync(executable, args, {
    cwd: rootDir,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
    windowsHide: true,
  });
}

function runEvidenceCheckCommandDetailed(command, rootDir) {
  const [executable, ...args] = tokenizeCommand(command);
  const result = spawnSync(executable, args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return {
    command,
    passed: result.status === 0,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function gitOutput(args, rootDir, options = {}) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
    stdio: options.stdio ?? ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function resolveGitHead(rootDir) {
  try {
    return gitOutput(['rev-parse', 'HEAD'], rootDir);
  } catch {
    return null;
  }
}

export function stagedDiffSha256(rootDir) {
  let diff = '';
  try {
    diff = timedGitDiff(rootDir, ['diff', '--cached', '--binary']);
  } catch (error) {
    if (error?.code === 'VERITAS_DIFF_TIMEOUT') throw error;
    diff = '';
  }
  if (!diff) {
    try {
      diff = timedGitDiff(rootDir, ['diff', '--binary']);
    } catch (error) {
      if (error?.code === 'VERITAS_DIFF_TIMEOUT') throw error;
      diff = '';
    }
  }
  return createHash('sha256').update(diff).digest('hex');
}
