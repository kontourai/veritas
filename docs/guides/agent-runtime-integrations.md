# Agent Runtime Integrations

Veritas is intentionally agent-agnostic. These integration notes show where the product fits when the runtime changes.

## Claude Code

- keep the tracked repo-local config under `.veritas/`
- use `npx @kontourai/veritas readiness --working-tree` as the explicit orchestration command; it prints agent-readable feedback by default
- use `npx @kontourai/veritas apply stop-hook --tool claude-code` when you want Stop-hook feedback at turn end
- use the generated git/runtime hooks when you want post-change automation instead of manual invocation

## Cursor

- keep Repo Map and Repo Standards files in the repo, not in editor-only settings
- point Cursor rules or project instructions at the repo-local Veritas governance block
- use `npx @kontourai/veritas apply stop-hook --tool cursor` to generate a thin wrapper around `.veritas/hooks/stop.sh`
- prefer `veritas readiness --check evidence` for review-only generated evidence and `veritas readiness` for evidence-check plus standards-feedback paths

## GitHub Copilot Workspace

- treat Veritas as the repo-local contract surface, not as Copilot-specific policy
- run Veritas in CI to keep the evidence path independent from the editor surface
- use the same `.veritas/` artifacts for local and remote execution

## Aider

- keep Veritas commands in repo scripts so Aider sessions can invoke the same surface as every other runtime
- prefer explicit report or readiness-check commands over ad hoc shell snippets
- store Repo Map and Repo Standards changes in normal reviewable commits

## Common Rule

No matter which runtime you use, keep these pieces repo-local and reviewable:

- Repo Map
- Repo Standards
- protected standards settings
- AI instruction governance block
- stop hook shell contract
- generated evidence and standards feedback flow
