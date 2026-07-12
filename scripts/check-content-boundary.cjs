#!/usr/bin/env node

const SELF = "scripts/check-content-boundary.cjs";

const bannedTerms = [
  {
    label: "private vertical product name",
    pattern: new RegExp(["c", "a", "m", "p", "f", "i", "t"].join(""), "i"),
  },
  {
    label: "private regulated vertical repository name",
    pattern: new RegExp("\\b" + ["t", "a", "x", "e", "s"].join("") + "\\b", "i"),
  },
  {
    label: "private regulated vertical term",
    pattern: new RegExp("\\b" + ["t", "a", "x"].join("") + "\\b", "i"),
  },
];

const ignoredPathPatterns = [
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^\.git\//,
  /^\.astro\//,
  /^test-results\//,
  /^\.omx\//,
];

(async () => {
  // Import the package root so this repository exercises the supported public API.
  const { runContentBoundary } = await import("../src/index.mjs");
  const result = runContentBoundary({
    rootDir: process.cwd(),
    bannedTerms,
    ignoredPaths: [SELF],
    ignoredPathPatterns,
  });

  (result.ok ? console.log : console.error)(result.output);
  if (!result.ok) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
