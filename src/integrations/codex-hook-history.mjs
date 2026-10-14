// Exact commands earlier Veritas releases merged into an external Codex hooks file (--codex-home or
// --target-hooks-file), by event. The merge matches handlers by exact command, so without this
// record a reinstall would keep these beside the current commands and both would run. Measured by
// running every tagged release's own applyCodexHook against a hooks file: apart from the unchanged
// Stop command, these two strings are the only ones any release merged there. This is a record of
// past output for matching only; nothing here is written, printed or run.
export const PREVIOUS_CODEX_HOOK_COMMANDS = Object.freeze({
  // Released in v1.7.0 through v1.11.0. Introduced by f764443 (Codex pre-edit guidance hook).
  PreToolUse: Object.freeze([
    'npm exec -- veritas hooks codex pre-tool-use',
  ]),
  // Released in v0.5.0 through v1.11.0. Introduced by 572635e (#22).
  PostSession: Object.freeze([
    'VERITAS_SESSION_LOG_PATH="${VERITAS_SESSION_LOG_PATH:-${CODEX_TRANSCRIPT_PATH:-}}"; if [ -z "$VERITAS_SESSION_LOG_PATH" ] && [ -n "$CODEX_SESSION_ID" ]; then VERITAS_SESSION_LOG_PATH="$HOME/.codex/sessions/$CODEX_SESSION_ID.json"; fi; if [ -n "$VERITAS_SESSION_LOG_PATH" ]; then npm exec -- veritas feedback observe --session-log "$VERITAS_SESSION_LOG_PATH"; fi',
  ]),
});
