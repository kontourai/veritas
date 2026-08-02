import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTokens } from '../args.mjs';
import { formatConfigValidationReport, loadJson } from '../load.mjs';
import { relativeRepoPath } from '../paths.mjs';
import { resolveVeritasPaths } from '../report/index.mjs';
import {
  REPO_MAP_SCHEMA,
  REPO_STANDARDS_SCHEMA,
  validateAgainstSchema,
} from '../schema-validation.mjs';

const TARGETS = [
  { label: 'Repo Map', pathKey: 'repoMapPath', schema: REPO_MAP_SCHEMA },
  { label: 'Repo Standards', pathKey: 'repoStandardsPath', schema: REPO_STANDARDS_SCHEMA },
];

export function validateRepoConfig({ rootDir, repoMapPath, repoStandardsPath }) {
  const paths = { repoMapPath, repoStandardsPath };
  const results = TARGETS.map(({ label, pathKey, schema }) => {
    const filePath = paths[pathKey];
    if (!existsSync(filePath)) {
      return {
        label,
        file: relativeRepoPath(rootDir, filePath),
        schema,
        status: 'missing',
        errors: [],
      };
    }
    // Read without the loaders so the check reports rather than warns.
    const validation = validateAgainstSchema(schema, loadJson(filePath, label));
    return {
      label,
      file: relativeRepoPath(rootDir, filePath),
      schema,
      status: validation.valid ? 'valid' : 'invalid',
      errors: validation.errors,
    };
  });
  return { rootDir, results, valid: results.every((result) => result.status !== 'invalid') };
}

function formatHuman(report) {
  const lines = [];
  for (const result of report.results) {
    if (result.status === 'missing') {
      lines.push(`SKIP ${result.label} (${result.file} not found)`);
      continue;
    }
    if (result.status === 'valid') {
      lines.push(`PASS ${result.label} (${result.file}) validates against ${result.schema}`);
      continue;
    }
    lines.push(`FAIL ${formatConfigValidationReport({
      label: result.label,
      filePath: result.file,
      validation: { schema: result.schema, errors: result.errors },
      limit: Number.POSITIVE_INFINITY,
    })}`);
  }
  return `${lines.join('\n')}\n`;
}

export function runRepoConfigCheckCli(argv = process.argv.slice(2), defaults = {}) {
  const { options } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--repo-map': { type: 'string', key: 'repoMapPath' },
    '--repo-standards': { type: 'string', key: 'repoStandardsPath' },
    '--format': { type: 'string', key: 'format' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const { repoMapPath, repoStandardsPath } = resolveVeritasPaths(
    { ...options, rootDir },
    { ...defaults, rootDir },
  );
  const report = validateRepoConfig({ rootDir, repoMapPath, repoStandardsPath });
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatHuman(report));
  }
  if (!report.valid) {
    process.exitCode = 1;
  }
}
