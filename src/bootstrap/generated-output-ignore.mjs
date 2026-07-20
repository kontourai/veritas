import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const GENERATED_OUTPUT_IGNORE_ENTRIES = ['.kontourai/'];

function hasRootKontouraiIgnore(lines) {
  return lines.some((line) => /^\/?\.kontourai\/?$/.test(line.trim()));
}

/**
 * Keep Veritas runtime output local without obscuring durable `.veritas` standards.
 * The merge is intentionally narrow: it preserves user content and adds only the
 * root-local `.kontourai/` entry needed for generated Veritas output.
 */
export function mergeGeneratedOutputIgnores(rootDir) {
  const ignorePath = resolve(rootDir, '.gitignore');
  const existing = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
  const lines = existing === '' ? [] : existing.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const missingEntries = hasRootKontouraiIgnore(lines) ? [] : GENERATED_OUTPUT_IGNORE_ENTRIES;
  if (missingEntries.length === 0) {
    return { path: '.gitignore', changed: false, addedEntries: [] };
  }

  const nextLines = [...lines];
  if (nextLines.length > 0 && nextLines.at(-1) !== '') nextLines.push('');
  nextLines.push(...missingEntries);
  writeFileSync(ignorePath, `${nextLines.join('\n')}\n`, 'utf8');
  return { path: '.gitignore', changed: true, addedEntries: missingEntries };
}
