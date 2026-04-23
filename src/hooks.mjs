import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadJson } from './load.mjs';
import { assertWithinDir, relativeRepoPath } from './paths.mjs';
import { buildSuggestedCiSnippet, buildSuggestedPackageScripts } from './bootstrap.mjs';
import { shellQuote } from './shell.mjs';

export function buildSuggestedGitHook({ hook = 'post-commit' } = {}) {
  if (hook !== 'post-commit') {
    throw new Error(`Unsupported git hook kind: ${hook}`);
  }

  return `#!/bin/sh
set -eu

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

if git rev-parse --verify --quiet HEAD~1 >/dev/null; then
  npm exec -- veritas shadow run --changed-from HEAD~1 --changed-to HEAD
else
  EMPTY_TREE="$(git hash-object -t tree /dev/null)"
  npm exec -- veritas shadow run --changed-from "$EMPTY_TREE" --changed-to HEAD
fi
`;
}

export function buildSuggestedRuntimeHook() {
  return `#!/bin/sh
set -eu

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

if [ "$#" -eq 0 ]; then
  exec npm exec -- veritas shadow run --working-tree
fi

exec npm exec -- veritas shadow run "$@"
`;
}

export function buildSuggestedCodexHookConfig() {
  return {
    hooks: {
      Stop: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: '.veritas/hooks/agent-runtime.sh',
              statusMessage: 'Running Veritas shadow automation',
              timeout: 60,
            },
          ],
        },
      ],
    },
  };
}

export function applyPackageScripts({
  rootDir,
  proofLane = 'npm test',
  baseRef = '<base-ref>',
  force = false,
}) {
  const packageJsonPath = resolve(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('apply package-scripts requires package.json at the repo root');
  }

  const packageJson = loadJson(packageJsonPath, 'package.json');
  const nextScripts = buildSuggestedPackageScripts({ proofLane, baseRef });
  const currentScripts = packageJson.scripts ?? {};

  for (const [key, value] of Object.entries(nextScripts)) {
    if (!force && key in currentScripts && currentScripts[key] !== value) {
      throw new Error(
        `Refusing to overwrite existing script ${key}; rerun with --force if you want to replace it`,
      );
    }
  }

  packageJson.scripts = { ...currentScripts, ...nextScripts };
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  return {
    rootDir,
    packageJsonPath: relativeRepoPath(rootDir, packageJsonPath),
    proofLane,
    baseRef,
    appliedScripts: Object.keys(nextScripts),
  };
}

export function applyCiSnippet({
  rootDir,
  proofLane = 'npm test',
  baseRef = '<base-ref>',
  outputPath = '.veritas/snippets/ci-snippet.yml',
  force = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/snippets'),
    'apply ci-snippet only supports writing inside .veritas/snippets/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${outputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(resolve(rootDir, '.veritas/snippets'), { recursive: true });
  writeFileSync(
    resolvedOutputPath,
    buildSuggestedCiSnippet({ proofLane, baseRef }),
    'utf8',
  );

  return {
    rootDir,
    outputPath: relativeOutputPath,
    proofLane,
    baseRef,
  };
}

export function applyGitHook({
  rootDir,
  hook = 'post-commit',
  outputPath = `.githooks/${hook}`,
  force = false,
  configureGit = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.githooks'),
    'apply git-hook only supports writing inside .githooks/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }
  if (configureGit && basename(relativeOutputPath) !== hook) {
    throw new Error(
      `apply git-hook with --configure-git requires the output filename to match ${hook}`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, buildSuggestedGitHook({ hook }), 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  let configuredHooksPath = null;
  if (configureGit) {
    configuredHooksPath = dirname(relativeOutputPath);
    execFileSync('git', ['config', 'core.hooksPath', configuredHooksPath], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    });
  }

  return {
    rootDir,
    hook,
    outputPath: relativeOutputPath,
    configuredHooksPath,
  };
}

export function applyRuntimeHook({
  rootDir,
  outputPath = '.veritas/hooks/agent-runtime.sh',
  force = false,
}) {
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/hooks'),
    'apply runtime-hook only supports writing inside .veritas/hooks/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, buildSuggestedRuntimeHook(), 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  return {
    rootDir,
    outputPath: relativeOutputPath,
  };
}

function mergeCodexHooksConfig(existingConfig, adapterConfig) {
  const merged = {
    ...existingConfig,
    hooks: { ...(existingConfig?.hooks ?? {}) },
  };
  const adapterEntries = Array.isArray(adapterConfig?.hooks?.Stop)
    ? adapterConfig.hooks.Stop
    : [];
  const currentEntries = Array.isArray(merged.hooks.Stop) ? merged.hooks.Stop : [];
  const adapterCommand = adapterEntries[0]?.hooks?.[0]?.command;
  const filteredEntries = currentEntries
    .map((entry) => {
      const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const remainingHooks = hooks.filter((hook) => hook?.command !== adapterCommand);
      if (remainingHooks.length === 0) {
        return null;
      }
      return {
        ...entry,
        hooks: remainingHooks,
      };
    })
    .filter(Boolean);
  merged.hooks.Stop = [...filteredEntries, ...adapterEntries];
  return merged;
}

function resolveCodexHooksTarget(rootDir, options = {}) {
  if (options.targetHooksFile && options.codexHome) {
    throw new Error(
      'codex-hook accepts either --target-hooks-file or --codex-home, not both',
    );
  }

  if (options.targetHooksFile) {
    return resolve(rootDir, options.targetHooksFile);
  }
  if (options.codexHome) {
    return resolve(rootDir, options.codexHome, 'hooks.json');
  }
  return null;
}

function codexHookAdapterCommand() {
  return buildSuggestedCodexHookConfig().hooks.Stop[0].hooks[0].command;
}

function formatTargetPath(rootDir, targetPath) {
  const relativeTargetPath = relativeRepoPath(rootDir, targetPath);
  return relativeTargetPath.startsWith('..')
    ? targetPath.replaceAll('\\', '/')
    : relativeTargetPath;
}

export function inspectCodexHookTarget(rootDir, options = {}) {
  const resolvedTargetPath = resolveCodexHooksTarget(rootDir, options);
  if (!resolvedTargetPath) {
    return {
      resolvedTargetPath: null,
      checked: false,
      targetExists: false,
      adapterInstalled: false,
    };
  }

  const targetExists = existsSync(resolvedTargetPath);
  let adapterInstalled = false;
  if (targetExists) {
    try {
      const parsed = JSON.parse(readFileSync(resolvedTargetPath, 'utf8'));
      const stopEntries = Array.isArray(parsed?.hooks?.Stop) ? parsed.hooks.Stop : [];
      adapterInstalled = stopEntries.some((entry) => {
        const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
        return hooks.some((hook) => hook?.command === codexHookAdapterCommand());
      });
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      adapterInstalled = false;
    }
  }

  return {
    resolvedTargetPath: formatTargetPath(rootDir, resolvedTargetPath),
    checked: true,
    targetExists,
    adapterInstalled,
  };
}

function isExecutable(path) {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function readGitConfigValue(rootDir, key) {
  try {
    return execFileSync('git', ['config', '--get', key], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

export function inspectRuntimeAdapterStatus(rootDir, options = {}) {
  const gitHookPath = resolve(rootDir, '.githooks/post-commit');
  const runtimeHookPath = resolve(rootDir, '.veritas/hooks/agent-runtime.sh');
  const codexArtifactPath = resolve(rootDir, '.veritas/runtime/codex-hooks.json');
  const configuredHooksPath = readGitConfigValue(rootDir, 'core.hooksPath');
  const codexTarget = inspectCodexHookTarget(rootDir, options);

  const status = {
    gitHook: {
      path: '.githooks/post-commit',
      exists: existsSync(gitHookPath),
      executable: isExecutable(gitHookPath),
      configuredHooksPath,
      configured: configuredHooksPath === '.githooks',
    },
    runtimeHook: {
      path: '.veritas/hooks/agent-runtime.sh',
      exists: existsSync(runtimeHookPath),
      executable: isExecutable(runtimeHookPath),
    },
    codexArtifact: {
      path: '.veritas/runtime/codex-hooks.json',
      exists: existsSync(codexArtifactPath),
    },
    codexTarget,
    nextCommands: [],
  };

  if (!status.gitHook.exists || !status.gitHook.configured) {
    status.nextCommands.push(
      `npm exec -- veritas apply git-hook --configure-git${status.gitHook.exists ? ' --force' : ''}`,
    );
  } else if (!status.gitHook.executable) {
    status.nextCommands.push('npm exec -- veritas apply git-hook --configure-git --force');
  }
  if (!status.runtimeHook.exists) {
    status.nextCommands.push('npm exec -- veritas apply runtime-hook');
  } else if (!status.runtimeHook.executable) {
    status.nextCommands.push('npm exec -- veritas apply runtime-hook --force');
  }
  if (!status.codexArtifact.exists) {
    status.nextCommands.push('npm exec -- veritas print codex-hook');
  }
  if (!codexTarget.checked) {
    status.nextCommands.push(
      'npm exec -- veritas print codex-hook --codex-home /path/to/.codex',
    );
  } else if (options.codexHome && !codexTarget.adapterInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas apply codex-hook --codex-home ${shellQuote(options.codexHome)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  } else if (options.targetHooksFile && !codexTarget.adapterInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas apply codex-hook --target-hooks-file ${shellQuote(options.targetHooksFile)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  }

  return status;
}

export function applyCodexHook({
  rootDir,
  outputPath = '.veritas/runtime/codex-hooks.json',
  force = false,
  targetHooksFile,
  codexHome,
}) {
  resolveCodexHooksTarget(rootDir, { targetHooksFile, codexHome });
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/runtime'),
    'apply codex-hook only supports writing inside .veritas/runtime/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  const adapterConfig = buildSuggestedCodexHookConfig();
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, `${JSON.stringify(adapterConfig, null, 2)}\n`, 'utf8');

  let mergedTargetPath = null;
  const resolvedTargetPath = resolveCodexHooksTarget(rootDir, {
    targetHooksFile,
    codexHome,
  });
  if (resolvedTargetPath) {
    const existingConfig = existsSync(resolvedTargetPath)
      ? JSON.parse(readFileSync(resolvedTargetPath, 'utf8'))
      : {};
    const mergedConfig = mergeCodexHooksConfig(existingConfig, adapterConfig);
    mkdirSync(dirname(resolvedTargetPath), { recursive: true });
    writeFileSync(resolvedTargetPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
    mergedTargetPath = formatTargetPath(rootDir, resolvedTargetPath);
  }

  return {
    rootDir,
    outputPath: relativeOutputPath,
    mergedTargetPath,
  };
}
