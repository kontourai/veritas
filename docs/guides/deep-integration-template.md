# Deep Integration

The generic Veritas contract stays a shell command: run `veritas run`, read the feedback, fix the issue, and rerun. A deep integration adds runtime hooks and transcript capture around that same contract.

Deep means:

- repo instruction files carry the Veritas governance block,
- a stop or post-action hook runs `veritas run`,
- optional just-in-time hooks can block deny-enforced rules before edits,
- a transcript observer can draft eval data without inventing human judgment.

## Integration Contract

Each deep integration has two pieces:

- `TranscriptReader`: `{ name, canRead(transcriptPath), readEvents(transcriptPath) }`, returning normalized events with `kind`, `timestamp`, `files`, `commandText`, `exitCode`, and `raw`.
- `RuntimeAdapter`: `{ name, installPreToolUseHook(opts), installStopHook(opts), installPostSessionHook(opts), uninstall(), status() }`.

`veritas eval observe --tool <tool> --transcript <path>` chooses a transcript reader from the registry, or auto-detects by transcript shape. New runtimes should implement this contract instead of adding tool-specific logic to the eval command.

## Worked Example: Codex

Codex is the reference deep integration because it can run a stop hook and an end-of-session hook without product-specific code in Surface.

The generated Codex hook config now wires:

- `Stop`: runs `.veritas/hooks/agent-runtime.sh`, which keeps the existing shadow-run feedback loop.
- `PostSession`: runs `veritas eval observe --transcript "$CODEX_TRANSCRIPT_PATH"` when the transcript path is available.
- Fallback: when only `CODEX_SESSION_ID` is present, the hook reads `$HOME/.codex/sessions/$CODEX_SESSION_ID.json`.

`veritas eval observe` defensively reads transcript events and fills an eval draft under `.veritas/eval-drafts/`:

- `time_to_green_minutes`: first failing `veritas run` to first later passing veritas run.
- `accepted_without_major_rewrite`: based on post-Veritas churn against files Veritas reported on.
- `override_count`: `VERITAS_*` bypasses and `--skip-proof` after the run.

Unknown fields are reported as missing instead of being guessed.

## Other Agents

Claude Code now has a full runtime adapter and transcript reader:

- `veritas integrations claude-code install` installs PreToolUse, Stop, and PostSession hooks.
- `veritas eval observe --tool claude-code --transcript <path>` reads Claude Code JSONL transcripts from the `~/.claude/projects/<project>/<session>.jsonl` format.
- PreToolUse returns hook protocol JSON and blocks deny-enforced rules before edits.

Cursor and Copilot are supported through generic governance-block plus stop-hook wiring. Their `transcriptReader` is explicitly `null` until those products expose a durable transcript shape Veritas can read.

Copilot and generic agents can integrate deeply through any durable command log that includes timestamps, tool calls, file paths, and command outcomes, but Veritas does not ship those readers today.

Surface is not involved in agent-runtime depth. Veritas owns these integrations because they are repo and agent workflow behavior built on top of Surface's trust primitives.
