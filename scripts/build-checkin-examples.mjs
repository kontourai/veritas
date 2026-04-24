import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateEvalDraft,
  generateEvalRecord,
  generateVeritasReport,
} from '../src/index.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = resolve(rootDir, 'examples/checkins');
const runId = 'veritas-repo-check-in';
const timestamp = '2026-04-21T22:00:00.000Z';
const explicitFiles = [
  '.veritas/GOVERNANCE.md',
  '.veritas/repo.adapter.json',
  '.veritas/policy-packs/default.policy-pack.json',
  '.veritas/team/default.team-profile.json',
  'CLAUDE.md',
  'README.md',
  'package.json',
  'bin/veritas.mjs',
  'src/index.mjs',
  'docs/reference/cli.md',
  'schemas/veritas-evidence.schema.json',
  'tests/framework.test.mjs',
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

const report = generateVeritasReport(
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

const draft = generateEvalDraft(
  {
    rootDir,
    evidencePath: report.artifactPath,
    force: true,
    reviewerConfidence: 'high',
    timeToGreenMinutes: 12,
    overrideCount: 0,
    notes: [
      'This example is generated from the Veritas repo using its tracked .veritas config.',
      'The goal is to show a self-hosted report and eval flow without making local evidence outputs part of the distributed package.',
    ],
  },
  { rootDir },
);

const evaluation = generateEvalRecord(
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
      'The repo-local adapter and policy pack were sufficient to classify the selected surfaces without unresolved files.',
      'This example demonstrates the value claim in-repo: focused surface mapping plus reviewable evidence and eval artifacts.',
    ],
  },
  { rootDir },
);

mkdirSync(examplesDir, { recursive: true });
copyJsonArtifact(report.artifactPath, 'examples/checkins/veritas-repo-report.json');
copyJsonArtifact(draft.artifactPath, 'examples/checkins/veritas-repo-eval-draft.json');
copyJsonArtifact(evaluation.artifactPath, 'examples/checkins/veritas-repo-eval.json');
writeText('examples/checkins/veritas-repo-report.md', report.markdownSummary);
writeText('examples/checkins/veritas-repo-eval-draft.md', draft.markdownSummary);
writeText('examples/checkins/veritas-repo-eval.md', evaluation.markdownSummary);

process.stdout.write(
  `${JSON.stringify(
    {
      runId,
      sourceFiles: explicitFiles,
      outputs: [
        'examples/checkins/veritas-repo-report.json',
        'examples/checkins/veritas-repo-report.md',
        'examples/checkins/veritas-repo-eval-draft.json',
        'examples/checkins/veritas-repo-eval-draft.md',
        'examples/checkins/veritas-repo-eval.json',
        'examples/checkins/veritas-repo-eval.md',
      ],
    },
    null,
    2,
  )}\n`,
);
