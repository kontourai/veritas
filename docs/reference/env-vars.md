# Environment Variables

Veritas environment variables are intended for automation and emergency escape hatches. Do not leave validation bypasses enabled in CI without an explicit issue and removal plan.

## Validation Escape Hatches

### `VERITAS_SKIP_SURFACE_VALIDATION=1`

Skips Surface `TrustBundle` validation when Veritas emits `trust.bundle`.

This is intended as a short-lived escape hatch while repairing a broken fixture or projection. Veritas prints a warning on every invocation when this variable is set.

### `VERITAS_SKIP_STANDARDS_FEEDBACK_VALIDATION=1`

Skips standards-feedback-draft schema validation for session log observation.

This is intended as a short-lived escape hatch while repairing an standards feedback observer or schema mismatch. Veritas prints a warning on every invocation when this variable is set.

## Hook Requirement

### `VERITAS_SESSION_LOG_PATH`

Provides the Veritas-owned session log path used by generated runtime hooks before they call `veritas feedback observe --session-log`.

Runtime-specific variables such as `CODEX_TRANSCRIPT_PATH` and `CLAUDE_TRANSCRIPT_PATH` may be read by generated hooks because those names are owned by the host runtime. Hooks normalize them into `VERITAS_SESSION_LOG_PATH` before invoking Veritas.

### `VERITAS_HOOK_SKIP=1`

Tells generated Veritas hooks to exit without running. Use for local emergency bypasses, not as a normal CI configuration.

### `VERITAS_ACTOR`

Provides the governance actor for `veritas boundaries check` when `--actor` is not supplied.
