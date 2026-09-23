import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_MARKERS = 512;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeCacheParents(rootDir) {
  for (const segment of ['.kontourai', '.kontourai/veritas', '.kontourai/veritas/hook-briefings']) {
    const path = resolve(rootDir, segment);
    if (existsSync(path) && !lstatSync(path).isDirectory()) return false;
  }
  return true;
}

/** Brief once per host session and policy revision. A failed cache always repeats guidance. */
export function prepareGuidanceBriefing({ rootDir, stdinText, guidanceContext }) {
  if (!guidanceContext) return { guidanceContext: '' };
  try {
    const payload = JSON.parse(stdinText);
    const sessionId = payload?.session_id ?? payload?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 128) {
      return { guidanceContext };
    }
    const map = readFileSync(resolve(rootDir, '.veritas/repo-map.json'));
    const standards = readFileSync(resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json'));
    const cacheDir = resolve(rootDir, '.kontourai/veritas/hook-briefings');
    if (!safeCacheParents(rootDir)) return { guidanceContext };
    const marker = join(cacheDir, digest(JSON.stringify([sessionId, digest(map), digest(standards), guidanceContext])));
    if (existsSync(marker) && Date.now() - statSync(marker).mtimeMs < MAX_AGE_MS) {
      return { guidanceContext: '' };
    }
    return {
      guidanceContext,
      record() {
        try {
          if (!safeCacheParents(rootDir)) return;
          mkdirSync(cacheDir, { recursive: true });
          if (!safeCacheParents(rootDir)) return;
          if (existsSync(marker)) {
            if (!lstatSync(marker).isFile()) return;
            unlinkSync(marker);
          }
          writeFileSync(marker, '', { flag: 'wx' });
          const entries = readdirSync(cacheDir).map((name) => ({ name, mtimeMs: statSync(join(cacheDir, name)).mtimeMs }));
          entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
          for (const entry of entries.slice(MAX_MARKERS)) unlinkSync(join(cacheDir, entry.name));
          for (const entry of entries.slice(0, MAX_MARKERS)) {
            if (Date.now() - entry.mtimeMs > MAX_AGE_MS) unlinkSync(join(cacheDir, entry.name));
          }
        } catch {
          // Cache failure only causes a future briefing to repeat.
        }
      },
    };
  } catch {
    return { guidanceContext };
  }
}
