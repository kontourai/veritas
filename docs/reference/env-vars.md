# Environment Variables

Veritas environment variables are intended for automation and emergency escape hatches. Do not leave validation bypasses enabled in CI without an explicit issue and removal plan.

## Validation Escape Hatches

### `VERITAS_SKIP_SURFACE_VALIDATION=1`

Skips Surface `TrustInput` validation when Veritas emits `surface.input`.

This is intended as a short-lived escape hatch while repairing a broken fixture or projection. Veritas prints a warning on every invocation when this variable is set.

### `VERITAS_SKIP_EVAL_VALIDATION=1`

Skips eval-draft schema validation for transcript observation.

This is intended as a short-lived escape hatch while repairing an eval observer or schema mismatch. Veritas prints a warning on every invocation when this variable is set.

## Hook Requirement

### `VERITAS_HOOK_SKIP=1`

Tells generated Veritas hooks to exit without running. Use for local emergency bypasses, not as a normal CI configuration.

### `VERITAS_ACTOR`

Provides the governance actor for `veritas boundaries check` when `--actor` is not supplied.
