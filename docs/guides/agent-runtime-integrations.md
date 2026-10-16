# Agent Runtime Integrations

Veritas is intentionally agent-agnostic. These integration notes show where the product fits when the runtime changes.

## Claude Code

- keep the tracked repo-local config under `.veritas/`
- use `npx --no @kontourai/veritas readiness --working-tree` as the explicit orchestration command; it prints agent-readable feedback by default
- use `npx --no @kontourai/veritas integrations claude-code install` to write the Stop hook, the PreToolUse hook and the `.claude/settings.json` wiring in one step
- use `npx --no @kontourai/veritas apply stop-hook --tool claude-code` when you want only the Stop-hook feedback at turn end
- use the generated git/runtime hooks when you want post-change automation instead of manual invocation

## Codex

- install the Git-backed Veritas Governance Kit through Flow Agents, then use
  `flow-agents kit provision veritas-governance --target .` after reviewing its
  dry run; it installs the declared `.codex/hooks.json` PreToolUse asset
- use `/hooks` in Codex to review and trust that exact project hook definition;
  a provisioned file alone does not establish that the host runs it
- the hook asks Veritas for guidance before path-bearing `apply_patch` edits;
  `veritas readiness` still owns post-change rule and Evidence Check verdicts

## Cursor

- keep Repo Map and Repo Standards files in the repo, not in editor-only settings
- point Cursor rules or project instructions at the repo-local Veritas governance block
- use `npx --no @kontourai/veritas integrations cursor install` to write `.veritas/hooks/stop.sh` and its Cursor hook config, or `npx --no @kontourai/veritas apply stop-hook --tool cursor` to generate only that thin wrapper
- prefer `npx --no @kontourai/veritas readiness --check evidence` for review-only generated evidence and `npx --no @kontourai/veritas readiness` for evidence-check plus standards-feedback paths

## GitHub Copilot Workspace

- treat Veritas as the repo-local contract surface, not as Copilot-specific policy
- run Veritas in CI to keep the evidence path independent from the editor surface
- use the same `.veritas/` artifacts for local and remote execution

## Aider

- keep Veritas commands in repo scripts so Aider sessions can invoke the same surface as every other runtime
- prefer explicit report or readiness-check commands over ad hoc shell snippets
- store Repo Map and Repo Standards changes in normal reviewable commits

## Common Rule

Generated POSIX post-commit, runtime, Stop and Claude Code pre-edit scripts run
the nearest eligible repository install's `bin/veritas.mjs` with Node. They check
the entry they run, so missing `.bin` links do not redirect a local hook to a
parent or PATH `veritas`. With no eligible local entry they retain the explicit
`npx --no @kontourai/veritas` fallback. Codex's native Windows override uses Node's physical directory identities to select
and run the same eligible package entry, without invoking a PATH binary. With no
repository install, it checks the exact scoped package entry under `npm root --global`;
outside Git it checks the current directory first. If neither entry exists it refuses
without downloading. The Windows launcher requires Node and Git, and preserves
hook stdin, arguments and exit status. See [migration instructions](../MIGRATING.md#agent-hook-commands-run-the-install-they-found)
to refresh scripts already installed in a consumer repository.

The generated Stop hook ends its feedback by asking the agent to address the
FAIL lines before finishing. When a FAIL line says a human authority must act,
such as renewing an expired attestation, the agent is told to stop and report
it to the user instead of acting on it.

No matter which runtime you use, keep these pieces repo-local and reviewable:

- Repo Map
- Repo Standards
- protected standards settings
- AI instruction governance block
- stop hook shell contract
- generated evidence and standards feedback flow
