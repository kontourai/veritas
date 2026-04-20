#!/usr/bin/env node
import { runGuidanceReportCli, runInitCli } from '../src/index.mjs';

const [subcommand, ...args] = process.argv.slice(2);
const cwd = process.cwd();

if (subcommand === 'init') {
  runInitCli(args, { rootDir: cwd });
} else if (subcommand === 'report') {
  runGuidanceReportCli(args, {
    rootDir: cwd,
  });
} else {
  process.stderr.write(`Usage:
  ai-guidance init [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--force]
  ai-guidance report [--adapter <path>] [--policy-pack <path>] [file ...]
`);
  process.exitCode = 1;
}
