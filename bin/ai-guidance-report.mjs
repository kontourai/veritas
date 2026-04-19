#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuidanceReportCli } from '../src/index.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

runGuidanceReportCli(process.argv.slice(2), {
  rootDir: process.cwd(),
  adapterPath: resolve(process.cwd(), '.ai-guidance/work-agent.adapter.json'),
  policyPackPath: resolve(
    process.cwd(),
    '.ai-guidance/policy-packs/work-agent-convergence.policy-pack.json',
  ),
  frameworkRootDir: repoRoot,
});
