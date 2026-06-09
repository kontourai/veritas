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
