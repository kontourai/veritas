// Hook commands that agent runtimes run in the agent's working directory. That directory can be a
// nested package, such as packages/a in a pnpm workspace, whose own node_modules lacks Veritas, and
// npx looks for a package only under the nearest package root. So walk up the physical path from the
// working directory and, if the walk reaches the git root, pass the nearest directory on the way
// that has Veritas installed as --prefix; npx keeps the working directory.
//
// The git root is matched by identity (`-ef`), not by string: on a case-insensitive filesystem the
// typed case of the working directory and git's canonical case differ. An install counts only if
// the walk reaches the root, so a node_modules planted in a parent outside the repository is never
// passed, including when GIT_DIR or GIT_WORK_TREE name a root that is not an ancestor, and outside
// a git repository, where there is no root to reach.
//
// Otherwise the command runs plain `npx --no`: --prefix also sets npm's global prefix, so passing
// one would hide a global install. Plain npx keeps npm's own lookup, which in a repository with no
// package.json searches upward past the git root for the nearest package.json or node_modules. That
// limit is npm's, and this walk does not widen it.
//
// POSIX sh with `test -ef`, which dash, bash, zsh and busybox support. Codex on Windows runs hook
// commands through PowerShell, so the Codex config also carries the plain command as commandWindows.
export function nearestInstalledVeritasCommand(args) {
  return 'VERITAS_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; VERITAS_PREFIX=; VERITAS_FOUND=; '
    + 'VERITAS_DIR="$(pwd -P)"; while :; do '
    + 'if [ -z "$VERITAS_FOUND" ] && [ -f "$VERITAS_DIR/node_modules/@kontourai/veritas/package.json" ]; then VERITAS_FOUND="$VERITAS_DIR"; fi; '
    + 'if [ -n "$VERITAS_ROOT" ] && [ "$VERITAS_DIR" -ef "$VERITAS_ROOT" ]; then VERITAS_PREFIX="$VERITAS_FOUND"; break; fi; '
    + 'if [ "$VERITAS_DIR" = / ]; then break; fi; '
    + 'VERITAS_DIR="$(dirname "$VERITAS_DIR")"; done; '
    + `if [ -n "$VERITAS_PREFIX" ]; then npx --no --prefix "$VERITAS_PREFIX" @kontourai/veritas ${args}; `
    + `else npx --no @kontourai/veritas ${args}; fi`;
}

// The same invocation without the walk, for runtimes that do not run hooks through a POSIX shell.
export function plainVeritasCommand(args) {
  return `npx --no @kontourai/veritas ${args}`;
}
