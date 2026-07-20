import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadJson } from '../load.mjs';

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return loadJson(path);
}

function detectSourceRoots(rootDir) {
  return ['src/', 'app/', 'packages/', 'apps/', 'docs/', 'content/'].filter((path) =>
    existsSync(resolve(rootDir, path)),
  );
}

function detectToolingRoots(rootDir) {
  return ['scripts/', 'vendor/'].filter((path) => existsSync(resolve(rootDir, path)));
}

function detectTestRoots(rootDir) {
  return ['tests/', 'test/', 'spec/'].filter((path) =>
    existsSync(resolve(rootDir, path)),
  );
}

const GENERATED_TOP_LEVEL_DIRS = new Set([
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'target',
  'test-results',
]);

function detectProductRoots(rootDir, classifiedRoots) {
  const classified = new Set(classifiedRoots.map((root) => root.replace(/\/$/, '')));
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith('.') &&
      !classified.has(entry.name) &&
      !GENERATED_TOP_LEVEL_DIRS.has(entry.name),
    )
    .map((entry) => `${entry.name}/`)
    .sort((left, right) => left.localeCompare(right));
}

function inferBaseRef(rootDir) {
  for (const candidate of ['origin/main', 'origin/master', 'origin/trunk']) {
    const remoteRef = candidate.replace('origin/', '');
    if (existsSync(resolve(rootDir, `.git/refs/remotes/origin/${remoteRef}`))) {
      return candidate;
    }
  }

  for (const candidate of ['main', 'master', 'trunk']) {
    if (existsSync(resolve(rootDir, `.git/refs/heads/${candidate}`))) {
      return candidate;
    }
  }

  if (existsSync(resolve(rootDir, '.git'))) {
    try {
      const headBranch = execFileSync(
        'git',
        ['symbolic-ref', '--quiet', '--short', 'HEAD'],
        {
          cwd: rootDir,
          encoding: 'utf8',
          windowsHide: true,
        },
      ).trim();
      if (headBranch) {
        return headBranch;
      }
    } catch (error) {
      if (error?.status !== 1 && error?.status !== 128) {
        throw error;
      }
    }
  }

  return '<base-ref>';
}

const REPO_DECLARED_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'];

function npmCommandSegments(command) {
  return command.trim().split(/\s*&&\s*/);
}

function isValidatedNpmCommand(command, scripts) {
  const segments = npmCommandSegments(command);
  return segments.length > 0 && segments.every((segment) => {
    const runMatch = /^npm run ([A-Za-z0-9:_-]+)$/.exec(segment);
    if (runMatch) return typeof scripts[runMatch[1]] === 'string';
    return segment === 'npm test' && typeof scripts.test === 'string';
  });
}

function npmCommandsInLine(line) {
  const backtickedCommands = [...line.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1].trim())
    .filter((command) => command.startsWith('npm '));
  if (backtickedCommands.length > 0) return backtickedCommands;

  return line.match(/npm(?:\s+run\s+[A-Za-z0-9:_-]+|\s+test)(?:\s*&&\s*npm(?:\s+run\s+[A-Za-z0-9:_-]+|\s+test))*/g) ?? [];
}

function verificationSignal(line) {
  if (/broad verification|pre[- ]?merge|before (?:pr )?merge(?: readiness)?|before merging|before review/i.test(line)) {
    return 'pre-merge';
  }
  if (/(?:must|required|always)\s+(?:run|execute)|after (?:making|any) changes|all changes/i.test(line)) {
    return 'broad';
  }
  return null;
}

function detectInstructionVerification(rootDir, scripts) {
  const entries = [];
  for (const path of REPO_DECLARED_INSTRUCTION_FILES) {
    const absolutePath = resolve(rootDir, path);
    if (!existsSync(absolutePath)) continue;
    const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      const signal = verificationSignal(line);
      if (!signal) return;
      for (const command of npmCommandsInLine(line)) {
        if (!isValidatedNpmCommand(command, scripts)) continue;
        entries.push({
          kind: 'instruction-file-verification',
          id: `${path}:${lineIndex + 1}`,
          command,
          recommendedDisposition: 'candidate',
          reason: 'Authoritative repository-declared verification command detected during brownfield init.',
          provenance: {
            path,
            line: lineIndex + 1,
            signal,
            authority: 'repo-declared-ai-instructions',
          },
        });
      }
    });
  }
  return entries;
}

function strongestInstructionCommand(entries) {
  const commands = new Map();
  for (const entry of entries) {
    const current = commands.get(entry.command) ?? {
      command: entry.command,
      preMerge: false,
      segmentCount: npmCommandSegments(entry.command).length,
    };
    current.preMerge ||= entry.provenance.signal === 'pre-merge';
    commands.set(entry.command, current);
  }
  return [...commands.values()]
    .sort((left, right) =>
      Number(right.preMerge) - Number(left.preMerge) ||
      right.segmentCount - left.segmentCount ||
      left.command.localeCompare(right.command),
    )[0]?.command ?? null;
}

function detectExistingVerification(rootDir, scripts = {}) {
  const scriptEntries = Object.entries(scripts)
    .filter(([name, command]) => {
      if (typeof command !== 'string') return false;
      return (
        /convergence|guidance|guardrail|ai-guidance|verify:/.test(name) ||
        /convergence|guidance|guardrail|ai-guidance|\.ai-guidance/.test(command)
      );
    })
    .map(([name, command]) => ({
      kind: 'package-script',
      id: name,
      command,
      recommendedDisposition: name.includes('verify') ? 'candidate' : 'advisory',
      reason: 'Existing custom verification-shaped package script detected during brownfield init.',
    }));

  const fileEntries = [
    '.ai-guidance',
    'vendor/ai-guidance-framework',
    'scripts/verify-convergence.mjs',
    'scripts/guidance-report.mjs',
  ]
    .filter((path) => existsSync(resolve(rootDir, path)))
    .map((path) => ({
      kind: 'existing-path',
      id: path,
      path,
      recommendedDisposition: path === '.ai-guidance' ? 'candidate' : 'advisory',
      reason: 'Existing guidance or convergence path detected; inventory before copying into Veritas.',
    }));

  const instructionEntries = detectInstructionVerification(rootDir, scripts);
  const authoritativeCommands = [...new Set(instructionEntries.map((entry) => entry.command))];

  return {
    detected: scriptEntries.length + fileEntries.length + instructionEntries.length > 0,
    items: [...scriptEntries, ...fileEntries, ...instructionEntries],
    authoritativeCommands,
    selectedAuthoritativeCommand: strongestInstructionCommand(instructionEntries),
    provenance: instructionEntries.map((entry) => ({
      command: entry.command,
      ...entry.provenance,
    })),
    conflicts: [],
    recommendedEvidenceInventoryDefaults: {
      unknownCatchEvidenceDefault: 'candidate',
      requiredNeedsOwner: true,
      requiredNeedsReviewTrigger: true,
      productBehaviorNeedsReplacementTest: true,
    },
  };
}

export function inferBootstrapRepoInsights(rootDir) {
  const packageJson = readJsonIfExists(resolve(rootDir, 'package.json'));
  const scripts = packageJson?.scripts ?? {};
  const sourceRoots = detectSourceRoots(rootDir);
  const toolingRoots = detectToolingRoots(rootDir);
  const testRoots = detectTestRoots(rootDir);
  const productRoots = detectProductRoots(rootDir, [...sourceRoots, ...toolingRoots, ...testRoots]);
  const hasWorkflows = existsSync(resolve(rootDir, '.github/workflows'));
  const hasWorkspaceConfig =
    existsSync(resolve(rootDir, 'pnpm-workspace.yaml')) ||
    existsSync(resolve(rootDir, 'turbo.json')) ||
    existsSync(resolve(rootDir, 'nx.json')) ||
    (existsSync(resolve(rootDir, 'package.json')) && Array.isArray(packageJson?.workspaces));

  let repoKind = 'application';
  if (hasWorkspaceConfig || sourceRoots.includes('packages/') || sourceRoots.includes('apps/')) {
    repoKind = 'workspace';
  } else if (
    (sourceRoots.includes('docs/') || sourceRoots.includes('content/')) &&
    !sourceRoots.includes('src/') &&
    !sourceRoots.includes('app/')
  ) {
    repoKind = 'docs';
  }

  const scriptPriority =
    repoKind === 'docs'
      ? ['docs:build', 'build', 'test', 'verify']
      : ['ci:fast', 'verify', 'test:smoke', 'test', 'build'];
  const matchingScript = scriptPriority.find((name) => typeof scripts[name] === 'string');
  const packageEvidenceCheck = matchingScript
    ? `npm run ${matchingScript}`
    : packageJson
      ? 'npm test'
      : 'node -e "process.exit(0)"';
  const existingVerification = detectExistingVerification(rootDir, scripts);
  const conflicts = [...existingVerification.conflicts];
  if (existingVerification.authoritativeCommands.length > 1) {
    conflicts.push({
      kind: 'instruction-command-disagreement',
      commands: existingVerification.authoritativeCommands,
      reason: 'Authoritative AI instruction files declare different verification commands.',
    });
  }
  if (
    matchingScript &&
    existingVerification.authoritativeCommands.length === 1 &&
    !npmCommandSegments(existingVerification.authoritativeCommands[0]).includes(packageEvidenceCheck)
  ) {
    conflicts.push({
      kind: 'package-script-disagreement',
      command: packageEvidenceCheck,
      instructionCommand: existingVerification.authoritativeCommands[0],
      reason: 'The package-script priority and authoritative AI instruction command differ.',
    });
  }
  existingVerification.conflicts = conflicts;

  const hasConflictingSignals = conflicts.length > 0;
  const authoritativeEvidenceCheck = existingVerification.selectedAuthoritativeCommand;
  const evidenceCheck = authoritativeEvidenceCheck
    ? authoritativeEvidenceCheck
    : packageEvidenceCheck;
  const evidenceCheckConfidence = hasConflictingSignals
    ? 'medium'
    : authoritativeEvidenceCheck || matchingScript
      ? 'high'
      : 'low';
  const evidenceCheckSource = authoritativeEvidenceCheck
    ? 'repo-declared AI instructions'
    : matchingScript
      ? 'package.json scripts'
      : packageJson
        ? 'fallback'
        : 'node runtime smoke fallback';

  return {
    repoKind,
    sourceRoots,
    toolingRoots,
    testRoots,
    productRoots,
    hasWorkflows,
    evidenceCheck,
    enableWorkAreaEvidenceRouting: repoKind === 'workspace' || toolingRoots.length > 0,
    baseRef: inferBaseRef(rootDir),
    packageManager: packageJson ? 'npm' : 'unknown',
    matchedScripts: scriptPriority.filter((name) => typeof scripts[name] === 'string'),
    evidenceCheckConfidence,
    evidenceCheckSource,
    existingVerification,
  };
}
