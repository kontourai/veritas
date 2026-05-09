# Deep Integration Template

The generic Veritas contract stays a shell command: run `veritas shadow run`, read the feedback, fix the issue, and rerun. A deeper agent integration adds transcript capture around that same contract.

## Reference Depth: Codex

Codex is the reference deep integration because it can run a stop hook and an end-of-session hook without product-specific code in Surface.

The generated Codex hook config now wires:

- `Stop`: runs `.veritas/hooks/agent-runtime.sh`, which keeps the existing shadow-run feedback loop.
- `PostSession`: runs `veritas eval observe --transcript "$CODEX_TRANSCRIPT_PATH"` when the transcript path is available.
- Fallback: when only `CODEX_SESSION_ID` is present, the hook reads `$HOME/.codex/sessions/$CODEX_SESSION_ID.json`.

`veritas eval observe` defensively reads transcript events and fills an eval draft under `.veritas/eval-drafts/`:

- `time_to_green_minutes`: first failing `veritas shadow run` to first later passing shadow run.
- `accepted_without_major_rewrite`: based on post-Veritas churn against files Veritas reported on.
- `override_count`: `VERITAS_*` bypasses and `--skip-proof` after the run.

Unknown fields stay unset instead of being guessed.

## Porting The Pattern

For another agent runtime, keep the shell feedback command unchanged and add the same three pieces:

1. A stop or post-action hook that runs `veritas shadow run`.
2. A session transcript reader that can identify tool commands, timestamps, touched files, and exit status.
3. An eval observer that writes a draft, leaving human judgment fields for final review.

Claude Code can follow the same shape with its existing Stop and PreToolUse hooks plus a transcript reader once a stable session path is available.

Cursor should stay on the shallow Stop hook until it exposes durable session transcripts.

Copilot and generic agents can integrate deeply through any durable command log that includes timestamps, tool calls, file paths, and command outcomes.

Surface is not involved in agent-runtime depth. Veritas owns these integrations because they are repo and agent workflow behavior built on top of Surface's trust primitives.
