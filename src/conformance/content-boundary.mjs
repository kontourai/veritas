import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

export const FLOW_AGENTS_RUNTIME_PREFIX = ".kontourai/flow-agents/";
export const TRACKED_RUNTIME_ARTIFACT_LABEL =
  "Flow Agents runtime artifact must not be tracked in this repo";

const INVALID_PATH_LABEL = "Path is not valid UTF-8 and cannot be safely scanned";
const UNREADABLE_PATH_LABEL = "Enumerated path cannot be read and cannot be safely scanned";
const OUTSIDE_ROOT_LABEL = "Path target escapes the repository root and was not scanned";

const DEFAULT_IGNORED_PATH_PATTERNS = [
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^\.git\//,
  /^\.astro\//,
  /^test-results\//,
  /^\.omx\//,
];

function asBuffer(output) {
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function parseNulPaths(output) {
  const bytes = asBuffer(output);
  const paths = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index > start) paths.push(Buffer.from(bytes.subarray(start, index)));
    start = index + 1;
  }
  if (start < bytes.length) paths.push(Buffer.from(bytes.subarray(start)));
  return paths;
}

function isSafeRepositoryPath(rawPath) {
  if (rawPath.length === 0 || rawPath[0] === 0x2f) return false;
  return !rawPath.toString("latin1").split("/").some(
    (segment) => segment === ".." || segment === "",
  );
}

function decodePath(rawPath) {
  const decoded = rawPath.toString("utf8");
  return Buffer.from(decoded, "utf8").equals(rawPath) ? decoded : null;
}

function escapePathBytes(rawPath) {
  let rendered = "";
  for (const byte of rawPath) {
    if (byte >= 0x20 && byte <= 0x7e && byte !== 0x5c) {
      rendered += String.fromCharCode(byte);
    } else if (byte === 0x5c) {
      rendered += "\\\\";
    } else {
      rendered += `\\x${byte.toString(16).padStart(2, "0")}`;
    }
  }
  return rendered;
}

function rawPathForEntry(entry) {
  return Buffer.isBuffer(entry.rawPath)
    ? entry.rawPath
    : Buffer.from(entry.filePath, "utf8");
}

function repositoryFilePath(rootDir, rawPath) {
  return Buffer.concat([
    Buffer.from(path.resolve(rootDir)),
    Buffer.from(path.sep),
    rawPath,
  ]);
}

function isCanonicalDescendant(root, target) {
  return target.equals(root) || (
    target.length > root.length &&
    target.subarray(0, root.length).equals(root) &&
    target[root.length] === path.sep.charCodeAt(0)
  );
}

function componentPaths(canonicalRoot, canonicalTarget) {
  const paths = [canonicalRoot];
  const suffix = canonicalTarget.subarray(canonicalRoot.length + 1);
  let current = canonicalRoot;
  let start = 0;
  for (let index = 0; index <= suffix.length; index += 1) {
    if (index < suffix.length && suffix[index] !== path.sep.charCodeAt(0)) continue;
    current = Buffer.concat([
      current,
      Buffer.from(path.sep),
      suffix.subarray(start, index),
    ]);
    paths.push(current);
    start = index + 1;
  }
  return paths;
}

function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    type: stat.mode & fsConstants.S_IFMT,
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.type === right.type;
}

function snapshotComponents(paths, lstat) {
  return paths.map((component) => {
    const stat = lstat(component);
    if (stat.isSymbolicLink()) throw new Error("symbolic path component");
    return statIdentity(stat);
  });
}

function readValidatedTarget(canonicalRoot, canonicalTarget, fileSystem) {
  const paths = componentPaths(canonicalRoot, canonicalTarget);
  const before = snapshotComponents(paths, fileSystem.lstat);
  let descriptor;
  try {
    descriptor = fileSystem.open(
      canonicalTarget,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const opened = statIdentity(fileSystem.fstat(descriptor));
    const after = snapshotComponents(paths, fileSystem.lstat);
    if (
      before.some((identity, index) => !sameIdentity(identity, after[index])) ||
      !sameIdentity(after.at(-1), opened)
    ) {
      throw new Error("path identity changed during open");
    }
    return fileSystem.read(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) fileSystem.close(descriptor);
  }
}

/** Enumerate Git-managed and untracked/non-ignored paths, retaining provenance. */
export function enumerateContentBoundaryFiles({
  rootDir,
  execFile = execFileSync,
} = {}) {
  if (!rootDir) throw new TypeError("rootDir is required");

  const options = { cwd: rootDir };
  const tracked = parseNulPaths(execFile("git", ["ls-files", "-z"], options));
  const untracked = parseNulPaths(
    execFile("git", ["ls-files", "-z", "--others", "--exclude-standard"], options),
  );

  const provenanceByPath = new Map();
  for (const rawPath of tracked) {
    if (isSafeRepositoryPath(rawPath)) {
      provenanceByPath.set(rawPath.toString("hex"), {
        rawPath,
        provenance: "tracked",
      });
    }
  }
  for (const rawPath of untracked) {
    const key = rawPath.toString("hex");
    if (isSafeRepositoryPath(rawPath) && !provenanceByPath.has(key)) {
      provenanceByPath.set(key, { rawPath, provenance: "untracked" });
    }
  }

  return [...provenanceByPath.values()]
    .sort((left, right) => Buffer.compare(left.rawPath, right.rawPath))
    .map(({ rawPath, provenance }) => ({
      rawPath,
      filePath: decodePath(rawPath) ?? escapePathBytes(rawPath),
      provenance,
    }));
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
  realpath = realpathSync,
  fileSystem = {},
} = {}) {
  if (!rootDir) throw new TypeError("rootDir is required");
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array");

  const ignored = [...ignoredPaths, ...ignoredPathPatterns];
  const findings = [];
  const seen = new Set();
  const operations = {
    realpath: fileSystem.realpath ?? realpath,
    lstat: fileSystem.lstat ?? lstatSync,
    open: fileSystem.open ?? openSync,
    fstat: fileSystem.fstat ?? fstatSync,
    read: fileSystem.read ?? readFileSync,
    close: fileSystem.close ?? closeSync,
  };
  const canonicalRoot = asBuffer(operations.realpath(rootDir, { encoding: "buffer" }));
  const stableEntries = [...entries].sort((left, right) =>
    Buffer.compare(rawPathForEntry(left), rawPathForEntry(right)),
  );

  for (const entry of stableEntries) {
    const { provenance } = entry;
    const rawPath = rawPathForEntry(entry);
    const key = rawPath.toString("hex");
    if (seen.has(key) || !isSafeRepositoryPath(rawPath)) continue;
    seen.add(key);

    const decodedPath = decodePath(rawPath);
    const filePath = decodedPath ?? escapePathBytes(rawPath);
    if (decodedPath?.startsWith(FLOW_AGENTS_RUNTIME_PREFIX)) {
      if (provenance === "tracked") {
        findings.push({
          filePath: decodedPath,
          line: 1,
          label: TRACKED_RUNTIME_ARTIFACT_LABEL,
        });
      }
      continue;
    }

    if (
      decodedPath &&
      ignored.some((pattern) => matchesPathPattern(pattern, decodedPath))
    ) continue;
    if (!decodedPath) {
      findings.push({ filePath, line: 1, label: INVALID_PATH_LABEL });
      continue;
    }

    const candidate = repositoryFilePath(rootDir, rawPath);
    let canonicalTarget;
    try {
      canonicalTarget = asBuffer(operations.realpath(candidate, { encoding: "buffer" }));
    } catch {
      findings.push({ filePath, line: 1, label: UNREADABLE_PATH_LABEL });
      continue;
    }
    if (!isCanonicalDescendant(canonicalRoot, canonicalTarget)) {
      findings.push({ filePath, line: 1, label: OUTSIDE_ROOT_LABEL });
      continue;
    }

    let content;
    try {
      content = readValidatedTarget(
        canonicalRoot,
        canonicalTarget,
        operations,
      );
    } catch {
      findings.push({ filePath, line: 1, label: UNREADABLE_PATH_LABEL });
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

  return findings.sort((left, right) =>
    Buffer.compare(Buffer.from(left.filePath), Buffer.from(right.filePath)) ||
    left.line - right.line ||
    left.label.localeCompare(right.label),
  );
}

export function formatContentBoundaryResult(findings) {
  if (findings.length === 0) return "Content boundary check passed.";
  return [
    "Content boundary check failed:",
    ...findings.map(
      ({ filePath, line, label }) =>
        `- ${JSON.stringify(filePath)}:${line} ${JSON.stringify(label)}`,
    ),
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
