// Hook commands that agent runtimes run in the agent's working directory. That directory can be a
// nested package, such as packages/a in a pnpm workspace, whose own node_modules lacks Veritas, and
// npx looks for a package only under the nearest package root. So walk up the physical path from the
// working directory and, if the walk reaches the git root, run the entry point of the nearest
// install on the way directly with node.
//
// The found install runs by path, not through npx. npx --prefix decides only whether npx treats the
// package as installed; the binary npx then runs is the first `veritas` on a PATH it builds from the
// working directory's ancestors and the user's PATH. An install without a node_modules/.bin link
// (bin-links=false, --no-bin-links) would let a parent's .bin/veritas or a global `veritas`, such as
// the unrelated unscoped package, run instead of the install the walk found. An install counts only
// when the file this command runs exists, so the file checked is the file run. The path
// bin/veritas.mjs is the package's `bin.veritas` and has not changed in any release.
//
// The git root is matched by identity (`-ef`), not by string: on a case-insensitive filesystem the
// typed case of the working directory and git's canonical case differ. An install counts only if
// the walk reaches the root, so a node_modules planted in a parent outside the repository is never
// run, including when GIT_DIR or GIT_WORK_TREE name a root that is not an ancestor, and outside
// a git repository, where there is no root to reach.
//
// Otherwise the command runs plain `npx --no`, which also finds a global install. Plain npx keeps
// npm's own lookup, which in a repository with no package.json searches upward past the git root for
// the nearest package.json or node_modules. That limit is npm's, and this walk does not widen it.
//
// The walk always ends. It stops unless the directory is absolute: a deleted working directory
// makes `pwd -P` print nothing, and a relative string would not shorten below. Each step drops the
// last path component with parameter expansion, so an absolute string gets strictly shorter until
// it is "/" (an empty result means "/"). Unlike dirname, that forks nothing per level and cannot
// fail on a path longer than the platform's limit.
//
// POSIX sh with `test -ef`, which dash, bash, zsh and busybox support. The Windows
// command uses the separate physical-path launcher in windows-veritas.mjs.
export const INSTALLED_VERITAS_ENTRY = 'node_modules/@kontourai/veritas/bin/veritas.mjs';

export function nearestInstalledVeritasCommand(args, { allowDiscoveryFailure = false } = {}) {
  const tolerate = allowDiscoveryFailure ? ' || :' : '';
  return `VERITAS_ROOT="$(git rev-parse --show-toplevel 2>/dev/null${tolerate})"; VERITAS_BIN=; VERITAS_FOUND=; `
    + `VERITAS_DIR="$(pwd -P 2>/dev/null${tolerate})"; while :; do `
    + 'case "$VERITAS_DIR" in /*) ;; *) break;; esac; '
    + `if [ -z "$VERITAS_FOUND" ] && [ -f "$VERITAS_DIR/${INSTALLED_VERITAS_ENTRY}" ]; then VERITAS_FOUND="$VERITAS_DIR/${INSTALLED_VERITAS_ENTRY}"; fi; `
    + 'if [ -n "$VERITAS_ROOT" ] && [ "$VERITAS_DIR" -ef "$VERITAS_ROOT" ]; then VERITAS_BIN="$VERITAS_FOUND"; break; fi; '
    + 'if [ "$VERITAS_DIR" = / ]; then break; fi; '
    + 'VERITAS_DIR="${VERITAS_DIR%/*}"; [ -n "$VERITAS_DIR" ] || VERITAS_DIR=/; done; '
    + `if [ -n "$VERITAS_BIN" ]; then node "$VERITAS_BIN" ${args}; `
    + `else npx --no @kontourai/veritas ${args}; fi`;
}

