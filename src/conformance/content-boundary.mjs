import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const FLOW_AGENTS_RUNTIME_PREFIX = ".kontourai/flow-agents/";
export const TRACKED_RUNTIME_ARTIFACT_LABEL =
  "Flow Agents runtime artifact must not be tracked in this repo";

const DEFAULT_IGNORED_PATH_PATTERNS = [
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^\.git\//,
  /^\.astro\//,
  /^test-results\//,
  /^\.omx\//,
];

function parseNulPaths(output) {
  return output.split("\0").filter((filePath) => filePath.length > 0);
}

function isSafeRepositoryPath(filePath) {
  if (filePath.length === 0 || path.posix.isAbsolute(filePath)) return false;
  return !filePath.split("/").some((segment) => segment === ".." || segment === "");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Enumerate Git-managed and untracked/non-ignored paths, retaining provenance. */
export function enumerateContentBoundaryFiles({
  rootDir,
  execFile = execFileSync,
} = {}) {
  if (!rootDir) throw new TypeError("rootDir is required");

  const options = { cwd: rootDir, encoding: "utf8" };
  const tracked = parseNulPaths(execFile("git", ["ls-files", "-z"], options));
  const untracked = parseNulPaths(
    execFile("git", ["ls-files", "-z", "--others", "--exclude-standard"], options),
  );

  const provenanceByPath = new Map();
  for (const filePath of tracked) {
    if (isSafeRepositoryPath(filePath)) provenanceByPath.set(filePath, "tracked");
  }
  for (const filePath of untracked) {
    if (isSafeRepositoryPath(filePath) && !provenanceByPath.has(filePath)) {
      provenanceByPath.set(filePath, "untracked");
    }
  }

  return [...provenanceByPath]
    .sort(([left], [right]) => compareText(left, right))
    .map(([filePath, provenance]) => ({ filePath, provenance }));
}

function matchesPathPattern(pattern, filePath) {
  if (typeof pattern === "string") return pattern === filePath;
  if (!(pattern instanceof RegExp)) {
    throw new TypeError("ignoredPathPatterns entries must be strings or RegExp objects");
  }
  const matcher = new RegExp(pattern.source, pattern.flags);
  matcher.lastIndex = 0;
  return matcher.test(filePath);
}

function lineNumberFor(content, index) {
  return content.slice(0, index).split("\n").length;
}

/** Evaluate already-discovered entries without terminating or writing output. */
export function evaluateContentBoundary({
  rootDir,
  entries,
  bannedTerms = [],
  ignoredPaths = [],
  ignoredPathPatterns = DEFAULT_IGNORED_PATH_PATTERNS,
  readFile = readFileSync,
} = {}) {
  if (!rootDir) throw new TypeError("rootDir is required");
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array");

  const ignored = [...ignoredPaths, ...ignoredPathPatterns];
  const findings = [];
  const seen = new Set();

  const stableEntries = [...entries].sort((left, right) =>
    compareText(left.filePath, right.filePath),
  );

  for (const entry of stableEntries) {
    const { filePath, provenance } = entry;
    if (seen.has(filePath) || !isSafeRepositoryPath(filePath)) continue;
    seen.add(filePath);

    if (filePath.startsWith(FLOW_AGENTS_RUNTIME_PREFIX)) {
      if (provenance === "tracked") {
        findings.push({ filePath, line: 1, label: TRACKED_RUNTIME_ARTIFACT_LABEL });
      }
      continue;
    }

    if (ignored.some((pattern) => matchesPathPattern(pattern, filePath))) continue;

    let content;
    try {
      content = readFile(path.resolve(rootDir, ...filePath.split("/")), "utf8");
    } catch {
      // Compatibility: files that cannot be read are not vocabulary-scanned.
      continue;
    }
    if (content.includes("\0")) continue;

    for (const term of bannedTerms) {
      if (!term || typeof term.label !== "string" || !(term.pattern instanceof RegExp)) {
        throw new TypeError("bannedTerms entries require a label and RegExp pattern");
      }
      const matcher = new RegExp(term.pattern.source, term.pattern.flags);
      matcher.lastIndex = 0;
      const match = matcher.exec(content);
      if (match) {
        findings.push({
          filePath,
          line: lineNumberFor(content, match.index),
          label: term.label,
        });
      }
    }
  }

  return findings.sort(
    (left, right) =>
      compareText(left.filePath, right.filePath) ||
      left.line - right.line ||
      compareText(left.label, right.label),
  );
}

export function formatContentBoundaryResult(findings) {
  if (findings.length === 0) return "Content boundary check passed.";
  return [
    "Content boundary check failed:",
    ...findings.map(({ filePath, line, label }) => `- ${filePath}:${line} ${label}`),
  ].join("\n");
}

/** Discover, evaluate, and format a content-boundary result for an adapter. */
export function runContentBoundary(options = {}) {
  const entries = options.entries ?? enumerateContentBoundaryFiles(options);
  const findings = evaluateContentBoundary({ ...options, entries });
  return {
    ok: findings.length === 0,
    findings,
    output: formatContentBoundaryResult(findings),
  };
}
