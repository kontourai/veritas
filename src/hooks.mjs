import {
  appendFileSync,
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
import { loadAdapterConfig, loadPolicyPack } from './load.mjs';
import { assertWithinDir, relativeRepoPath } from './paths.mjs';
import { buildSuggestedCiSnippet, buildSuggestedPackageScripts } from './bootstrap.mjs';
import { shellQuote } from './shell.mjs';
import { evaluateCrossSurfaceWriteRule, evaluatePolicyPack } from './rules/evaluate.mjs';
import { readCurrentAttestation } from './attestations.mjs';

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
  npm exec -- veritas run --changed-from HEAD~1 --changed-to HEAD
else
  EMPTY_TREE="$(git hash-object -t tree /dev/null)"
  npm exec -- veritas run --changed-from "$EMPTY_TREE" --changed-to HEAD
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
  exec npm exec -- veritas run --format json --working-tree
fi

exec npm exec -- veritas run --format json "$@"
`;
}

export function buildSuggestedStopHook({ tool = 'generic' } = {}) {
  if (!['generic', 'claude-code', 'cursor'].includes(tool)) {
    throw new Error(`Unsupported stop hook tool: ${tool}`);
  }

  const hookBody = `#!/bin/sh
# .veritas/hooks/stop.sh -- run by AI tools at Stop/turn-end.
# Surfaces unresolved Veritas lint issues back to the agent without blocking the session.

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

RESULT=$(npm exec -- veritas run --format feedback --working-tree 2>&1)
EXIT=$?
if [ "$EXIT" -ne 0 ]; then
  echo "$RESULT"
  echo ""
  echo "Veritas: address the FAIL lines above before finishing."
fi

exit 0
`;

  if (tool === 'claude-code') {
    return {
      tool,
      outputPath: '.veritas/hooks/stop.sh',
      hookBody,
      toolConfigPath: '.claude/settings.json',
      toolConfig: {
        hooks: {
          Stop: [
            {
              matcher: '.*',
              hooks: [
                {
                  type: 'command',
                  command: '.veritas/hooks/stop.sh',
                  timeout: 60,
                },
              ],
            },
          ],
        },
      },
    };
  }

  if (tool === 'cursor') {
    return {
      tool,
      outputPath: '.veritas/hooks/stop.sh',
      hookBody,
      toolConfigPath: '.cursor/hooks.json',
      toolConfig: {
        hooks: {
          stop: [
            {
              command: '.veritas/hooks/stop.sh',
            },
          ],
        },
      },
    };
  }

  return {
    tool,
    outputPath: '.veritas/hooks/stop.sh',
    hookBody,
    defaultInvocation: '.veritas/hooks/stop.sh',
  };
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
      PostSession: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command:
                'if [ -n "$CODEX_TRANSCRIPT_PATH" ]; then npm exec -- veritas eval observe --transcript "$CODEX_TRANSCRIPT_PATH"; elif [ -n "$CODEX_SESSION_ID" ]; then npm exec -- veritas eval observe --transcript "$HOME/.codex/sessions/$CODEX_SESSION_ID.json"; fi',
              statusMessage: 'Capturing Veritas eval draft from Codex transcript',
              timeout: 60,
            },
          ],
        },
      ],
    },
  };
}

export function buildSuggestedClaudeCodePreToolUseHook() {
  const hookBody = `#!/bin/sh
# .veritas/hooks/pre-tool-use.sh -- Claude Code PreToolUse Veritas gate.

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

exec npm exec -- veritas hooks claude-code pre-tool-use "$@"
`;

  return {
    tool: 'claude-code',
    outputPath: '.veritas/hooks/pre-tool-use.sh',
    hookBody,
    toolConfigPath: '.claude/settings.json',
    toolConfig: {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit|MultiEdit|Write',
            hooks: [
              {
                type: 'command',
                command: '.veritas/hooks/pre-tool-use.sh',
                timeout: 20,
              },
            ],
          },
        ],
      },
    },
  };
}

export function buildSuggestedClaudeCodePostSessionHook() {
  return {
    tool: 'claude-code',
    toolConfigPath: '.claude/settings.json',
    toolConfig: {
      hooks: {
        PostSession: [
          {
            matcher: '.*',
            hooks: [
              {
                type: 'command',
                command:
                  'if [ -n "$CLAUDE_TRANSCRIPT_PATH" ]; then npm exec -- veritas eval observe --tool claude-code --transcript "$CLAUDE_TRANSCRIPT_PATH"; fi',
                timeout: 60,
              },
            ],
          },
        ],
      },
    },
  };
}

function normalizeHookFilePath(rootDir, filePath) {
  if (!filePath) return null;
  const resolvedPath = resolve(rootDir, filePath);
  return relativeRepoPath(rootDir, resolvedPath);
}

function findFilePathInHookPayload(payload) {
  const candidates = [
    payload?.tool_input?.file_path,
    payload?.tool_input?.path,
    payload?.file_path,
    payload?.path,
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? null;
}

function readHookPayload(stdinText) {
  if (!stdinText.trim()) return {};
  try {
    return JSON.parse(stdinText);
  } catch {
    return {};
  }
}

function resolveHookActor(rootDir, explicitActor) {
  if (explicitActor) return explicitActor;
  if (process.env.VERITAS_ACTOR) return process.env.VERITAS_ACTOR;
  return readCurrentAttestation(rootDir)?.actor?.id ?? null;
}

function buildBuiltinCrossSurfaceRule() {
  return {
    id: 'cross-surface-write',
    kind: 'cross-surface-write',
    classification: 'hard-invariant',
    stage: 'block',
    enforcement: 'deny',
    message: 'Strict repo surfaces cannot be edited by actors without ownership or explicit allowlist access.',
    owner: 'repo-core',
    rollback_switch: null,
    match: {},
  };
}

function deniedResults(results) {
  return results.filter((result) => result.enforcement === 'deny' && result.passed === false);
}

function formatDenyReason(results) {
  return results
    .map((result) => {
      const findings = (result.findings ?? [])
        .map((finding) => finding.artifact ?? finding.path ?? finding.required ?? finding.kind)
        .filter(Boolean)
        .join(', ');
      return findings ? `${result.rule_id}: ${result.summary} (${findings})` : `${result.rule_id}: ${result.summary}`;
    })
    .join('\n');
}

function writeOverrideRecord(rootDir, override) {
  const overridesDir = resolve(rootDir, '.veritas/evals');
  mkdirSync(overridesDir, { recursive: true });
  const path = resolve(overridesDir, 'overrides.jsonl');
  appendFileSync(path, `${JSON.stringify(override)}\n`, 'utf8');
  return relativeRepoPath(rootDir, path);
}

export function evaluatePreToolUse({
  rootDir,
  filePath,
  stdinText = '',
  actor,
} = {}) {
  const payload = readHookPayload(stdinText);
  const relativeFile = normalizeHookFilePath(rootDir, filePath ?? findFilePathInHookPayload(payload));
  if (!relativeFile) {
    return {
      decision: 'approve',
      reason: 'No file path found in PreToolUse payload.',
      file: null,
      actor: resolveHookActor(rootDir, actor),
      results: [],
    };
  }
  const config = loadAdapterConfig(resolve(rootDir, '.veritas/repo.adapter.json'));
  const policyPack = loadPolicyPack(resolve(rootDir, '.veritas/policy-packs/default.policy-pack.json'));
  const effectiveActor = resolveHookActor(rootDir, actor);
  const policyResults = evaluatePolicyPack(policyPack, {
    rootDir,
    changedFiles: [relativeFile],
    config,
    actor: effectiveActor,
  });
  const crossSurfaceResult = evaluateCrossSurfaceWriteRule(buildBuiltinCrossSurfaceRule(), {
    rootDir,
    changedFiles: [relativeFile],
    config,
    actor: effectiveActor,
  });
  const results = [crossSurfaceResult, ...policyResults];
  const blocked = deniedResults(results);
  const overrideRule = process.env.VERITAS_OVERRIDE_RULE;
  const overrideReason = process.env.VERITAS_OVERRIDE_REASON;
  if (blocked.length > 0 && overrideRule && overrideReason) {
    const matching = blocked.find((result) => result.rule_id === overrideRule);
    if (matching) {
      const override = {
        ruleId: overrideRule,
        reason: overrideReason,
        actor: effectiveActor,
        timestamp: new Date().toISOString(),
        file: relativeFile,
      };
      return {
        decision: 'approve',
        reason: `Override accepted for ${overrideRule}: ${overrideReason}`,
        file: relativeFile,
        actor: effectiveActor,
        results,
        overrides: [override],
        overridePath: writeOverrideRecord(rootDir, override),
      };
    }
  }
  if (blocked.length > 0) {
    return {
      decision: 'block',
      reason: formatDenyReason(blocked),
      file: relativeFile,
      actor: effectiveActor,
      results,
    };
  }
  return {
    decision: 'approve',
    reason: `Veritas PreToolUse checks passed for ${relativeFile}.`,
    file: relativeFile,
    actor: effectiveActor,
    results,
  };
}

export function applyPackageScripts({
  rootDir,
  proof = 'npm test',
  baseRef = '<base-ref>',
  force = false,
}) {
  const packageJsonPath = resolve(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('apply package-scripts requires package.json at the repo root');
  }

  const packageJson = loadJson(packageJsonPath, 'package.json');
  const nextScripts = buildSuggestedPackageScripts({ proof, baseRef });
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
    proof,
    baseRef,
    appliedScripts: Object.keys(nextScripts),
  };
}

export function applyCiSnippet({
  rootDir,
  proof = 'npm test',
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
    buildSuggestedCiSnippet({ proof, baseRef }),
    'utf8',
  );

  return {
    rootDir,
    outputPath: relativeOutputPath,
    proof,
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

function mergeHookArrays(existingHooks = [], veritasHooks = []) {
  const veritasCommands = new Set(
    veritasHooks
      .map((hook) => hook?.command)
      .filter((command) => typeof command === 'string'),
  );
  const preservedHooks = existingHooks.filter(
    (hook) => !veritasCommands.has(hook?.command),
  );
  return [...preservedHooks, ...veritasHooks];
}

function mergeStopHookConfig(existingConfig = {}, suggestedConfig = {}) {
  const mergedHooks = { ...(existingConfig.hooks ?? {}) };
  for (const [hookName, suggestedEntries] of Object.entries(suggestedConfig.hooks ?? {})) {
    const currentEntries = Array.isArray(mergedHooks[hookName])
      ? mergedHooks[hookName]
      : [];
    if (hookName === 'Stop') {
      const suggestedCommand = suggestedEntries[0]?.hooks?.[0]?.command;
      mergedHooks[hookName] = [
        ...currentEntries
          .map((entry) => {
            const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
            const remainingHooks = hooks.filter(
              (hook) => hook?.command !== suggestedCommand,
            );
            return remainingHooks.length === 0
              ? null
              : { ...entry, hooks: remainingHooks };
          })
          .filter(Boolean),
        ...suggestedEntries,
      ];
      continue;
    }
    if (hookName === 'stop') {
      mergedHooks[hookName] = mergeHookArrays(currentEntries, suggestedEntries);
      continue;
    }
    mergedHooks[hookName] = suggestedEntries;
  }

  return {
    ...existingConfig,
    hooks: mergedHooks,
  };
}

export function applyStopHook({
  rootDir,
  tool = 'generic',
  outputPath = '.veritas/hooks/stop.sh',
  force = false,
}) {
  const suggestion = buildSuggestedStopHook({ tool });
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/hooks'),
    'apply stop-hook only supports writing inside .veritas/hooks/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, suggestion.hookBody, 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  let configuredToolConfigPath = null;
  if (suggestion.toolConfigPath) {
    const resolvedToolConfigPath = resolve(rootDir, suggestion.toolConfigPath);
    assertWithinDir(
      resolvedToolConfigPath,
      rootDir,
      'apply stop-hook tool config must stay inside the repository',
    );
    const existingConfig = existsSync(resolvedToolConfigPath)
      ? loadJson(resolvedToolConfigPath, `${tool} stop-hook config`)
      : {};
    const mergedConfig = mergeStopHookConfig(existingConfig, suggestion.toolConfig);
    mkdirSync(dirname(resolvedToolConfigPath), { recursive: true });
    writeFileSync(resolvedToolConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
    configuredToolConfigPath = relativeRepoPath(rootDir, resolvedToolConfigPath);
  }

  return {
    rootDir,
    tool,
    outputPath: relativeOutputPath,
    toolConfigPath: suggestion.toolConfigPath ?? null,
    configuredToolConfigPath,
  };
}

export function applyClaudeCodePreToolUseHook({
  rootDir,
  outputPath = '.veritas/hooks/pre-tool-use.sh',
  force = false,
}) {
  const suggestion = buildSuggestedClaudeCodePreToolUseHook();
  const resolvedOutputPath = resolve(rootDir, outputPath);
  assertWithinDir(
    resolvedOutputPath,
    resolve(rootDir, '.veritas/hooks'),
    'apply claude-code-pre-tool-use-hook only supports writing inside .veritas/hooks/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (existsSync(resolvedOutputPath) && !force) {
    throw new Error(
      `Refusing to overwrite existing file: ${relativeOutputPath} (use --force to replace it)`,
    );
  }

  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, suggestion.hookBody, 'utf8');
  chmodSync(resolvedOutputPath, 0o755);

  const resolvedToolConfigPath = resolve(rootDir, suggestion.toolConfigPath);
  assertWithinDir(
    resolvedToolConfigPath,
    rootDir,
    'apply claude-code pre-tool-use hook config must stay inside the repository',
  );
  const existingConfig = existsSync(resolvedToolConfigPath)
    ? loadJson(resolvedToolConfigPath, 'claude-code pre-tool-use hook config')
    : {};
  const mergedConfig = mergeStopHookConfig(existingConfig, suggestion.toolConfig);
  mkdirSync(dirname(resolvedToolConfigPath), { recursive: true });
  writeFileSync(resolvedToolConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');

  return {
    rootDir,
    outputPath: relativeOutputPath,
    configuredToolConfigPath: relativeRepoPath(rootDir, resolvedToolConfigPath),
  };
}

export function applyClaudeCodePostSessionHook({ rootDir } = {}) {
  const suggestion = buildSuggestedClaudeCodePostSessionHook();
  const resolvedToolConfigPath = resolve(rootDir, suggestion.toolConfigPath);
  assertWithinDir(
    resolvedToolConfigPath,
    rootDir,
    'apply claude-code post-session hook config must stay inside the repository',
  );
  const existingConfig = existsSync(resolvedToolConfigPath)
    ? loadJson(resolvedToolConfigPath, 'claude-code post-session hook config')
    : {};
  const mergedConfig = mergeStopHookConfig(existingConfig, suggestion.toolConfig);
  mkdirSync(dirname(resolvedToolConfigPath), { recursive: true });
  writeFileSync(resolvedToolConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf8');
  return {
    rootDir,
    configuredToolConfigPath: relativeRepoPath(rootDir, resolvedToolConfigPath),
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
      `npm exec -- veritas integrations codex install${status.gitHook.exists ? ' --force' : ''}`,
    );
  } else if (!status.gitHook.executable) {
    status.nextCommands.push('npm exec -- veritas integrations codex install --force');
  }
  if (!status.runtimeHook.exists) {
    status.nextCommands.push('npm exec -- veritas integrations codex install');
  } else if (!status.runtimeHook.executable) {
    status.nextCommands.push('npm exec -- veritas integrations codex install --force');
  }
  if (!status.codexArtifact.exists) {
    status.nextCommands.push('npm exec -- veritas integrations codex install');
  }
  if (!codexTarget.checked) {
    status.nextCommands.push(
      'npm exec -- veritas integrations codex status --codex-home /path/to/.codex',
    );
  } else if (options.codexHome && !codexTarget.adapterInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas integrations codex install --codex-home ${shellQuote(options.codexHome)}${status.codexArtifact.exists ? ' --force' : ''}`,
    );
  } else if (options.targetHooksFile && !codexTarget.adapterInstalled) {
    status.nextCommands.push(
      `npm exec -- veritas integrations codex install --target-hooks-file ${shellQuote(options.targetHooksFile)}${status.codexArtifact.exists ? ' --force' : ''}`,
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
