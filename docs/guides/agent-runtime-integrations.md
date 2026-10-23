# Agent Runtime Integrations

Veritas is intentionally agent-agnostic. These integration notes show where the product fits when the runtime changes.

## Claude Code

- keep the tracked repo-local config under `.veritas/`
- use `npx --no @kontourai/veritas readiness --working-tree` as the explicit orchestration command; it prints agent-readable feedback by default
- use `npx --no @kontourai/veritas integrations claude-code install` to write the Stop, PreToolUse and SessionEnd hooks and the `.claude/settings.json` wiring in one step
- use `npx --no @kontourai/veritas apply stop-hook --tool claude-code` when you want only the Stop-hook feedback at turn end
- use the generated git/runtime hooks when you want post-change automation instead of manual invocation

## Codex

For a standalone installation, inspect the proposed files and target before running:

```bash
npx --no @kontourai/veritas integrations codex status
npx --no @kontourai/veritas integrations codex install --target-hooks-file .codex/hooks.json
```

The installer creates tracked runtime configuration and Git hooks as well as the selected target hook configuration. Review existing hooks first; conflicting files refuse rather than being a reason to use `--force` routinely. The generated configuration includes PreToolUse and Stop handlers. Use `/hooks` in Codex to review and trust the exact definition; a written file is not proof the host executes it.

If you use Flow Agents to distribute hooks, the optional [Governance Kit](governance-kit.md) has a separate reviewed provision path and migration capability requirements. It is not required to call `plan`, `explain` or `readiness` directly.

The pre-edit hook provides guidance for supported path-bearing edits. `readiness` owns post-change policy and check results. Codex rollout transcript capture is not supported by the current session-log reader.

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
the physical directory walk must reach the Git root before either local or global lookup is accepted. An unrelated `GIT_DIR` / `GIT_WORK_TREE` root refuses before any package runs. If neither entry exists it refuses
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
