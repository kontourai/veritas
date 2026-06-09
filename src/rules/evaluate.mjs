import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectGovernanceBlockFile } from '../governance.mjs';
import { classifyNodes } from '../repo/classify.mjs';
import { matchesPatterns } from '../util/patterns.mjs';
import { uniqueStrings } from '../util/strings.mjs';
import {
  evaluateForbiddenPatternRule,
  evaluateHeaderRequiredRule,
  evaluateRequiredPatternRule,
  evaluateVocabularyConsistencyRule,
} from './content-rules.mjs';
import { evaluatePrimitiveFirstGovernanceRule } from './primitive-first.mjs';
import { buildRuleResult } from './result.mjs';

export { buildRuleResult } from './result.mjs';
export {
  evaluateForbiddenPatternRule,
  evaluateHeaderRequiredRule,
  evaluateRequiredPatternRule,
  evaluateVocabularyConsistencyRule,
} from './content-rules.mjs';
export { evaluatePrimitiveFirstGovernanceRule } from './primitive-first.mjs';

/**
 * @typedef {Object} RuleContext
 * @property {string} rootDir
 * @property {string[]} [changedFiles]
 * @property {object} [config] Repo Map config; required for work-area-boundary.
 * @property {object} [repoStandards] Active Repo Standards config; required for primitive references.
 * @property {string|null} [actor] Resolved actor for boundary rules.
 */

/** @param {RuleContext} context */
export function evaluateRequiredArtifactsRule(rule, { rootDir }) {
  const missingArtifacts = (rule.match?.artifacts ?? []).filter(
    (artifact) => !existsSync(resolve(rootDir, artifact)),
  );

  return buildRuleResult(rule, {
    implemented: true,
    passed: missingArtifacts.length === 0,
    summary:
      missingArtifacts.length === 0
        ? 'All required repository artifacts are present.'
        : 'Some required repository artifacts are missing.',
    findings: missingArtifacts.map((artifact) => ({
      kind: 'missing-artifact',
      artifact,
    })),
  });
}

/** @param {RuleContext} context */
export function evaluateGovernanceBlockRule(rule, { rootDir }) {
  const targets = rule.match?.['governance-block'] ?? [];
  const findings = targets
    .map((artifact) => inspectGovernanceBlockFile({ rootDir, filePath: artifact }))
    .filter((status) => !status.canonical)
    .map((status) => ({
      kind: status.exists
        ? status.stale
          ? 'stale-governance-block'
          : 'missing-governance-block'
        : 'missing-governance-file',
      artifact: status.path,
    }));

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? 'All required AI instruction files contain the canonical Veritas governance block.'
        : 'Some AI instruction files are missing the canonical Veritas governance block.',
    findings,
  });
}

/** @param {RuleContext} context */
export function evaluateDiffRequiredRule(rule, { changedFiles = [] }) {
  const ifChanged = rule.match?.['if-changed'];
  const thenRequire = rule.match?.['then-require'];
  const triggerMatches =
    typeof ifChanged === 'string'
      ? changedFiles.filter((file) => matchesPatterns(file, [ifChanged]))
      : [];
  const requirementMatches =
    typeof thenRequire === 'string'
      ? changedFiles.filter((file) => matchesPatterns(file, [thenRequire]))
      : [];
  const triggered = triggerMatches.length > 0;
  const passed = !triggered || requirementMatches.length > 0;

  return buildRuleResult(rule, {
    implemented: true,
    passed,
    summary: !triggered
      ? `No changed files matched ${ifChanged}.`
      : passed
        ? `Changed files matched ${ifChanged} and included required companion changes under ${thenRequire}.`
        : `Changed files matched ${ifChanged} but no companion changes matched ${thenRequire}.`,
    findings: passed
      ? []
      : triggerMatches.map((artifact) => ({
          kind: 'missing-required-diff-companion',
          artifact,
          required: thenRequire,
        })),
  });
}


function actorOwnsNode(actor, node) {
  const owners = uniqueStrings(node.owners ?? []);
  if (owners.includes('shared') || owners.includes('*')) return true;
  if (!actor) return false;
  return owners.includes(actor);
}

function actorAllowedAcrossBoundary(actor, node) {
  const allow = uniqueStrings(node.boundaryAllow ?? []);
  return allow.includes('*') || allow.includes(actor) || allow.includes(node.id);
}

/** @param {RuleContext} context */
export function evaluateWorkAreaBoundaryRule(rule, { changedFiles = [], config, rootDir, actor }) {
  const effectiveActor = actor ?? process.env.VERITAS_ACTOR ?? null;
  if (!effectiveActor) {
    return buildRuleResult(rule, {
      implemented: true,
      passed: null,
      status: 'error',
      summary: 'work-area-boundary requires --actor or VERITAS_ACTOR; refusing to silently pass.',
      findings: [{
        kind: 'missing-actor',
        artifact: rule.id,
        remediation: 'Pass --actor <id> or set VERITAS_ACTOR.',
      }],
    });
  }
  const classification = classifyNodes(changedFiles, config, rootDir);
  const findings = [];

  for (const [file, nodes] of Object.entries(classification.fileNodes ?? {})) {
    for (const node of nodes) {
      if (node.boundary !== 'strict') continue;
      if (actorOwnsNode(effectiveActor, node) || actorAllowedAcrossBoundary(effectiveActor, node)) continue;
      findings.push({
        kind: 'work-area-boundary',
        artifact: file,
        node: node.id,
        actor: effectiveActor,
        owners: node.owners,
        remediation: `Route this change through ${node.owners.join(', ') || 'the owning work area'} or add an explicit boundaryAllow entry.`,
      });
    }
  }

  return buildRuleResult(rule, {
    implemented: true,
    passed: findings.length === 0,
    summary:
      findings.length === 0
        ? `Actor ${effectiveActor ?? 'unknown'} stayed within owned or allowed work areas.`
        : `Actor ${effectiveActor ?? 'unknown'} touched a strict work area they do not own.`,
    findings,
  });
}

export const RULE_EVALUATORS = {
  'required-artifacts': evaluateRequiredArtifactsRule,
  'governance-block': evaluateGovernanceBlockRule,
  'diff-required': evaluateDiffRequiredRule,
  'work-area-boundary': evaluateWorkAreaBoundaryRule,
  'forbidden-pattern': evaluateForbiddenPatternRule,
  'required-pattern': evaluateRequiredPatternRule,
  'header-required': evaluateHeaderRequiredRule,
  'vocabulary-consistency': evaluateVocabularyConsistencyRule,
  'primitive-first-governance': evaluatePrimitiveFirstGovernanceRule,
};

/** @param {RuleContext} context */
export function evaluatePolicyRule(rule, context) {
  const evaluator = RULE_EVALUATORS[rule.kind];
  if (!evaluator) {
    return buildRuleResult(rule, {
      implemented: false,
      passed: null,
      status: 'error',
      summary: `Unknown rule kind: ${rule.kind ?? 'undefined'}.`,
      reason: 'unknown rule kind',
      findings: [
        {
          kind: 'unknown-rule-kind',
          artifact: rule.id,
          rule_kind: rule.kind ?? null,
        },
      ],
    });
  }

  return evaluator(rule, context);
}

export function evaluateRepoStandards(repoStandards, context, options = {}) {
  const selectedRuleIds = new Set(options.ruleIds ?? []);
  return repoStandards.rules
    .filter((rule) => selectedRuleIds.size === 0 || selectedRuleIds.has(rule.id))
    .map((rule) => evaluatePolicyRule(rule, { ...context, repoStandards }));
}
