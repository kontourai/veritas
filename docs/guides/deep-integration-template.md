# Deep Integration

The generic Veritas contract stays a shell command: run `veritas shadow run`, read the feedback, fix the issue, and rerun. A deep integration adds runtime hooks and transcript capture around that same contract.

Deep means:

- repo instruction files carry the Veritas governance block,
- a stop or post-action hook runs `veritas shadow run`,
- optional just-in-time hooks run `veritas explain` before edits,
- a transcript observer can draft eval data without inventing human judgment.

## Worked Example: Codex

Codex is the reference deep integration because it can run a stop hook and an end-of-session hook without product-specific code in Surface.

The generated Codex hook config now wires:

- `Stop`: runs `.veritas/hooks/agent-runtime.sh`, which keeps the existing shadow-run feedback loop.
- `PostSession`: runs `veritas eval observe --transcript "$CODEX_TRANSCRIPT_PATH"` when the transcript path is available.
- Fallback: when only `CODEX_SESSION_ID` is present, the hook reads `$HOME/.codex/sessions/$CODEX_SESSION_ID.json`.

`veritas eval observe` defensively reads transcript events and fills an eval draft under `.veritas/eval-drafts/`:

- `time_to_green_minutes`: first failing `veritas shadow run` to first later passing shadow run.
- `accepted_without_major_rewrite`: based on post-Veritas churn against files Veritas reported on.
- `override_count`: `VERITAS_*` bypasses and `--skip-proof` after the run.

Unknown fields are reported as missing instead of being guessed.

## Other Agents

Claude Code and Cursor are supported today through the generic governance-block and stop-hook contract. Claude Code also has a PreToolUse hook for just-in-time `veritas explain` context. Deep transcript capture for Claude Code and Cursor is not implemented yet.

Copilot and generic agents can integrate deeply through any durable command log that includes timestamps, tool calls, file paths, and command outcomes, but Veritas does not ship those readers today.

Surface is not involved in agent-runtime depth. Veritas owns these integrations because they are repo and agent workflow behavior built on top of Surface's trust primitives.
