# Agent Runtime Integrations

Veritas is intentionally agent-agnostic. These integration notes show where the framework fits when the runtime changes.

## Claude Code

- keep the tracked repo-local config under `.veritas/`
- use `npm exec -- veritas shadow run --working-tree` as the explicit orchestration command
- use the generated git/runtime hooks when you want post-change automation instead of manual invocation

## Cursor

- keep adapter and policy files in the repo, not in editor-only settings
- point Cursor rules or project instructions at the repo-local Veritas workflow
- prefer `veritas report` for review-only lanes and `veritas shadow run` for proof-plus-eval lanes

## GitHub Copilot Workspace

- treat Veritas as the repo-local contract surface, not as Copilot-specific policy
- run Veritas in CI to keep the evidence path independent from the editor surface
- use the same `.veritas/` artifacts for local and remote execution

## Aider

- keep Veritas commands in repo scripts so Aider sessions can invoke the same surface as every other runtime
- prefer explicit report or shadow-run commands over ad hoc shell snippets
- store adapter and policy changes in normal reviewable commits

## Common Rule

No matter which runtime you use, keep these pieces repo-local and reviewable:

- adapter
- policy pack
- team profile
- generated evidence and eval flow
