// Hook commands that agent runtimes run in the agent's working directory. That directory can be a
// nested package, such as packages/a in a pnpm workspace, whose own node_modules lacks Veritas, and
// npx looks for a package only under the nearest package root. So walk up from the working
// directory to the git root, inclusive, and pass the nearest directory that has Veritas installed
// as --prefix; npx keeps the working directory.
//
// When the walk finds nothing, or the working directory is outside a git repository, run plain
// `npx --no`: --prefix also sets npm's global prefix, so passing one would hide a global install.
// Stopping at the git root keeps a node_modules planted in a parent outside the repository, such
// as a shared /tmp, from being run. `pwd -P` matches the physical path git reports.
// POSIX sh, so it runs the same under sh, dash, bash and zsh. Codex on Windows runs hook commands
// through PowerShell, so the Codex config also carries the plain command as commandWindows.
export function nearestInstalledVeritasCommand(args) {
  return 'VERITAS_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; VERITAS_PREFIX=; '
    + 'if [ -n "$VERITAS_ROOT" ]; then VERITAS_DIR="$(pwd -P)"; while :; do '
    + 'if [ -f "$VERITAS_DIR/node_modules/@kontourai/veritas/package.json" ]; then VERITAS_PREFIX="$VERITAS_DIR"; break; fi; '
    + 'if [ "$VERITAS_DIR" = "$VERITAS_ROOT" ] || [ "$VERITAS_DIR" = / ]; then break; fi; '
    + 'VERITAS_DIR="$(dirname "$VERITAS_DIR")"; done; fi; '
    + `if [ -n "$VERITAS_PREFIX" ]; then npx --no --prefix "$VERITAS_PREFIX" @kontourai/veritas ${args}; `
    + `else npx --no @kontourai/veritas ${args}; fi`;
}

// The same invocation without the walk, for runtimes that do not run hooks through a POSIX shell.
export function plainVeritasCommand(args) {
  return `npx --no @kontourai/veritas ${args}`;
}
