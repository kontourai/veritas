#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVeritasReportCli } from '../src/index.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

if (argv.some((token) => token === '--help' || token === '-h' || token === 'help')) {
  process.stdout.write(
    `Usage:
  veritas-report [--trend] [--root <path>] [--adapter <path>] [--repo-standards <path>] [--working-tree | --staged | --unstaged | --untracked | --changed-from <ref> --changed-to <ref>] [--run-id <id>] [file ...]
`,
  );
  process.exit(0);
}

await runVeritasReportCli(argv, {
  rootDir: process.cwd(),
  adapterPath: resolve(process.cwd(), '.veritas/repo.adapter.json'),
  repoStandardsPath: resolve(
    process.cwd(),
    '.veritas/repo-standards/default.repo-standards.json',
  ),
  frameworkRootDir: repoRoot,
});
