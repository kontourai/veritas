import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  TRACKED_RUNTIME_ARTIFACT_LABEL,
  enumerateContentBoundaryFiles,
  evaluateContentBoundary,
  formatContentBoundaryResult,
  runContentBoundary,
} from "../src/conformance/content-boundary.mjs";
import * as packageRoot from "../src/index.mjs";

const engineUrl = pathToFileURL(
  path.resolve("src/conformance/content-boundary.mjs"),
).href;

function git(rootDir, args, options = {}) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function makeRepository() {
  const rootDir = mkdtempSync(path.join(tmpdir(), "veritas-content-boundary-"));
  git(rootDir, ["init", "-q"]);
  git(rootDir, ["config", "user.name", "Veritas Test"]);
  git(rootDir, ["config", "user.email", "veritas@example.invalid"]);
  return rootDir;
}

function commitAll(rootDir) {
  git(rootDir, ["add", "."]);
  git(rootDir, ["commit", "-qm", "fixture"]);
}

test("package root exports the supported content-boundary API", () => {
  assert.equal(packageRoot.runContentBoundary, runContentBoundary);
  assert.equal(packageRoot.evaluateContentBoundary, evaluateContentBoundary);
  assert.equal(packageRoot.enumerateContentBoundaryFiles, enumerateContentBoundaryFiles);
  assert.equal(packageRoot.formatContentBoundaryResult, formatContentBoundaryResult);
  assert.equal(
    packageRoot.TRACKED_RUNTIME_ARTIFACT_LABEL,
    TRACKED_RUNTIME_ARTIFACT_LABEL,
  );
});

test("enumeration uses exact NUL-delimited Git commands and preserves tracked provenance", () => {
  const calls = [];
  const outputs = ["zeta.txt\0space name.txt\0dupe.txt\0", "alpha.txt\0dupe.txt\0"];
  const entries = enumerateContentBoundaryFiles({
    rootDir: "/repo",
    execFile(command, args, options) {
      calls.push({ command, args, options });
      return outputs.shift();
    },
  });

  assert.deepEqual(
    calls.map(({ command, args, options }) => ({ command, args, cwd: options.cwd })),
    [
      { command: "git", args: ["ls-files", "-z"], cwd: "/repo" },
      {
        command: "git",
        args: ["ls-files", "-z", "--others", "--exclude-standard"],
        cwd: "/repo",
      },
    ],
  );
  assert.deepEqual(entries, [
    { filePath: "alpha.txt", provenance: "untracked" },
    { filePath: "dupe.txt", provenance: "tracked" },
    { filePath: "space name.txt", provenance: "tracked" },
    { filePath: "zeta.txt", provenance: "tracked" },
  ]);
});

test("tracked and untracked text are scanned while ignored Git files are omitted", (t) => {
  const rootDir = makeRepository();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  writeFileSync(path.join(rootDir, ".gitignore"), "ignored.txt\n");
  writeFileSync(path.join(rootDir, "tracked.txt"), "clean\n");
  commitAll(rootDir);
  writeFileSync(path.join(rootDir, "untracked.txt"), "first\nforbidden\n");
  writeFileSync(path.join(rootDir, "ignored.txt"), "forbidden\n");

  const entries = enumerateContentBoundaryFiles({ rootDir });
  assert.deepEqual(
    entries.map(({ filePath, provenance }) => [filePath, provenance]),
    [
      [".gitignore", "tracked"],
      ["tracked.txt", "tracked"],
      ["untracked.txt", "untracked"],
    ],
  );
  assert.deepEqual(
    runContentBoundary({
      rootDir,
      bannedTerms: [{ label: "consumer term", pattern: /forbidden/i }],
    }).findings,
    [{ filePath: "untracked.txt", line: 2, label: "consumer term" }],
  );
});

test("thin consumer child process fails on a Git-verified untracked file before staging", (t) => {
  const rootDir = makeRepository();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const adapter = `#!/usr/bin/env node
(async () => {
  const { runContentBoundary } = await import(${JSON.stringify(engineUrl)});
  const result = runContentBoundary({
    rootDir: process.cwd(),
    ignoredPaths: ["check-content-boundary.cjs"],
    bannedTerms: [{ label: "consumer private term", pattern: /incident-token/i }],
  });
  (result.ok ? console.log : console.error)(result.output);
  if (!result.ok) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 2; });
`;
  writeFileSync(path.join(rootDir, "check-content-boundary.cjs"), adapter);
  writeFileSync(path.join(rootDir, "README.md"), "clean\n");
  commitAll(rootDir);
  const fixture = "pre-commit-fixture.txt";
  writeFileSync(path.join(rootDir, fixture), "safe\nincident-token\n");

  const untrackedProof = spawnSync("git", ["ls-files", "--error-unmatch", fixture], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.notEqual(untrackedProof.status, 0, "fixture must remain genuinely untracked");

  const result = spawnSync(process.execPath, ["check-content-boundary.cjs"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Content boundary check failed:/);
  assert.match(result.stderr, /- pre-commit-fixture\.txt:2 consumer private term/);
});

test("tracked runtime artifacts fail and untracked runtime artifacts are not vocabulary-scanned", (t) => {
  const rootDir = makeRepository();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  mkdirSync(path.join(rootDir, ".kontourai/flow-agents/tracked"), { recursive: true });
  writeFileSync(path.join(rootDir, ".kontourai/flow-agents/tracked/state.md"), "clean\n");
  commitAll(rootDir);
  mkdirSync(path.join(rootDir, ".kontourai/flow-agents/local"), { recursive: true });
  writeFileSync(
    path.join(rootDir, ".kontourai/flow-agents/local/secret.md"),
    "forbidden\n",
  );

  const result = runContentBoundary({
    rootDir,
    bannedTerms: [{ label: "consumer term", pattern: /forbidden/ }],
  });
  assert.deepEqual(result.findings, [
    {
      filePath: ".kontourai/flow-agents/tracked/state.md",
      line: 1,
      label: TRACKED_RUNTIME_ARTIFACT_LABEL,
    },
  ]);
});

test("duplicate entries scan once and global or sticky regex state is reset per file", () => {
  const contents = new Map([
    ["a.txt", "token"],
    ["b.txt", "token"],
  ]);
  let reads = 0;
  const findings = evaluateContentBoundary({
    rootDir: "/repo",
    entries: [
      { filePath: "b.txt", provenance: "untracked" },
      { filePath: "a.txt", provenance: "tracked" },
      { filePath: "a.txt", provenance: "untracked" },
    ],
    bannedTerms: [
      { label: "global", pattern: /token/g },
      { label: "sticky", pattern: /token/y },
    ],
    ignoredPathPatterns: [],
    readFile(filePath) {
      reads += 1;
      return contents.get(path.basename(filePath));
    },
  });
  assert.equal(reads, 2);
  assert.deepEqual(
    findings.map(({ filePath, label }) => [filePath, label]),
    [
      ["a.txt", "global"],
      ["a.txt", "sticky"],
      ["b.txt", "global"],
      ["b.txt", "sticky"],
    ],
  );
});

test("binary and unreadable inputs are safely skipped", () => {
  const entries = [
    { filePath: "binary.dat", provenance: "tracked" },
    { filePath: "unreadable.txt", provenance: "tracked" },
  ];
  const findings = evaluateContentBoundary({
    rootDir: "/repo",
    entries,
    bannedTerms: [{ label: "consumer term", pattern: /forbidden/ }],
    ignoredPathPatterns: [],
    readFile(filePath) {
      if (filePath.endsWith("unreadable.txt")) throw new Error("EACCES");
      return "forbidden\0binary";
    },
  });
  assert.deepEqual(findings, []);
});

test("malformed repository paths are not read outside root", () => {
  let reads = 0;
  const findings = evaluateContentBoundary({
    rootDir: "/repo",
    entries: [
      { filePath: "../escape.txt", provenance: "tracked" },
      { filePath: "/absolute.txt", provenance: "tracked" },
    ],
    bannedTerms: [{ label: "consumer term", pattern: /forbidden/ }],
    ignoredPathPatterns: [],
    readFile() {
      reads += 1;
      return "forbidden";
    },
  });
  assert.equal(reads, 0);
  assert.deepEqual(findings, []);
});

test("findings and rendered path:line output are deterministic and actionable", () => {
  const findings = evaluateContentBoundary({
    rootDir: "/repo",
    entries: [
      { filePath: "z.txt", provenance: "tracked" },
      { filePath: "a.txt", provenance: "tracked" },
    ],
    bannedTerms: [{ label: "consumer term", pattern: /forbidden/ }],
    ignoredPathPatterns: [],
    readFile(filePath) {
      return filePath.endsWith("a.txt") ? "one\ntwo\nforbidden" : "forbidden";
    },
  });
  assert.equal(
    formatContentBoundaryResult(findings),
    "Content boundary check failed:\n" +
      "- a.txt:3 consumer term\n" +
      "- z.txt:1 consumer term",
  );
  assert.equal(formatContentBoundaryResult([]), "Content boundary check passed.");
});
