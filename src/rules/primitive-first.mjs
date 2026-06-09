import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchedFilesForRule, readRepoTextFile, lineForMatch } from '../util/patterns.mjs';
import { buildRuleResult } from './result.mjs';

function primitiveExists(reference, rule, context) {
  if (reference.kind === 'repo-standards-rule') {
    return (context.repoStandards?.rules ?? []).some((candidateRule) =>
      candidateRule.id === reference.id && candidateRule.id !== rule.id
    );
  }
  if (reference.kind === 'evidence-check') {
    return (context.config?.evidence?.evidenceChecks ?? []).some((check) => check.id === reference.id);
  }
  return false;
}

function readJsonFile(rootDir, filePath) {
  try {
    return JSON.parse(readFileSync(resolve(rootDir, filePath), 'utf8'));
  } catch {
    return null;
  }
}

function regexMatches(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern).test(value));
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function evidenceCheckRunsPackageScript(check, scriptName) {
  if (typeof check.command !== 'string') return false;
  const escapedScriptName = escapeRegexLiteral(scriptName);
  const npmRunPattern = new RegExp(
    `(?:^|&&|\\|\\||;|\\s)npm\\s+run(?:-script)?\\s+${escapedScriptName}(?:\\s|$)`,
  );
  return npmRunPattern.test(check.command);
}

function packageScriptRepresented(scriptName, packageScripts, rule, context) {
  const evidenceChecks = context.config?.evidence?.evidenceChecks ?? [];
  if (evidenceChecks.some((check) => evidenceCheckRunsPackageScript(check, scriptName))) {
    return true;
  }
  return (packageScripts.representedBy ?? []).some((reference) =>
    primitiveExists(reference, rule, context)
  );
}

function packageScriptExemption(scriptName, packageScripts) {
  return (packageScripts.helperExemptions ?? []).find(
    (exemption) => exemption.name === scriptName
  );
}

function evaluatePrimitiveFirstPackageScripts(rule, context) {
  const packageScripts = rule.match?.packageScripts;
  if (!packageScripts) return [];

  const filePath = packageScripts.file ?? 'package.json';
  const packageJson = readJsonFile(context.rootDir, filePath);
  const scripts =
    packageJson && typeof packageJson.scripts === 'object' && packageJson.scripts !== null
      ? packageJson.scripts
      : {};
  const namePatterns = packageScripts.namePatterns ?? [];
  const commandPatterns = packageScripts.commandPatterns ?? [];
  const findings = [];

  for (const [scriptName, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    const matchesInventory =
      regexMatches(scriptName, namePatterns) || regexMatches(command, commandPatterns);
    if (!matchesInventory) continue;

    const exemption = packageScriptExemption(scriptName, packageScripts);
    if (exemption) continue;
    if (packageScriptRepresented(scriptName, packageScripts, rule, context)) continue;

    findings.push({
      kind: 'primitive-first-governance',
      artifact: filePath,
      package_script: scriptName,
      command,
      name_patterns: namePatterns,
      command_patterns: commandPatterns,
      required_primitives: [
        {
          kind: 'evidence-check',
          command: `npm run ${scriptName}`,
        },
        ...(packageScripts.representedBy ?? []),
      ],
    });
  }

  return findings;
}

/** @param {import('./evaluate.mjs').RuleContext} context */
export function evaluatePrimitiveFirstGovernanceRule(rule, context) {
  const candidates = Array.isArray(rule.match?.candidates) ? rule.match.candidates : [];
  const findings = [];

  for (const candidate of candidates) {
    const files = matchedFilesForRule({ match: { files: candidate.files ?? [] } }, context);
    const regex = new RegExp(candidate.pattern, 'm');
    const represented = (candidate.representedBy ?? []).some((reference) =>
      primitiveExists(reference, rule, context)
    );

    for (const file of files) {
      const content = readRepoTextFile(context.rootDir, file);
      const match = regex.exec(content);
      if (!match || represented) continue;
      findings.push({
        kind: 'primitive-first-governance',
        artifact: file,
        line: lineForMatch(content, match.index),
        pattern: candidate.pattern,
        required_primitives: candidate.representedBy ?? [],
      });
    }
  }

  findings.push(...evaluatePrimitiveFirstPackageScripts(rule, context));

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? 'Repeatable governance checks are represented by Veritas primitives.'
        : 'Some repeatable governance checks bypass Veritas primitives.',
    findings,
  });
}
