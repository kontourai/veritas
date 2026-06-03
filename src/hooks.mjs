import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadJson } from './load.mjs';
import { loadRepoMap, loadRepoStandards } from './load.mjs';
import { assertWithinDir, relativeRepoPath } from './paths.mjs';
import { buildSuggestedCiSnippet, buildSuggestedPackageScripts } from './bootstrap.mjs';
import { evaluateWorkAreaBoundaryRule, evaluateRepoStandards } from './rules/evaluate.mjs';
import { readCurrentAttestation } from './attestations.mjs';

function isSymlinkPath(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function buildSuggestedGitHook({ hook = 'post-commit' } = {}) {
  if (!['post-commit', 'pre-push'].includes(hook)) {
    throw new Error(`Unsupported git hook kind: ${hook}`);
  }

  if (hook === 'pre-push') {
    return `#!/bin/sh
set -eu

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

if [ ! -f package.json ]; then
  echo "Veritas pre-push: package.json not found; skipping."
  exit 0
fi

npm run --if-present prepush
`;
  }

  return `#!/bin/sh
set -eu

if [ "\${VERITAS_HOOK_SKIP:-\${AI_GUIDANCE_HOOK_SKIP:-0}}" = "1" ]; then
  exit 0
fi

if git rev-parse --verify --quiet HEAD~1 >/dev/null; then
  npm exec -- veritas readiness --changed-from HEAD~1 --changed-to HEAD
else
  EMPTY_TREE="$(git hash-object -t tree /dev/null)"
  npm exec -- veritas readiness --changed-from "$EMPTY_TREE" --changed-to HEAD
fi
`;
}

export function buildSuggestedRuntimeHook() {
  return `#!/bin/sh
set -eu

if [ "\${VERITAS_HOOK_SKIP:-0}" = "1" ]; then
  exit 0
fi

if [ "$#" -eq 0 ]; then
  exec npm exec -- veritas readiness --format json --working-tree
fi

exec npm exec -- veritas readiness --format json "$@"
`;
}

export function buildSuggestedStopHook({ tool = 'generic' } = {}) {
  if (!['generic', 'claude-code', 'cursor'].includes(tool)) {
    throw new Error(`Unsupported stop hook tool: ${tool}`);
  }

  const hookBody = `#!/bin/sh
# .veritas/hooks/stop.sh -- run by AI tools at Stop/turn-end.
# Surfaces unresolved Veritas lint issues back to the agent without blocking the session.

if [ "\${VERITAS_HOOK_SKIP:-0}" = "1" ]; then
  exit 0
fi

RESULT=$(npm exec -- veritas readiness --format feedback --working-tree 2>&1)
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

export function buildSuggestedClaudeCodePreToolUseHook() {
  const hookBody = `#!/bin/sh
# .veritas/hooks/pre-tool-use.sh -- Claude Code PreToolUse Veritas gate.

if [ "\${VERITAS_HOOK_SKIP:-0}" = "1" ]; then
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

export function buildClaudeCodeSessionLogCaptureCommand() {
  return 'VERITAS_SESSION_LOG_PATH="${VERITAS_SESSION_LOG_PATH:-${CLAUDE_TRANSCRIPT_PATH:-}}"; if [ -n "$VERITAS_SESSION_LOG_PATH" ]; then npm exec -- veritas feedback observe --tool claude-code --session-log "$VERITAS_SESSION_LOG_PATH"; fi';
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
                command: buildClaudeCodeSessionLogCaptureCommand(),
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

function buildBuiltinWorkAreaBoundaryRule() {
  return {
    id: 'work-area-boundary',
    kind: 'work-area-boundary',
    classification: 'hard-invariant',
    stage: 'block',
    enforcement: 'deny',
    message: 'Strict work areas cannot be edited by actors without ownership or explicit allowlist access.',
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

function writeExceptionRecord(rootDir, exception) {
  const exceptionsDir = resolve(rootDir, '.veritas/standards-feedback');
  mkdirSync(exceptionsDir, { recursive: true });
  const path = resolve(exceptionsDir, 'exceptions.jsonl');
  appendFileSync(path, `${JSON.stringify(exception)}\n`, 'utf8');
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
  const config = loadRepoMap(resolve(rootDir, '.veritas/repo-map.json'));
  const repoStandards = loadRepoStandards(resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json'));
  const effectiveActor = resolveHookActor(rootDir, actor);
  const policyResults = evaluateRepoStandards(repoStandards, {
    rootDir,
    changedFiles: [relativeFile],
    config,
    actor: effectiveActor,
  });
  const workAreaBoundaryResult = evaluateWorkAreaBoundaryRule(buildBuiltinWorkAreaBoundaryRule(), {
    rootDir,
    changedFiles: [relativeFile],
    config,
    actor: effectiveActor,
  });
  const results = [workAreaBoundaryResult, ...policyResults];
  const blocked = deniedResults(results);
  const exceptionRule = process.env.VERITAS_EXCEPTION_RULE;
  const exceptionReason = process.env.VERITAS_EXCEPTION_REASON;
  if (blocked.length > 0 && exceptionRule && exceptionReason) {
    const matching = blocked.find((result) => result.rule_id === exceptionRule);
    if (matching) {
      const exception = {
        ruleId: exceptionRule,
        reason: exceptionReason,
        actor: effectiveActor,
        timestamp: new Date().toISOString(),
        file: relativeFile,
      };
      return {
        decision: 'approve',
        reason: `Exception accepted for ${exceptionRule}: ${exceptionReason}`,
        file: relativeFile,
        actor: effectiveActor,
        results,
        exceptions: [exception],
        exceptionPath: writeExceptionRecord(rootDir, exception),
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
  evidenceCheck = 'npm test',
  baseRef = '<base-ref>',
  force = false,
}) {
  const packageJsonPath = resolve(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error('apply package-scripts requires package.json at the repo root');
  }

  const packageJson = loadJson(packageJsonPath, 'package.json');
  const nextScripts = buildSuggestedPackageScripts({ evidenceCheck, baseRef });
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
    evidenceCheck,
    baseRef,
    appliedScripts: Object.keys(nextScripts),
  };
}

export function applyCiSnippet({
  rootDir,
  evidenceCheck = 'npm test',
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
    buildSuggestedCiSnippet({ evidenceCheck, baseRef }),
    'utf8',
  );

  return {
    rootDir,
    outputPath: relativeOutputPath,
    evidenceCheck,
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
  const hooksDir = resolve(rootDir, '.githooks');
  assertWithinDir(
    resolvedOutputPath,
    hooksDir,
    'apply git-hook only supports writing inside .githooks/',
  );
  const relativeOutputPath = relativeRepoPath(rootDir, resolvedOutputPath);

  if (isSymlinkPath(hooksDir)) {
    throw new Error('apply git-hook refuses to write through a symlinked .githooks directory');
  }
  if (isSymlinkPath(dirname(resolvedOutputPath))) {
    throw new Error('apply git-hook refuses to write through a symlinked hook directory');
  }
  if (isSymlinkPath(resolvedOutputPath)) {
    throw new Error(`apply git-hook refuses to write through a symlinked hook file: ${relativeOutputPath}`);
  }

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

function installRepoHook({ rootDir, hook, force }) {
  const outputPath = `.githooks/${hook}`;
  const resolvedOutputPath = resolve(rootDir, outputPath);
  const hooksDir = resolve(rootDir, '.githooks');
  const expectedBody = buildSuggestedGitHook({ hook });

  if (!existsSync(resolvedOutputPath) || force) {
    return applyGitHook({
      rootDir,
      hook,
      outputPath,
      force,
      configureGit: true,
    });
  }

  if (isSymlinkPath(hooksDir)) {
    throw new Error('setup repo-hooks refuses to write through a symlinked .githooks directory');
  }
  if (isSymlinkPath(dirname(resolvedOutputPath))) {
    throw new Error('setup repo-hooks refuses to write through a symlinked hook directory');
  }
  if (isSymlinkPath(resolvedOutputPath)) {
    throw new Error(`apply git-hook refuses to write through a symlinked hook file: ${outputPath}`);
  }

  const currentBody = readFileSync(resolvedOutputPath, 'utf8');
  if (currentBody !== expectedBody) {
    throw new Error(
      `Refusing to overwrite existing file: ${outputPath} (use --force to replace it)`,
    );
  }

  chmodSync(resolvedOutputPath, 0o755);
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  });

  return {
    rootDir,
    hook,
    outputPath,
    configuredHooksPath: '.githooks',
  };
}

export function setupRepoHooks({ rootDir, force = false } = {}) {
  const hooks = [
    installRepoHook({ rootDir, hook: 'post-commit', force }),
    installRepoHook({ rootDir, hook: 'pre-push', force }),
  ];

  return {
    rootDir,
    hooks,
    configuredHooksPath: '.githooks',
    setupCommand: 'npm exec -- veritas setup repo-hooks',
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
