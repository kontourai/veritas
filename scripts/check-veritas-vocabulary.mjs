#!/usr/bin/env node
import { displayText } from '../src/util/display.mjs';
import { loadRepoStandards } from '../src/load.mjs';
import { evaluateRepoStandards } from '../src/rules/evaluate.mjs';

const rootDir = process.cwd();
const repoStandards = loadRepoStandards(
  new URL('../.veritas/repo-standards/default.repo-standards.json', import.meta.url),
);
const ruleIds = repoStandards.rules
  .filter((rule) => rule.kind === 'vocabulary-consistency')
  .map((rule) => rule.id);

if (ruleIds.length === 0) {
  console.log('No vocabulary-consistency requirements configured.');
  process.exit(0);
}

const results = evaluateRepoStandards(repoStandards, { rootDir }, { ruleIds });
let failures = 0;
for (const result of results) {
  if (result.passed === true) {
    console.log(`PASS ${result.rule_id}: ${displayText(result.summary)}`);
    continue;
  }
  failures += 1;
  console.log(`FAIL ${result.rule_id}: ${displayText(result.summary)}`);
  for (const finding of result.findings ?? []) {
    const location = finding.line ? `${finding.artifact}:${finding.line}` : finding.artifact;
    console.log(`  ${displayText(location)} uses "${finding.term}"; prefer ${finding.prefer}.`);
  }
}

process.exit(failures > 0 ? 1 : 0);
