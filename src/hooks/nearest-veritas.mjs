// Hook commands that agent runtimes run in the agent's working directory. That directory can be a
// nested package, such as packages/a in a pnpm workspace, whose own node_modules lacks Veritas, and
// npx looks for a package only under the nearest package root. So walk up to the nearest directory
// with Veritas installed and pass it as --prefix: npx keeps the working directory, and when no
// directory has Veritas the walk ends at "/", where `npx --no` refuses instead of fetching.
// POSIX sh, so it runs the same under sh, dash, bash and zsh.
export function nearestInstalledVeritasCommand(args) {
  return 'VERITAS_PREFIX="$(pwd)"; '
    + 'until [ -f "$VERITAS_PREFIX/node_modules/@kontourai/veritas/package.json" ] || [ "$VERITAS_PREFIX" = / ]; '
    + 'do VERITAS_PREFIX="$(dirname "$VERITAS_PREFIX")"; done; '
    + `npx --no --prefix "$VERITAS_PREFIX" @kontourai/veritas ${args}`;
}
