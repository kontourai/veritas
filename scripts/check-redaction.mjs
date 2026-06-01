#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const REVIEW_FIELDS_RE = /"(notes|excerptOrSummary|metadata)"\s*:/;

function trackedVeritasFiles(rootDir) {
  return execFileSync('git', ['ls-files', '.veritas'], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.json') || line.endsWith('.jsonl'));
}

const rootDir = process.cwd();
const failures = [];
const warnings = [];

for (const file of trackedVeritasFiles(rootDir)) {
  const path = resolve(rootDir, file);
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf8');
  if (EMAIL_RE.test(content)) {
    failures.push(`${file}: contains an email address`);
  }
  if (REVIEW_FIELDS_RE.test(content)) {
    warnings.push(`${file}: contains notes/excerptOrSummary/metadata and needs explicit review`);
  }
}

for (const warning of warnings) {
  process.stderr.write(`WARN ${warning}\n`);
}
for (const failure of failures) {
  process.stderr.write(`FAIL ${failure}\n`);
}

if (failures.length > 0) {
  process.exit(1);
}

process.stdout.write(`Redaction check passed (${warnings.length} review warnings).\n`);
