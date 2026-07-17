#!/usr/bin/env node
/**
 * check-no-flow-agents-dep — engine/surface layer-doctrine ratchet.
 *
 * Doctrine (docs/architecture/engine-surface-seam.md, Invariant 1): the veritas
 * evaluation ENGINE never depends on flow-agents. The kit wraps the engine via CLI/artifacts;
 * the engine must not reach up into the platform. This is the executable enforcement of that
 * invariant (flow-agents#651): declared-but-unenforced until now.
 *
 * FAILS if any tracked src/ file imports `flow-agents` / `@kontourai/flow-agents`, or if
 * package.json declares it as a dependency of any kind. Unlike check-hachure-boundary's
 * migration ratchet, there is NO allowlist: the count is zero today and must stay zero.
 *
 * Not a violation (and not matched — the patterns are import-syntax-scoped): the
 * FLOW_AGENTS_RUNTIME_PREFIX string constant in src/conformance/content-boundary.mjs is a
 * ".kontourai/flow-agents/" path prefix used to DETECT tracked platform runtime artifacts in a
 * governed repo's tree. It is data, not a dependency.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Match import/require/dynamic-import of the flow-agents package (scoped or bare), so a string
// constant like ".kontourai/flow-agents/" can never trip it — only an actual code dependency does.
const PKG = String.raw`@kontourai/flow-agents|flow-agents`;
const IMPORT_PATTERNS = [
  new RegExp(String.raw`from\s+['"](?:${PKG})['"]`),
  new RegExp(String.raw`require(?:\.resolve)?\(\s*['"](?:${PKG})['"]\s*\)`),
  new RegExp(String.raw`import\(\s*['"](?:${PKG})['"]\s*\)`),
];
const SOURCE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;

// Strip comments so an import-SHAPED example inside a doc comment (e.g. `// import x from
// "@kontourai/flow-agents"` or a JSDoc `* import ...` line) is not a false positive. A real
// import statement never starts a line with `//` or `*`, so this only removes prose, never a
// genuine dependency edge. (Line-scoped like check-hachure-boundary — not a full parser; a
// package name inside a string literal remains matchable, which is intentional.)
function codeOnly(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  return line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
}

function trackedSourceFiles() {
  return execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((f) => f && SOURCE_EXT.test(f));
}

const violations = [];

for (const file of trackedSourceFiles()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, index) => {
    if (IMPORT_PATTERNS.some((re) => re.test(codeOnly(line)))) {
      violations.push(`${file}:${index + 1}  imports flow-agents — the engine must not depend on the platform`);
    }
  });
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
  for (const name of ["flow-agents", "@kontourai/flow-agents"]) {
    if (pkg[field] && Object.prototype.hasOwnProperty.call(pkg[field], name)) {
      violations.push(`package.json ${field}.${name} — the engine must not depend on the platform`);
    }
  }
}

if (violations.length) {
  console.error("[check-no-flow-agents-dep] FAILED — the veritas engine must not depend on flow-agents (engine/surface seam, Invariant 1):");
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\nThe kit wraps the engine via CLI/artifacts; the engine never reaches up into the platform.\n" +
      "See docs/architecture/engine-surface-seam.md. If a flow-agents runtime PATH string is being\n" +
      "matched, scope it out — this check only matches import/require of the flow-agents package.",
  );
  process.exitCode = 1;
} else {
  console.log("[check-no-flow-agents-dep] OK — the engine declares and imports zero flow-agents dependency.");
}
