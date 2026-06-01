#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = process.cwd();
const artifactPath = resolve(rootDir, '.veritas/external/fallow-audit.json');
const localFallowBin = resolve(rootDir, 'node_modules/.bin/fallow');

function runFallow() {
  const executable = existsSync(localFallowBin) ? localFallowBin : 'npx';
  const args = existsSync(localFallowBin)
    ? ['--format', 'json', '--quiet']
    : ['-y', 'fallow', '--format', 'json', '--quiet'];

  try {
    return execFileSync(executable, args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    if (error.stdout) return error.stdout;
    throw error;
  }
}

function numberValue(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function summarize(payload) {
  const deadCodeIssues = numberValue(payload?.check?.total_issues);
  const cloneGroups = numberValue(payload?.dupes?.stats?.clone_groups);
  const duplicatedLines = numberValue(payload?.dupes?.stats?.duplicated_lines);
  const duplicationPercent = numberValue(payload?.dupes?.stats?.duplication_percentage);
  const complexityFindings = numberValue(payload?.health?.summary?.functions_above_threshold);
  const averageMaintainability = numberValue(payload?.health?.summary?.average_maintainability);

  return {
    dead_code_issues: deadCodeIssues,
    duplication_clone_groups: cloneGroups,
    duplicated_lines: duplicatedLines,
    duplication_percent: duplicationPercent,
    complexity_findings: complexityFindings,
    average_maintainability: averageMaintainability,
  };
}

function collectActions(payload) {
  const actions = [];
  for (const target of payload?.health?.targets ?? []) {
    for (const action of target.actions ?? []) {
      actions.push({
        type: action.type ?? 'fallow-action',
        description: action.description ?? target.recommendation ?? 'Fallow action',
        auto_fixable: Boolean(action.auto_fixable),
        paths: target.path ? [target.path] : [],
      });
    }
  }
  return actions.slice(0, 20);
}

const rawOutput = runFallow();
const payload = JSON.parse(rawOutput);
const summary = summarize(payload);
const totalFindings =
  summary.dead_code_issues + summary.duplication_clone_groups + summary.complexity_findings;
const artifact = {
  schema_version: 'veritas-fallow-advisory-v1',
  tool: 'fallow',
  command: existsSync(localFallowBin) ? 'fallow --format json --quiet' : 'npx -y fallow --format json --quiet',
  verdict: totalFindings > 0 ? 'warn' : 'pass',
  summary,
  actions: collectActions(payload),
};

mkdirSync(resolve(rootDir, '.veritas/external'), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({ artifactPath: '.veritas/external/fallow-audit.json', ...artifact })}\n`);
