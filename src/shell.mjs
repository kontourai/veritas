import { execFileSync } from 'node:child_process';

export function shellQuote(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function tokenizeCommand(command) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('Proof command must be a non-empty string');
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
        throw new Error('Proof command cannot end with a bare escape');
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
    throw new Error(`Proof command contains an unmatched ${quote}`);
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (tokens.length === 0) {
    throw new Error('Proof command must contain an executable');
  }

  return tokens;
}

export function runProofCommand(command, rootDir, options = {}) {
  const [executable, ...args] = tokenizeCommand(command);
  return execFileSync(executable, args, {
    cwd: rootDir,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
    windowsHide: true,
  });
}
