#!/usr/bin/env node
import {
  runGuidanceReportCli,
  runInitCli,
  runPrintCiSnippetCli,
  runPrintPackageScriptsCli,
} from '../src/index.mjs';

const [subcommand, ...args] = process.argv.slice(2);
const cwd = process.cwd();

if (subcommand === 'init') {
  runInitCli(args, { rootDir: cwd });
} else if (subcommand === 'report') {
  runGuidanceReportCli(args, {
    rootDir: cwd,
  });
} else if (subcommand === 'print') {
  const [kind, ...printArgs] = args;
  if (kind === 'package-scripts') {
    runPrintPackageScriptsCli(printArgs, { rootDir: cwd });
  } else if (kind === 'ci-snippet') {
    runPrintCiSnippetCli(printArgs, { rootDir: cwd });
  } else {
    process.stderr.write(`Usage:
  ai-guidance print package-scripts [--root <path>] [--proof-lane <cmd>]
  ai-guidance print ci-snippet [--root <path>] [--proof-lane <cmd>]
`);
    process.exitCode = 1;
  }
} else {
  process.stderr.write(`Usage:
  ai-guidance init [--root <path>] [--project-name <name>] [--proof-lane <cmd>] [--force]
  ai-guidance report [--adapter <path>] [--policy-pack <path>] [file ...]
  ai-guidance print package-scripts [--root <path>] [--proof-lane <cmd>]
  ai-guidance print ci-snippet [--root <path>] [--proof-lane <cmd>]
`);
  process.exitCode = 1;
}
