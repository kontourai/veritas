import { resolve } from 'node:path';
import { inferBootstrapRepoInsights } from '../bootstrap.mjs';

export function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function resolveSetupCliContext({ argv, defaults, parseArgs, inferRepoInsights = false }) {
  const options = parseArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (!inferRepoInsights) return { options, rootDir };

  const repoInsights = inferBootstrapRepoInsights(rootDir);
  return {
    options,
    rootDir,
    repoInsights,
    evidenceCheck: options.evidenceCheck ?? repoInsights.evidenceCheck,
  };
}
