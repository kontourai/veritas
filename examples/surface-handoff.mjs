#!/usr/bin/env node
// Demonstrates the Veritas → Surface handoff.
//
// Reads a Veritas evidence artifact (the kind produced by `veritas readiness`
// or `veritas report`), extracts its `surface.input` block, and feeds it to
// Surface's `buildTrustReport` to produce a portable trust report.
//
// Usage:
//   node examples/surface-handoff.mjs [path-to-evidence.json]
//
// Defaults to .veritas/evidence/conformance-local.json if no path is given.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildTrustReport,
  formatTrustReportSummary,
  validateTrustInput,
} from "@kontourai/surface";

const evidencePath = resolve(
  process.argv[2] ?? ".veritas/evidence/conformance-local.json",
);

const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const trustInput = evidence?.surface?.input;

if (!trustInput) {
  console.error(
    `No surface.input block found in ${evidencePath}. Run \`veritas report\` to produce one.`,
  );
  process.exit(2);
}

// Validate at the boundary. Surface owns the schema; Veritas only emits.
// `validateTrustInput` returns the input on success or throws on failure.
let validated;
try {
  validated = validateTrustInput(trustInput);
} catch (err) {
  console.error("surface.input failed Surface validation:");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const report = buildTrustReport(validated);
console.log(formatTrustReportSummary(report));
