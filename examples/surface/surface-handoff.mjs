#!/usr/bin/env node
// Demonstrates the Veritas → Surface handoff.
//
// Reads a Veritas evidence artifact (the kind produced by `veritas readiness`
// or `veritas report`), extracts its `trust.bundle` block, and feeds it to
// Surface's `buildTrustReport` to produce a portable trust report.
//
// Usage:
//   node examples/surface/surface-handoff.mjs [path-to-evidence.json]
//
// Defaults to .veritas/evidence/conformance-local.json if no path is given.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildTrustReport,
  formatTrustReportSummary,
  validateTrustBundle,
} from "@kontourai/surface";

const evidencePath = resolve(
  process.argv[2] ?? ".veritas/evidence/conformance-local.json",
);

const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const trustBundle = evidence?.trust?.bundle;

if (!trustBundle) {
  console.error(
    `No trust.bundle block found in ${evidencePath}. Run \`veritas report\` to produce one.`,
  );
  process.exit(2);
}

// Validate at the boundary. Surface owns the schema; Veritas only emits.
// `validateTrustBundle` returns the bundle on success or throws on failure.
let validated;
try {
  validated = validateTrustBundle(trustBundle);
} catch (err) {
  console.error("trust.bundle failed Surface validation:");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const report = buildTrustReport(validated);
console.log(formatTrustReportSummary(report));
