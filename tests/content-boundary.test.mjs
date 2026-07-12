import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

function fakeFileSystem(read) {
  const identities = new Map();
  const stat = (filePath) => {
    const key = Buffer.from(filePath).toString();
    if (!identities.has(key)) identities.set(key, identities.size + 1);
    return {
      dev: 1,
      ino: identities.get(key),
      mode: 0o100644,
      isSymbolicLink: () => false,
    };
  };
  return {
    realpath: (filePath) => Buffer.from(filePath),
    lstat: stat,
    open: (filePath) => Buffer.from(filePath),
    fstat: stat,
    read: read ?? (() => ""),
    close: () => {},
  };
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
  const outputs = [
    Buffer.from("zeta.txt\0space name.txt\0dupe.txt\0"),
    Buffer.from("alpha.txt\0dupe.txt\0"),
  ];
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
  assert.deepEqual(entries.map(({ filePath, provenance }) => ({ filePath, provenance })), [
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

test("empty bannedTerms scans no consumer vocabulary of its own", (t) => {
  const rootDir = makeRepository();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  writeFileSync(
    path.join(rootDir, "tracked-policy.txt"),
    "SYNTHETIC_CONSUMER_SENTINEL_ALPHA\n",
  );
  commitAll(rootDir);
  const untrackedFixture = "untracked-policy.txt";
  writeFileSync(
    path.join(rootDir, untrackedFixture),
    "SYNTHETIC_REGULATED_DOMAIN_SENTINEL_BETA\n",
  );

  const untrackedProof = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", untrackedFixture],
    { cwd: rootDir, encoding: "utf8" },
  );
  assert.notEqual(untrackedProof.status, 0, "fixture must remain genuinely untracked");

  const entries = enumerateContentBoundaryFiles({ rootDir });
  assert.deepEqual(
    entries
      .filter(({ filePath }) => filePath.endsWith("-policy.txt"))
      .map(({ filePath, provenance }) => [filePath, provenance]),
    [
      ["tracked-policy.txt", "tracked"],
      ["untracked-policy.txt", "untracked"],
    ],
  );
  assert.deepEqual(
    evaluateContentBoundary({ rootDir, entries, bannedTerms: [] }),
    [],
  );
});

test("shared engine source declares no built-in banned vocabulary", () => {
  const source = readFileSync(
    new URL("../src/conformance/content-boundary.mjs", import.meta.url),
    "utf8",
  );
  // AC-CONFIG-04 mutation guard: detect vocabulary-owning declarations by
  // identifier structure without encoding any consumer's private words.
  const declarationPattern =
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  const offenders = [...source.matchAll(declarationPattern)]
    .map((match) => match[1])
    .filter((name) =>
      /(?:PRIVATE.*(?:BANNED|TERM|VOCAB)|BANNED.*(?:TERM|VOCAB)|(?:TERM|VOCAB).*PRIVATE)/i.test(
        name,
      ),
    );
  assert.deepEqual(
    offenders,
    [],
    `shared engine owns banned vocabulary declarations: ${offenders.join(", ")}`,
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
  assert.match(result.stderr, /- "pre-commit-fixture\.txt":2 "consumer private term"/);
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
    fileSystem: fakeFileSystem((filePath) => {
      reads += 1;
      return contents.get(path.basename(filePath.toString()));
    }),
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

test("binary inputs are skipped and unreadable enumerated inputs fail closed", () => {
  const entries = [
    { filePath: "binary.dat", provenance: "tracked" },
    { filePath: "unreadable.txt", provenance: "tracked" },
  ];
  const findings = evaluateContentBoundary({
    rootDir: "/repo",
    entries,
    bannedTerms: [{ label: "consumer term", pattern: /forbidden/ }],
    ignoredPathPatterns: [],
    fileSystem: fakeFileSystem((filePath) => {
      if (filePath.toString().endsWith("unreadable.txt")) throw new Error("EACCES");
      return "forbidden\0binary";
    }),
  });
  assert.deepEqual(findings, [
    {
      filePath: "unreadable.txt",
      line: 1,
      label: "Enumerated path cannot be read and cannot be safely scanned",
    },
  ]);
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
    fileSystem: fakeFileSystem(() => {
      reads += 1;
      return "forbidden";
    }),
  });
  assert.equal(reads, 0);
  assert.deepEqual(findings, []);
});

test("tracked and untracked symlink targets outside the canonical root are never read", (t) => {
  const parentDir = mkdtempSync(path.join(tmpdir(), "veritas-content-boundary-links-"));
  const rootDir = path.join(parentDir, "repo");
  mkdirSync(rootDir);
  t.after(() => rmSync(parentDir, { recursive: true, force: true }));
  git(rootDir, ["init", "-q"]);
  git(rootDir, ["config", "user.name", "Veritas Test"]);
  git(rootDir, ["config", "user.email", "veritas@example.invalid"]);
  writeFileSync(path.join(parentDir, "outside.txt"), "outside-token\n");
  try {
    symlinkSync("../outside.txt", path.join(rootDir, "tracked-link.txt"));
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`symlinks unsupported: ${error.code}`);
      return;
    }
    throw error;
  }
  commitAll(rootDir);
  symlinkSync("../outside.txt", path.join(rootDir, "untracked-link.txt"));

  const entries = enumerateContentBoundaryFiles({ rootDir });
  assert.deepEqual(
    entries.filter(({ filePath }) => filePath.endsWith("-link.txt")).map(
      ({ filePath, provenance }) => [filePath, provenance],
    ),
    [
      ["tracked-link.txt", "tracked"],
      ["untracked-link.txt", "untracked"],
    ],
  );
  const reads = [];
  const findings = evaluateContentBoundary({
    rootDir,
    entries,
    bannedTerms: [{ label: "outside token", pattern: /outside-token/ }],
    fileSystem: {
      read(descriptor, encoding) {
        reads.push(descriptor);
        return readFileSync(descriptor, encoding);
      },
    },
  });
  assert.equal(findings.some(({ label }) => label === "outside token"), false);
  assert.equal(reads.length, 0);
  assert.deepEqual(
    findings.filter(({ filePath }) => filePath.endsWith("-link.txt")).map(({ filePath, label }) => [filePath, label]),
    [
      ["tracked-link.txt", "Path target escapes the repository root and was not scanned"],
      ["untracked-link.txt", "Path target escapes the repository root and was not scanned"],
    ],
  );
});

test("a lexical target swap after canonical resolution cannot redirect the read", (t) => {
  const parentDir = mkdtempSync(path.join(tmpdir(), "veritas-content-boundary-race-"));
  const rootDir = path.join(parentDir, "repo");
  const swapDir = path.join(rootDir, "swap");
  const target = path.join(swapDir, "target.txt");
  mkdirSync(swapDir, { recursive: true });
  t.after(() => rmSync(parentDir, { recursive: true, force: true }));
  writeFileSync(target, "clean\n");
  writeFileSync(path.join(parentDir, "outside.txt"), "outside-token\n");

  let swapped = false;
  const findings = evaluateContentBoundary({
    rootDir,
    entries: [{ filePath: "swap/target.txt", provenance: "tracked" }],
    bannedTerms: [{ label: "outside token", pattern: /outside-token/ }],
    ignoredPathPatterns: [],
    realpath(filePath, options) {
      const resolved = realpathSync(filePath, options);
      if (!swapped && Buffer.isBuffer(filePath) && filePath.equals(Buffer.from(target))) {
        unlinkSync(target);
        symlinkSync("../../outside.txt", target);
        swapped = true;
      }
      return resolved;
    },
  });

  assert.equal(swapped, true);
  assert.equal(findings.some(({ label }) => label === "outside token"), false);
  assert.deepEqual(findings, [{
    filePath: "swap/target.txt",
    line: 1,
    label: "Enumerated path cannot be read and cannot be safely scanned",
  }]);
});

test("a persistent ancestor swap opens but never reads or leaks the descriptor", (t) => {
  const parentDir = mkdtempSync(path.join(tmpdir(), "veritas-content-boundary-parent-race-"));
  const rootDir = path.join(parentDir, "repo");
  const swapDir = path.join(rootDir, "swap");
  const savedDir = path.join(rootDir, "swap-original");
  const outsideDir = path.join(parentDir, "outside-dir");
  mkdirSync(swapDir, { recursive: true });
  mkdirSync(outsideDir);
  t.after(() => rmSync(parentDir, { recursive: true, force: true }));
  writeFileSync(path.join(swapDir, "target.txt"), "clean\n");
  writeFileSync(path.join(outsideDir, "target.txt"), "outside-token\n");
  const events = [];

  const findings = evaluateContentBoundary({
    rootDir,
    entries: [{ filePath: "swap/target.txt", provenance: "tracked" }],
    bannedTerms: [{ label: "outside token", pattern: /outside-token/ }],
    ignoredPathPatterns: [],
    fileSystem: {
      open(filePath, flags) {
        events.push("open");
        renameSync(swapDir, savedDir);
        symlinkSync("../outside-dir", swapDir);
        return openSync(filePath, flags);
      },
      read(descriptor, encoding) {
        events.push("read");
        return readFileSync(descriptor, encoding);
      },
      close(descriptor) {
        events.push("close");
        closeSync(descriptor);
      },
    },
  });

  assert.deepEqual(events, ["open", "close"]);
  assert.equal(findings.some(({ label }) => label === "outside token"), false);
  assert.deepEqual(findings, [{
    filePath: "swap/target.txt",
    line: 1,
    label: "Enumerated path cannot be read and cannot be safely scanned",
  }]);
});

test("an ancestor swap-open-restore fails descriptor identity before reading", (t) => {
  const parentDir = mkdtempSync(path.join(tmpdir(), "veritas-content-boundary-aba-"));
  const rootDir = path.join(parentDir, "repo");
  const swapDir = path.join(rootDir, "swap");
  const savedDir = path.join(rootDir, "swap-original");
  const outsideDir = path.join(parentDir, "outside-dir");
  mkdirSync(swapDir, { recursive: true });
  mkdirSync(outsideDir);
  t.after(() => rmSync(parentDir, { recursive: true, force: true }));
  writeFileSync(path.join(swapDir, "target.txt"), "clean\n");
  writeFileSync(path.join(outsideDir, "target.txt"), "outside-token\n");
  const events = [];

  const findings = evaluateContentBoundary({
    rootDir,
    entries: [{ filePath: "swap/target.txt", provenance: "tracked" }],
    bannedTerms: [{ label: "outside token", pattern: /outside-token/ }],
    ignoredPathPatterns: [],
    fileSystem: {
      open(filePath, flags) {
        events.push("open");
        renameSync(swapDir, savedDir);
        symlinkSync("../outside-dir", swapDir);
        const descriptor = openSync(filePath, flags);
        unlinkSync(swapDir);
        renameSync(savedDir, swapDir);
        return descriptor;
      },
      read(descriptor, encoding) {
        events.push("read");
        return readFileSync(descriptor, encoding);
      },
      close(descriptor) {
        events.push("close");
        closeSync(descriptor);
      },
    },
  });

  assert.deepEqual(events, ["open", "close"]);
  assert.equal(findings.some(({ label }) => label === "outside token"), false);
  assert.deepEqual(findings, [{
    filePath: "swap/target.txt",
    line: 1,
    label: "Enumerated path cannot be read and cannot be safely scanned",
  }]);
});

test("a legacy path-based readFile option cannot reopen content after validation", (t) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "veritas-content-boundary-no-path-read-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  writeFileSync(path.join(rootDir, "clean.txt"), "clean\n");
  let legacyCalls = 0;

  const findings = evaluateContentBoundary({
    rootDir,
    entries: [{ filePath: "clean.txt", provenance: "tracked" }],
    bannedTerms: [{ label: "outside token", pattern: /outside-token/ }],
    ignoredPathPatterns: [],
    readFile() {
      legacyCalls += 1;
      return "outside-token\n";
    },
  });

  assert.equal(legacyCalls, 0);
  assert.deepEqual(findings, []);
});

test("invalid UTF-8 Git pathname bytes are preserved and fail closed", (t) => {
  const rootDir = makeRepository();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const rawName = Buffer.from([0x62, 0x61, 0x64, 0x2d, 0xff, 0x2e, 0x74, 0x78, 0x74]);
  const rawPath = Buffer.concat([Buffer.from(rootDir), Buffer.from(path.sep), rawName]);
  try {
    writeFileSync(rawPath, "forbidden\n");
  } catch (error) {
    if (["EINVAL", "ENOTSUP", "ENOSYS", "EPERM", "EACCES", "EILSEQ"].includes(error.code)) {
      t.skip(`non-UTF-8 filenames unsupported: ${error.code}`);
      return;
    }
    throw error;
  }
  git(rootDir, ["add", "."]);

  const entries = enumerateContentBoundaryFiles({ rootDir });
  const entry = entries.find(({ rawPath: candidate }) => candidate.equals(rawName));
  if (!entry) {
    t.skip("Git/filesystem did not round-trip the non-UTF-8 filename");
    return;
  }
  assert.equal(entry.filePath, "bad-\\xff.txt");
  const result = runContentBoundary({
    rootDir,
    bannedTerms: [{ label: "consumer term", pattern: /forbidden/ }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{
    filePath: "bad-\\xff.txt",
    line: 1,
    label: "Path is not valid UTF-8 and cannot be safely scanned",
  }]);
});

test("injected invalid UTF-8 pathname bytes fail closed with escaped identity", () => {
  const rawPath = Buffer.from([0x62, 0x61, 0x64, 0x2d, 0xff, 0x2e, 0x74, 0x78, 0x74]);
  const findings = evaluateContentBoundary({
    rootDir: "/repo",
    entries: [{ rawPath, filePath: "bad-\\xff.txt", provenance: "tracked" }],
    ignoredPathPatterns: [],
    fileSystem: fakeFileSystem(() => {
      throw new Error("invalid-byte path must not be vocabulary-scanned");
    }),
  });
  assert.deepEqual(findings, [{
    filePath: "bad-\\xff.txt",
    line: 1,
    label: "Path is not valid UTF-8 and cannot be safely scanned",
  }]);
  assert.equal(
    formatContentBoundaryResult(findings),
    'Content boundary check failed:\n- "bad-\\\\xff.txt":1 "Path is not valid UTF-8 and cannot be safely scanned"',
  );
});

test("newline paths render on one physical line and valid Unicode remains readable", (t) => {
  const rootDir = makeRepository();
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  writeFileSync(path.join(rootDir, "line one\n- forged.txt"), "forbidden\n");
  writeFileSync(path.join(rootDir, "café-東京.txt"), "forbidden\n");

  const result = runContentBoundary({
    rootDir,
    bannedTerms: [{ label: "consumer term", pattern: /forbidden/ }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map(({ filePath }) => filePath), [
    "café-東京.txt",
    "line one\n- forged.txt",
  ]);
  assert.match(result.output, /- "line one\\n- forged\.txt":1 "consumer term"/);
  assert.match(result.output, /- "café-東京\.txt":1 "consumer term"/);
  assert.equal(result.output.split("\n").length, 3);
});

test("control-bearing pathname and label render as one unambiguous record", () => {
  const findings = [{
    filePath: "real path\n- forged-path.txt",
    line: 1,
    label: 'real label\n- "forged.txt":1 forged label',
  }];
  const output = formatContentBoundaryResult(findings);
  assert.equal(output.split("\n").length, 2);
  assert.equal(
    output,
    'Content boundary check failed:\n' +
      '- "real path\\n- forged-path.txt":1 "real label\\n- \\"forged.txt\\":1 forged label"',
  );
});

test("packed package supports the documented CommonJS dynamic import", (t) => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "veritas-packed-consumer-"));
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  const packDir = path.join(tempDir, "packs");
  const packageDir = path.join(tempDir, "consumer", "node_modules", "@kontourai", "veritas");
  const consumerDir = path.join(tempDir, "consumer");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(packageDir, { recursive: true });
  const packed = JSON.parse(execFileSync("npm", [
    "pack", "--ignore-scripts", "--json", "--pack-destination", packDir,
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: path.join(tempDir, "npm-cache") },
  }));
  const tarball = path.join(packDir, packed[0].filename);
  execFileSync("tar", ["-xzf", tarball, "--strip-components=1", "-C", packageDir]);
  const sourceModules = path.resolve("node_modules");
  for (const dependency of [
    "@kontourai/surface",
    "@modelcontextprotocol/sdk",
    "ajv",
    "ajv-formats",
    "hachure",
    "picomatch",
  ]) {
    const destination = path.join(consumerDir, "node_modules", ...dependency.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    symlinkSync(path.join(sourceModules, ...dependency.split("/")), destination, "dir");
  }
  writeFileSync(path.join(consumerDir, ".gitignore"), "node_modules/\n");
  writeFileSync(path.join(consumerDir, "README.md"), "clean\n");
  git(consumerDir, ["init", "-q"]);
  const adapter = `(async () => {
  const { runContentBoundary } = await import("@kontourai/veritas");
  if (typeof runContentBoundary !== "function") throw new Error("missing export");
  const result = runContentBoundary({ rootDir: process.cwd() });
  if (!result.ok) throw new Error(result.output);
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;
  writeFileSync(path.join(consumerDir, "adapter.cjs"), adapter);
  const result = spawnSync(process.execPath, ["adapter.cjs"], {
    cwd: consumerDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
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
    fileSystem: fakeFileSystem((filePath) => {
      return filePath.toString().endsWith("a.txt") ? "one\ntwo\nforbidden" : "forbidden";
    }),
  });
  assert.equal(
    formatContentBoundaryResult(findings),
    "Content boundary check failed:\n" +
      "- \"a.txt\":3 \"consumer term\"\n" +
      "- \"z.txt\":1 \"consumer term\"",
  );
  assert.equal(formatContentBoundaryResult([]), "Content boundary check passed.");
});
