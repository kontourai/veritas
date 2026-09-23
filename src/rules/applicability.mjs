import { normalizeRepoPath } from '../paths.mjs';
import { matchesPatterns } from '../util/patterns.mjs';

/** The same path selection governs JIT guidance and rule-linked evidence. */
export function ruleMatchesFile(rule, filePath) {
  if (!filePath) return false;
  const match = rule.match ?? {};
  if (Array.isArray(match.artifacts)) return matchesPatterns(filePath, match.artifacts);
  if (Array.isArray(match['governance-block'])) return matchesPatterns(filePath, match['governance-block']);
  if (typeof match['if-changed'] === 'string' || typeof match['then-require'] === 'string') {
    return matchesPatterns(filePath, [match['if-changed'], match['then-require']].filter(Boolean));
  }
  if (Array.isArray(match.files)) return matchesPatterns(filePath, match.files);
  return false;
}

export function changedFilesForRule(rule, files, rootDir) {
  return files
    .map((file) => normalizeRepoPath(file, rootDir))
    .filter((file) => ruleMatchesFile(rule, file));
}
