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

Makes legacy Repo Map and legacy Repo Standards schema violations hard load failures instead of warnings. Resource-shaped Repo Standards already validate strictly, and `plan` explicitly requests strict loading for both configurations.

`veritas readiness --check config` validates configuration as a discrete command and exits nonzero for invalid input. Use that check when you need a configuration gate independent of loader defaults.

## Hook Requirement

### `VERITAS_SESSION_LOG_PATH`

Overrides the session log the Claude Code SessionEnd capture reads. Veritas's `hooks claude-code session-end` subcommand otherwise reads the path Claude Code passes as `transcript_path` in the hook input on stdin. The hook looks upward from the working directory to the git root for the nearest directory with Veritas installed and runs that install's `bin/veritas.mjs` with `node`, so a nested package without its own install reaches the root one and no other `veritas` on `PATH` runs instead. With no install found, it runs `npx --no @kontourai/veritas`.

Earlier releases read `CLAUDE_TRANSCRIPT_PATH`, `CODEX_TRANSCRIPT_PATH` and `CODEX_SESSION_ID`. Neither runtime documents those variables; both pass the session log path on stdin, so the generated hooks no longer read them.

### `VERITAS_HOOK_SKIP=1`

Tells generated Veritas hooks to exit without running. Use for local emergency bypasses, not as a normal CI configuration.

The generated git and runtime hooks honour this in their shell body and leave no record. The Claude Code and Codex PreToolUse gates can block edits and resolve the skip inside Veritas and appends a `hook-skip` record to `.kontourai/veritas/standards-feedback/exceptions.jsonl` before approving. That puts it on the same auditable footing as a `VERITAS_EXCEPTION_RULE` bypass.

### `VERITAS_HOOK_SKIP_REASON`

Optional free-text reason recorded on the `hook-skip` record written by the Claude Code PreToolUse gate. Ignored by the other generated hooks.

### `VERITAS_ACTOR`

Provides the governance actor for `veritas readiness` when `--actor` is not supplied or is empty. A readiness run resolves one actor and uses it for `work-area-boundary` requirements (including `--check boundaries`), for the readiness-verdict authority trace in the trust bundle (unless a current attestation names the actor), and for run history. `--actor` takes precedence.
