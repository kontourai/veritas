// Exact commands earlier Veritas releases merged into an external Codex hooks file (--codex-home or
// --target-hooks-file), by event. The merge matches handlers by exact command, so without this
// record a reinstall would keep these beside the current commands and both would run. Measured by
// running every tagged release's own applyCodexHook against a hooks file: apart from the unchanged
// Stop command, these are the only strings any release merged there, except the v0.4.0 entry noted
// below. This is a record of past output for matching only; nothing here is written, printed or run.
export const PREVIOUS_CODEX_HOOK_COMMANDS = Object.freeze({
  PreToolUse: Object.freeze([
    // Released in v1.7.0 through v1.11.0. Introduced by f764443 (Codex pre-edit guidance hook).
    'npm exec -- veritas hooks codex pre-tool-use',
    // Released in v1.11.1 and v1.11.2. Introduced by b4516d1 (#283): the walk passed the install it
    // found to npx --prefix, and npx could then run another veritas on PATH (#286).
    'VERITAS_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; VERITAS_PREFIX=; VERITAS_FOUND=; VERITAS_DIR="$(pwd -P 2>/dev/null)"; while :; do case "$VERITAS_DIR" in /*) ;; *) break;; esac; if [ -z "$VERITAS_FOUND" ] && [ -f "$VERITAS_DIR/node_modules/@kontourai/veritas/package.json" ]; then VERITAS_FOUND="$VERITAS_DIR"; fi; if [ -n "$VERITAS_ROOT" ] && [ "$VERITAS_DIR" -ef "$VERITAS_ROOT" ]; then VERITAS_PREFIX="$VERITAS_FOUND"; break; fi; if [ "$VERITAS_DIR" = / ]; then break; fi; VERITAS_DIR="${VERITAS_DIR%/*}"; [ -n "$VERITAS_DIR" ] || VERITAS_DIR=/; done; if [ -n "$VERITAS_PREFIX" ]; then npx --no --prefix "$VERITAS_PREFIX" @kontourai/veritas hooks codex pre-tool-use; else npx --no @kontourai/veritas hooks codex pre-tool-use; fi',
  ]),
  PostSession: Object.freeze([
    // Written by v0.4.0 to .veritas/runtime/codex-hooks.json only; its applyCodexHook merged only Stop
    // into the hooks file. Recorded for a hooks file that copied the handler from that artifact.
    'if [ -n "$CODEX_TRANSCRIPT_PATH" ]; then npm exec -- veritas eval observe --transcript "$CODEX_TRANSCRIPT_PATH"; elif [ -n "$CODEX_SESSION_ID" ]; then npm exec -- veritas eval observe --transcript "$HOME/.codex/sessions/$CODEX_SESSION_ID.json"; fi',
    // Released in v0.5.0 through v1.11.0. Introduced by 572635e (#22).
    'VERITAS_SESSION_LOG_PATH="${VERITAS_SESSION_LOG_PATH:-${CODEX_TRANSCRIPT_PATH:-}}"; if [ -z "$VERITAS_SESSION_LOG_PATH" ] && [ -n "$CODEX_SESSION_ID" ]; then VERITAS_SESSION_LOG_PATH="$HOME/.codex/sessions/$CODEX_SESSION_ID.json"; fi; if [ -n "$VERITAS_SESSION_LOG_PATH" ]; then npm exec -- veritas feedback observe --session-log "$VERITAS_SESSION_LOG_PATH"; fi',
    // Released in v1.11.1 and v1.11.2. Introduced by b4516d1 (#283), as for PreToolUse above.
    'VERITAS_SESSION_LOG_PATH="${VERITAS_SESSION_LOG_PATH:-${CODEX_TRANSCRIPT_PATH:-}}"; if [ -z "$VERITAS_SESSION_LOG_PATH" ] && [ -n "$CODEX_SESSION_ID" ]; then VERITAS_SESSION_LOG_PATH="$HOME/.codex/sessions/$CODEX_SESSION_ID.json"; fi; if [ -n "$VERITAS_SESSION_LOG_PATH" ]; then VERITAS_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; VERITAS_PREFIX=; VERITAS_FOUND=; VERITAS_DIR="$(pwd -P 2>/dev/null)"; while :; do case "$VERITAS_DIR" in /*) ;; *) break;; esac; if [ -z "$VERITAS_FOUND" ] && [ -f "$VERITAS_DIR/node_modules/@kontourai/veritas/package.json" ]; then VERITAS_FOUND="$VERITAS_DIR"; fi; if [ -n "$VERITAS_ROOT" ] && [ "$VERITAS_DIR" -ef "$VERITAS_ROOT" ]; then VERITAS_PREFIX="$VERITAS_FOUND"; break; fi; if [ "$VERITAS_DIR" = / ]; then break; fi; VERITAS_DIR="${VERITAS_DIR%/*}"; [ -n "$VERITAS_DIR" ] || VERITAS_DIR=/; done; if [ -n "$VERITAS_PREFIX" ]; then npx --no --prefix "$VERITAS_PREFIX" @kontourai/veritas feedback observe --session-log "$VERITAS_SESSION_LOG_PATH"; else npx --no @kontourai/veritas feedback observe --session-log "$VERITAS_SESSION_LOG_PATH"; fi; fi',
  ]),
});
