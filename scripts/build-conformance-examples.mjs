import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateStandardsFeedbackDraft,
  generateStandardsFeedbackRecord,
  generateVeritasReport,
} from '../src/index.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = resolve(rootDir, 'examples/repo-conformance');
const runId = 'veritas-repo-conformance';
const timestamp = '2026-04-21T22:00:00.000Z';
const explicitFiles = [
  '.veritas/GOVERNANCE.md',
  '.veritas/repo-map.json',
  '.veritas/repo-standards/default.repo-standards.json',
  '.veritas/authority/default.authority-settings.json',
  'CLAUDE.md',
  'README.md',
  'package.json',
  'bin/veritas.mjs',
  'src/index.mjs',
  'docs/reference/cli.md',
  'schemas/veritas-evidence.schema.json',
  'tests/veritas.test.mjs',
];

function writeText(relativePath, content) {
  const outputPath = resolve(rootDir, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');
}

function copyJsonArtifact(sourceRelativePath, destinationRelativePath) {
  const sourcePath = resolve(rootDir, sourceRelativePath);
  const parsed = JSON.parse(readFileSync(sourcePath, 'utf8'));
  writeText(destinationRelativePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

const report = await generateVeritasReport(
  {
    rootDir,
    runId,
    sourceRef: 'refs/heads/main',
    baselineCiFastStatus: 'success',
    timestamp,
  },
  { rootDir },
  explicitFiles,
);

const draft = generateStandardsFeedbackDraft(
  {
    rootDir,
    evidencePath: report.artifactPath,
    force: true,
    reviewerConfidence: 'high',
    timeToGreenMinutes: 12,
    overrideCount: 0,
    notes: [
      'This example is generated from the Veritas repo using its tracked .veritas config.',
      'The goal is to show a self-hosted report and standards feedback flow without making local evidence outputs part of the distributed package.',
    ],
  },
  { rootDir },
);

const evaluation = generateStandardsFeedbackRecord(
  {
    rootDir,
    draftPath: draft.artifactPath,
    force: true,
    acceptedWithoutMajorRewrite: true,
    requiredFollowup: false,
    reviewerConfidence: 'high',
    timeToGreenMinutes: 12,
    overrideCount: 0,
    falsePositiveRules: [],
    missedIssues: [],
    notes: [
      'The repo-local Repo Map and repo standards were sufficient to classify the selected surfaces without unresolved files.',
      'This example demonstrates the value claim in-repo: focused surface mapping plus reviewable evidence and standards feedback artifacts.',
    ],
  },
  { rootDir },
);

mkdirSync(examplesDir, { recursive: true });
copyJsonArtifact(report.artifactPath, 'examples/repo-conformance/veritas-repo-report.json');
copyJsonArtifact(draft.artifactPath, 'examples/repo-conformance/veritas-repo-standards-feedback-draft.json');
copyJsonArtifact(evaluation.artifactPath, 'examples/repo-conformance/veritas-repo-standards-feedback.json');
writeText('examples/repo-conformance/veritas-repo-report.md', report.markdownSummary);
writeText('examples/repo-conformance/veritas-repo-standards-feedback-draft.md', draft.markdownSummary);
writeText('examples/repo-conformance/veritas-repo-standards-feedback.md', evaluation.markdownSummary);

process.stdout.write(
  `${JSON.stringify(
    {
      runId,
      sourceFiles: explicitFiles,
      outputs: [
        'examples/repo-conformance/veritas-repo-report.json',
        'examples/repo-conformance/veritas-repo-report.md',
        'examples/repo-conformance/veritas-repo-standards-feedback-draft.json',
        'examples/repo-conformance/veritas-repo-standards-feedback-draft.md',
        'examples/repo-conformance/veritas-repo-standards-feedback.json',
        'examples/repo-conformance/veritas-repo-standards-feedback.md',
      ],
    },
    null,
    2,
  )}\n`,
);
