import { resolve } from 'node:path';
import { parseTokens } from '../args.mjs';
import { loadRepoMap, loadRepoStandards } from '../load.mjs';
import { resolveVeritasPaths, resolveReportInputs } from '../report/index.mjs';
import { resolveEvidenceCheckPlan } from '../repo/routing.mjs';
import { buildExplainGuidance } from '../explain.mjs';
import { publicEvidenceCheck } from '../evidence/index.mjs';
import { assertWithinDir, normalizeRepoPath } from '../paths.mjs';
import { displayText } from '../util/display.mjs';

export function runPlanCli(argv = process.argv.slice(2)) {
  const { options, rest } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir', strictValue: true },
    '--repo-map': { type: 'string', key: 'repoMapPath', strictValue: true },
    '--repo-standards': { type: 'string', key: 'repoStandardsPath', strictValue: true },
    '--changed-from': { type: 'string', key: 'changedFrom', strictValue: true },
    '--changed-to': { type: 'string', key: 'changedTo', strictValue: true },
    '--working-tree': { type: 'flag', key: 'workingTree' },
    '--json': { type: 'flag', key: 'json' },
  });
  if (rest.some((path) => path.startsWith('-'))) throw new Error('Unknown veritas plan option');
  if ((rest.length && (options.changedFrom || options.changedTo || options.workingTree))
      || (options.workingTree && (options.changedFrom || options.changedTo))) {
    throw new Error('Choose explicit paths, --working-tree, or --changed-from/--changed-to');
  }
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const paths = resolveVeritasPaths({ ...options, rootDir });
  const config = loadRepoMap(paths.repoMapPath, { strict: true });
  const repoStandards = loadRepoStandards(paths.repoStandardsPath, { strict: true });
  const inputs = resolveReportInputs(rest, {
    ...options, workingTree: !rest.length && !options.changedFrom && !options.changedTo,
  }, rootDir);
  const files = [...new Set(inputs.files.map((path) => {
    assertWithinDir(resolve(rootDir, path), rootDir, 'Plan paths must stay inside the repository');
    return normalizeRepoPath(path, rootDir);
  }))];
  const plan = resolveEvidenceCheckPlan({ files, config, repoStandards, rootDir, classificationScope: inputs.classificationScope });
  const guidance = new Map();
  for (const filePath of files) {
    for (const rule of buildExplainGuidance({ rootDir, repoMap: config, repoStandards, filePath }).rules) {
      if (!guidance.has(rule.id)) guidance.set(rule.id, { ...rule, files: [] });
      guidance.get(rule.id).files.push(filePath);
    }
  }
  const result = {
    schemaVersion: 1, executed: false, files,
    affectedWorkAreas: plan.affectedNodes,
    unmatchedFiles: plan.unmatchedFiles,
    uncoveredPathPolicy: plan.uncoveredPathPolicy,
    evidenceChecks: plan.evidenceChecks.map((check) => ({
      ...publicEvidenceCheck(check), required: plan.requiredEvidenceCheckIds.includes(check.id),
    })),
    guidance: [...guidance.values()],
  };
  if (options.json) process.stdout.write(`${JSON.stringify({
    apiVersion: 'veritas.kontour.ai/v1alpha1', kind: 'ChangePlan',
    metadata: { name: 'change-plan' }, spec: { files },
    status: { ...result, conditions: [{ type: 'ChecksExecuted', status: 'False', reason: 'PlanningOnly', message: 'No checks executed; this is not a readiness verdict.' }] },
  }, null, 2)}\n`);
  else {
    const lines = [`Veritas plan: ${files.length} path(s); no checks executed.`, ''];
    for (const check of result.evidenceChecks) {
      lines.push(`${check.required ? 'REQUIRED' : 'ADVISORY'} ${check.id}: ${displayText(check.command ?? check.runner)}`);
    }
    for (const rule of result.guidance) {
      lines.push('', `Rule ${rule.id} (${rule.enforcementLevel}): ${rule.summary}`);
      if (rule.evidenceCheckIds.length) lines.push(`Evidence checks: ${rule.evidenceCheckIds.join(', ')}`);
      for (const item of rule.mustDo) lines.push(`Do: ${item}`);
      for (const item of rule.mustNotDo) lines.push(`Do not: ${item}`);
      if (rule.exampleGood) lines.push(`Good: ${rule.exampleGood}`);
      if (rule.exampleBad) lines.push(`Bad: ${rule.exampleBad}`);
    }
    for (const file of result.unmatchedFiles) lines.push(`UNMAPPED (${result.uncoveredPathPolicy}): ${displayText(file)}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}
