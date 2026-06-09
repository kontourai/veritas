import {
  lineForMatch,
  matchedFilesForRule,
  readRepoTextFile,
} from '../util/patterns.mjs';
import { buildRuleResult } from './result.mjs';

/** @param {import('./evaluate.mjs').RuleContext} context */
export function evaluateForbiddenPatternRule(rule, context) {
  const files = matchedFilesForRule(rule, context);
  const pattern = rule.match?.pattern;
  const regex = new RegExp(pattern, 'm');
  const findings = [];
  for (const file of files) {
    const content = readRepoTextFile(context.rootDir, file);
    const match = regex.exec(content);
    if (match) {
      findings.push({
        kind: 'forbidden-pattern',
        artifact: file,
        line: lineForMatch(content, match.index),
        pattern,
      });
    }
  }

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? `No matched files contain forbidden pattern ${pattern}.`
        : `Forbidden pattern ${pattern} appeared in matched files.`,
    findings,
  });
}

/** @param {import('./evaluate.mjs').RuleContext} context */
export function evaluateRequiredPatternRule(rule, context) {
  const files = matchedFilesForRule(rule, context);
  const pattern = rule.match?.pattern;
  const regex = new RegExp(pattern, 'm');
  const findings = [];
  for (const file of files) {
    const content = readRepoTextFile(context.rootDir, file);
    if (!regex.test(content)) {
      findings.push({
        kind: 'missing-required-pattern',
        artifact: file,
        pattern,
      });
    }
  }

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? `All matched files contain required pattern ${pattern}.`
        : `Some matched files are missing required pattern ${pattern}.`,
    findings,
  });
}

/** @param {import('./evaluate.mjs').RuleContext} context */
export function evaluateHeaderRequiredRule(rule, context) {
  const files = matchedFilesForRule(rule, context);
  const pattern = rule.match?.pattern;
  const regex = new RegExp(pattern);
  const findings = [];
  for (const file of files) {
    const content = readRepoTextFile(context.rootDir, file);
    if (!regex.test(content.slice(0, 4096))) {
      findings.push({
        kind: 'missing-required-header',
        artifact: file,
        pattern,
      });
    }
  }

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? `All matched files contain required header pattern ${pattern}.`
        : `Some matched files are missing required header pattern ${pattern}.`,
    findings,
  });
}

function buildVocabularyRegex(term) {
  const source = term.regex ?? term.pattern ?? term.term;
  return new RegExp(source, term.flags ?? 'i');
}

function contextAllowed(content, match, allowContexts = []) {
  if (!allowContexts.length) return false;
  const start = Math.max(0, match.index - 120);
  const end = Math.min(content.length, match.index + match[0].length + 120);
  const context = content.slice(start, end);
  return allowContexts.some((pattern) => new RegExp(pattern, 'i').test(context));
}

/** @param {import('./evaluate.mjs').RuleContext} context */
export function evaluateVocabularyConsistencyRule(rule, context) {
  const files = matchedFilesForRule(rule, context);
  const terms = Array.isArray(rule.match?.terms) ? rule.match.terms : [];
  const findings = [];

  for (const file of files) {
    const content = readRepoTextFile(context.rootDir, file);
    for (const term of terms) {
      const regex = buildVocabularyRegex(term);
      const match = regex.exec(content);
      if (!match || contextAllowed(content, match, term.allowContexts ?? [])) continue;
      findings.push({
        kind: 'vocabulary-drift',
        artifact: file,
        line: lineForMatch(content, match.index),
        term: term.term ?? term.pattern ?? term.regex,
        prefer: term.prefer,
      });
    }
  }

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? 'All matched files use canonical Veritas vocabulary.'
        : 'Some matched files use pre-glossary or ambiguous Veritas vocabulary.',
    findings,
  });
}
