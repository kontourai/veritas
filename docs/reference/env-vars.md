# Environment Variables

Veritas environment variables are intended for automation and emergency escape hatches. Do not leave validation bypasses enabled in CI without an explicit issue and removal plan.

## Validation Escape Hatches

### `VERITAS_SKIP_SURFACE_VALIDATION=1`

Skips Surface `TrustBundle` validation when Veritas emits `trust.bundle`.

This is intended as a short-lived escape hatch while repairing a broken example or projection. Veritas prints a warning on every invocation when this variable is set.

### `VERITAS_SKIP_STANDARDS_FEEDBACK_VALIDATION=1`

Skips standards-feedback-draft schema validation for session log observation.

This is intended as a short-lived escape hatch while repairing an standards feedback observer or schema mismatch. Veritas prints a warning on every invocation when this variable is set.

## Strictness Opt-Ins

### `VERITAS_STRICT_CONFIG=1`

Turns a Repo Map or Repo Standards file that fails validation against its published schema into a **hard load failure** instead of the default warning.

Veritas validates both artifacts on every load. It warns rather than throws by default because those loaders sit on the Claude Code PreToolUse gate's path, where a throw would block every edit in the repo until the config was repaired — and the natural response to that is `VERITAS_HOOK_SKIP=1`, i.e. a schema nit would train operators to disable the enforcement gate.

Set this once your config validates cleanly, to keep it that way. `veritas readiness --check config` is the equivalent check as a discrete, exit-coded command. A future major version makes strict the default.

## Hook Requirement

### `VERITAS_SESSION_LOG_PATH`

Provides the Veritas-owned session log path used by generated runtime hooks before they call `veritas feedback observe --session-log`.

Runtime-specific variables such as `CODEX_TRANSCRIPT_PATH` and `CLAUDE_TRANSCRIPT_PATH` may be read by generated hooks because those names are owned by the host runtime. Hooks normalize them into `VERITAS_SESSION_LOG_PATH` before invoking Veritas.

### `VERITAS_HOOK_SKIP=1`

Tells generated Veritas hooks to exit without running. Use for local emergency bypasses, not as a normal CI configuration.

The generated git and runtime hooks honour this in their shell body and leave no record. The Claude Code PreToolUse gate is different: it is the only Veritas mechanism that can block an edit, so it resolves the skip inside Veritas and appends a `hook-skip` record to `.kontourai/veritas/standards-feedback/exceptions.jsonl` before approving. That puts it on the same auditable footing as a `VERITAS_EXCEPTION_RULE` bypass.

### `VERITAS_HOOK_SKIP_REASON`

Optional free-text reason recorded on the `hook-skip` record written by the Claude Code PreToolUse gate. Ignored by the other generated hooks.

### `VERITAS_ACTOR`

Provides the governance actor for `veritas boundaries check` when `--actor` is not supplied.
