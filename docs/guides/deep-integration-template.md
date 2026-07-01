# Deep Integration

The generic Veritas contract stays a shell command: run `veritas readiness`, read the feedback, fix the issue, and rerun. A deep integration adds runtime hooks and session log capture around that same contract.

Deep means:

- repo instruction files carry the Veritas governance block,
- a stop or post-action hook runs `veritas readiness`,
- optional just-in-time hooks can block deny-enforced rules before edits,
- a session log observer can draft standards-feedback data without inventing human judgment.

## Integration Contract

Each deep integration has two pieces:

- `SessionLogReader`: `{ name, canRead(sessionLogPath), readEvents(sessionLogPath) }`, returning normalized events with `kind`, `timestamp`, `files`, `commandText`, `exitCode`, and `raw`.
- `RuntimeIntegration`: `{ name, installPreToolUseHook(opts), installStopHook(opts), installPostSessionHook(opts), uninstall(), status() }`. Public uninstall responses must report their capability state; current integrations return `removed: false` and `capabilityState: "manual"` because automated removal is not implemented.

`veritas feedback observe --tool <tool> --session-log <path>` chooses a session log reader from the registry, or auto-detects by session log shape. New runtimes should implement this contract instead of adding tool-specific logic to the feedback command.

## Worked Example: Codex

Codex is the reference deep integration because it can run a stop hook and an end-of-session hook without product-specific code in Surface.

The generated Codex hook config now wires:

- `Stop`: runs `.veritas/hooks/agent-runtime.sh`, which keeps the existing readiness-check feedback loop.
- `PostSession`: normalizes runtime-specific session-log inputs into `VERITAS_SESSION_LOG_PATH`, then runs `veritas feedback observe --session-log "$VERITAS_SESSION_LOG_PATH"` when a session log path is available.
- Fallback: when only `CODEX_SESSION_ID` is present, the hook reads `$HOME/.codex/sessions/$CODEX_SESSION_ID.json`.

`veritas feedback observe` defensively reads session log events and fills a standards-feedback draft under `.kontourai/veritas/standards-feedback-drafts/`:

- `time_to_green_minutes`: first failing `veritas readiness` to first later passing veritas readiness.
- `accepted_without_major_rewrite`: based on post-Veritas churn against files Veritas reported on.
- `exception_count`: explicit exception env vars, hook skips, and `--skip-evidence-check` after the run.

Unknown fields are reported as missing instead of being guessed.

## Other Agents

Claude Code now has a full runtime integration and session log reader:

- `veritas integrations claude-code install` installs PreToolUse, Stop, and PostSession hooks.
- `veritas feedback observe --tool claude-code --session-log <path>` reads Claude Code JSONL session logs from the `~/.claude/projects/<project>/<session>.jsonl` format.
- PreToolUse returns hook protocol JSON and blocks deny-enforced rules before edits.

Cursor and Copilot are supported through generic governance-block plus stop-hook wiring. Their `sessionLogReader` is explicitly `null` until those products expose a durable session log shape Veritas can read.

Copilot and generic agents can integrate deeply through any durable command log that includes timestamps, tool calls, file paths, and command outcomes, but Veritas does not ship those readers today.

`veritas integrations <tool> uninstall` is non-destructive for Codex, Claude Code, Cursor, and Copilot. It reports manual uninstall state instead of removing generated hooks or tool configuration.

Surface is not involved in agent-runtime depth. Veritas owns these integrations because they are repo and agent workflow behavior built on top of Surface's trust primitives.
