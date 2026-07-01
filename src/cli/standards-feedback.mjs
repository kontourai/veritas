import { resolve } from 'node:path';
import {
  parseMarkerStandardsFeedbackArgs,
  parseMarkerSuiteStandardsFeedbackArgs,
  parseStandardsFeedbackArgs,
  parseTokens,
} from '../args.mjs';
import {
  generateStandardsFeedbackDraft,
  generateStandardsFeedbackRecord,
  generateStandardsFeedbackSummary,
} from '../standards-feedback/records.mjs';
import {
  generateMarkerBenchmarkComparison,
  generateMarkerBenchmarkSuiteReport,
} from '../standards-feedback/marker-benchmark.mjs';
import { observeSessionLogStandardsFeedback } from '../integrations/session-logs.mjs';
import { observeFilesystemStandardsFeedback } from '../standards-feedback/filesystem-observer.mjs';
import {
  applyRecommendation,
  generateAndWriteRecommendations,
  listRecommendations,
  loadRecommendation,
} from '../standards-feedback/recommendations.mjs';

export function runStandardsFeedbackRecordCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const result = generateStandardsFeedbackRecord(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        historyPath: result.historyPath,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runStandardsFeedbackSummaryCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const result = generateStandardsFeedbackSummary(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(result.markdownSummary);
}

export function runStandardsFeedbackRecommendCli(argv = process.argv.slice(2), defaults = {}) {
  const { options } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--repo-standards': { type: 'string', key: 'repoStandardsPath' },
    '--repo-map': { type: 'string', key: 'repoMapPath' },
    '--force': { type: 'flag', key: 'force' },
    '--dry-run': { type: 'flag', key: 'dryRun' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result = generateAndWriteRecommendations({
    ...options,
    rootDir,
    write: !options.dryRun,
  });
  process.stdout.write(`${JSON.stringify({
    recommendations: result.recommendations,
    written: result.written,
  }, null, 2)}\n`);
}

export function runRecommendationCli(kind, argv = process.argv.slice(2), defaults = {}) {
  const { options, rest } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--status': { type: 'string', key: 'status' },
    '--actor': { type: 'string', key: 'actor' },
    '--accept': { type: 'flag', key: 'accept' },
    '--reject': { type: 'flag', key: 'reject' },
    '--message': { type: 'string', key: 'message' },
    '--approval-ref': { type: 'string', key: 'approvalRef' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (kind === 'list') {
    process.stdout.write(`${JSON.stringify({
      recommendations: listRecommendations({ rootDir, status: options.status ?? 'proposed' }),
    }, null, 2)}\n`);
    return;
  }
  const id = rest[0];
  if (!id) throw new Error(`veritas recommendation ${kind} requires <id>`);
  if (kind === 'show') {
    process.stdout.write(`${JSON.stringify(loadRecommendation(rootDir, id), null, 2)}\n`);
    return;
  }
  if (kind === 'decide') {
    process.stdout.write(`${JSON.stringify(applyRecommendation({
      rootDir,
      id,
      actor: options.actor,
      accept: options.accept ?? false,
      reject: options.reject ?? false,
      message: options.message ?? '',
      approvalRef: options.approvalRef,
    }), null, 2)}\n`);
    return;
  }
  throw new Error(`Unsupported recommendation command: ${kind}`);
}

export function runStandardsFeedbackMarkerCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerStandardsFeedbackArgs(argv);
  const result = generateMarkerBenchmarkComparison(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runStandardsFeedbackMarkerSuiteCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseMarkerSuiteStandardsFeedbackArgs(argv);
  const result = generateMarkerBenchmarkSuiteReport(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function runStandardsFeedbackDraftCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const result = generateStandardsFeedbackDraft(options, {
    ...defaults,
    rootDir: resolve(options.rootDir ?? defaults.rootDir ?? process.cwd()),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        suggestedRecordCommand: result.suggestedRecordCommand,
        markdownSummary: result.markdownSummary,
        ...result.record,
      },
      null,
      2,
    )}\n`,
  );
}

export function runStandardsFeedbackObserveCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseStandardsFeedbackArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const result =
    options.tool === 'none' || !options.sessionLogPath
      ? observeFilesystemStandardsFeedback({
          evidencePath: options.evidencePath,
          rootDir,
          outputPath: options.outputPath,
          churnThreshold: options.rewriteThreshold ?? 0.3,
        })
      : observeSessionLogStandardsFeedback({
          sessionLogPath: options.sessionLogPath,
          evidencePath: options.evidencePath,
          rootDir,
          outputPath: options.outputPath,
          tool: options.tool ?? 'auto',
          churnThreshold: options.rewriteThreshold ?? 0.3,
          verbose: options.verbose ?? false,
        });

  process.stdout.write(
    `${JSON.stringify(
      {
        artifactPath: result.artifactPath,
        ...(result.reader ? { reader: result.reader } : {}),
        ...(result.heuristics ? { heuristics: result.heuristics } : {}),
        ...result.draft,
      },
      null,
      2,
    )}\n`,
  );
}
