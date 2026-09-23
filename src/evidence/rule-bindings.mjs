import { changedFilesForRule } from '../rules/applicability.mjs';
import { uniqueStrings } from '../util/strings.mjs';
import { readEvidenceChecks } from './evidenceChecks.mjs';

export function resolveRuleEvidenceBindings({ repoStandards, config, files, rootDir }) {
  if (!repoStandards) return [];
  const knownIds = new Set(readEvidenceChecks(config).map((check) => check.id));
  return (repoStandards.rules ?? []).flatMap((rule) => {
    const ids = uniqueStrings(rule.evidenceCheckIds ?? []);
    if (ids.length === 0) return [];
    for (const id of ids) {
      if (!knownIds.has(id)) {
        throw new Error(`Repo Standard ${rule.id} references unknown evidenceCheckId ${id}`);
      }
    }
    const matchedFiles = changedFilesForRule(rule, files, rootDir);
    if (matchedFiles.length === 0) return [];
    return [{ ruleId: rule.id, enforcementLevel: rule.enforcementLevel, evidenceCheckIds: ids, files: matchedFiles }];
  });
}
