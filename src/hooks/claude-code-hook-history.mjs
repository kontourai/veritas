// Exact commands earlier Veritas releases wrote under PostSession in .claude/settings.json. Claude
// Code has no PostSession event and ignores the key with an "Unknown hook event" warning, so these
// never ran. A reinstall removes a handler matching one of them; every other handler is kept. Measured
// by running every tagged release's own buildSuggestedClaudeCodePostSessionHook. This is a record of
// past output for matching only; nothing here is written, printed or run.
export const PREVIOUS_CLAUDE_CODE_POST_SESSION_COMMANDS = Object.freeze([
  // Released in v0.5.0 through v1.11.0.
  'VERITAS_SESSION_LOG_PATH="${VERITAS_SESSION_LOG_PATH:-${CLAUDE_TRANSCRIPT_PATH:-}}"; if [ -n "$VERITAS_SESSION_LOG_PATH" ]; then npm exec -- veritas feedback observe --tool claude-code --session-log "$VERITAS_SESSION_LOG_PATH"; fi',
  // Released in v1.11.1 and v1.11.2.
  'VERITAS_SESSION_LOG_PATH="${VERITAS_SESSION_LOG_PATH:-${CLAUDE_TRANSCRIPT_PATH:-}}"; if [ -n "$VERITAS_SESSION_LOG_PATH" ]; then VERITAS_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; VERITAS_PREFIX=; VERITAS_FOUND=; VERITAS_DIR="$(pwd -P 2>/dev/null)"; while :; do case "$VERITAS_DIR" in /*) ;; *) break;; esac; if [ -z "$VERITAS_FOUND" ] && [ -f "$VERITAS_DIR/node_modules/@kontourai/veritas/package.json" ]; then VERITAS_FOUND="$VERITAS_DIR"; fi; if [ -n "$VERITAS_ROOT" ] && [ "$VERITAS_DIR" -ef "$VERITAS_ROOT" ]; then VERITAS_PREFIX="$VERITAS_FOUND"; break; fi; if [ "$VERITAS_DIR" = / ]; then break; fi; VERITAS_DIR="${VERITAS_DIR%/*}"; [ -n "$VERITAS_DIR" ] || VERITAS_DIR=/; done; if [ -n "$VERITAS_PREFIX" ]; then npx --no --prefix "$VERITAS_PREFIX" @kontourai/veritas feedback observe --tool claude-code --session-log "$VERITAS_SESSION_LOG_PATH"; else npx --no @kontourai/veritas feedback observe --tool claude-code --session-log "$VERITAS_SESSION_LOG_PATH"; fi; fi',
]);
