import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

  return {
    detected: scriptEntries.length + fileEntries.length > 0,
    items: [...scriptEntries, ...fileEntries],
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
  const evidenceCheck = matchingScript ? `npm run ${matchingScript}` : 'npm test';

  return {
    repoKind,
    sourceRoots,
    toolingRoots,
    testRoots,
    hasWorkflows,
    evidenceCheck,
    enableWorkAreaEvidenceRouting: repoKind === 'workspace' || toolingRoots.length > 0,
    baseRef: inferBaseRef(rootDir),
    packageManager: packageJson ? 'npm' : 'unknown',
    matchedScripts: scriptPriority.filter((name) => typeof scripts[name] === 'string'),
    existingVerification: detectExistingVerification(rootDir, scripts),
  };
}
