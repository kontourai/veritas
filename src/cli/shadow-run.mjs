import { resolve } from 'node:path';
import { parseShadowArgs } from '../args.mjs';
import { runBash, createMcpServerPool } from '../runner/index.mjs';
import { proofLabel } from '../proof/index.mjs';
import {
  generateVeritasReport,
  buildFeedbackSummary,
  feedbackHasFailures,
  resolveVeritasPaths,
  resolveReportInputs,
  resolveProofCommands,
} from '../report.mjs';
import { generateEvalDraft, generateEvalRecord } from '../eval/records.mjs';
import { appendRunHistory, deriveTimeToGreenFromRunHistory } from '../eval/run-history.mjs';

function hasShadowOutcomeInputs(options) {
  return (
    typeof options.acceptedWithoutMajorRewrite === 'boolean' &&
    typeof options.requiredFollowup === 'boolean' &&
    typeof options.timeToGreenMinutes === 'number' &&
    !Number.isNaN(options.timeToGreenMinutes)
  );
}

function normalizeOutputFormat(format, defaultFormat) {
  const resolvedFormat = format ?? defaultFormat;
  if (!['json', 'feedback'].includes(resolvedFormat)) {
    throw new Error('--format must be json or feedback');
  }
  return resolvedFormat;
}

function handleSurfaceValidationCliError(error) {
  if (error?.exitCode !== 2) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
  return null;
}

export async function runShadowRunCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseShadowArgs(argv);
  const format = normalizeOutputFormat(options.format, 'feedback');
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const startedAt = new Date().toISOString();
  const actor = process.env.VERITAS_ACTOR ?? 'unknown';
  const { adapterPath } = resolveVeritasPaths(
    { ...options, rootDir },
    { ...defaults, rootDir },
  );
  const reportInputs = resolveReportInputs(
    [],
    {
      ...options,
      workingTree:
        options.workingTree || (!options.changedFrom && !options.changedTo),
    },
    rootDir,
  );
  const proofPlan = resolveProofCommands({
    adapterPath,
    files: reportInputs.files,
    rootDir,
    explicitProofCommand: options.proofCommand,
  });
  const proofs = proofPlan.proofs ?? [];
  const proofLabels = proofs.map((proof) => proofLabel(proof));
  if (!options.skipProof && proofs.length === 0) {
    throw new Error(
      'veritas run requires a proof command or an adapter required proof lane',
    );
  }

  let proofFailure = null;
  const proofResults = [];
  if (!options.skipProof) {
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const pool = createMcpServerPool({ signal: controller.signal });
    try {
      for (const proof of proofs) {
        const runner = proof.runner ?? 'bash';
        const label = proofLabel(proof);
        try {
          const result = runner === 'mcp'
            ? await pool.call(proof.server, proof.tool, proof.input ?? {}, { signal: controller.signal })
            : await runBash(proof.command, { cwd: rootDir, signal: controller.signal });
          const proofResult = {
            id: proof.id,
            runner,
            label,
            passed: runner === 'mcp' ? !result.isError : result.passed,
            exitCode: runner === 'bash' ? result.exitCode ?? null : null,
            signal: runner === 'bash' ? result.signal ?? null : null,
            stdout: runner === 'bash' ? result.stdout ?? '' : '',
            stderr: runner === 'bash' ? result.stderr ?? '' : '',
            content: runner === 'mcp' ? result.content ?? [] : [],
            isError: runner === 'mcp' ? result.isError ?? false : false,
            durationMs: result.durationMs ?? 0,
          };
          proofResults.push(proofResult);
          if (format !== 'feedback' && runner === 'bash') {
            if (proofResult.stdout) process.stdout.write(proofResult.stdout);
            if (proofResult.stderr) process.stderr.write(proofResult.stderr);
          }
          if (!proofResult.passed) {
            const status = runner === 'mcp'
              ? 'MCP tool returned an error'
              : (proofResult.exitCode ?? proofResult.signal ?? 'unknown status');
            proofFailure = {
              id: proof.id,
              runner,
              label,
              message: runner === 'mcp' ? status : `Proof command exited with ${status}`,
              ...(runner === 'bash' ? {
                stdout: proofResult.stdout,
                stderr: proofResult.stderr,
                exitCode: proofResult.exitCode,
              } : {
                content: proofResult.content,
                isError: proofResult.isError,
              }),
            };
            break;
          }
        } catch (error) {
          proofFailure = {
            id: proof.id,
            runner,
            label,
            message: error.message,
          };
          break;
        }
      }
    } finally {
      await pool.close();
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
  }

  let reportResult;
  try {
    reportResult = await generateVeritasReport(
      {
        ...options,
        rootDir,
        proofResults,
        workingTree:
          options.workingTree || (!options.changedFrom && !options.changedTo),
        baselineCiFastStatus:
          options.baselineCiFastStatus ??
          (options.skipProof ? undefined : proofFailure ? 'failed' : 'success'),
        explicitProofCommand: options.proofCommand,
        includeAttestationGate: true,
      },
      { ...defaults, rootDir },
    );
  } catch (error) {
    reportResult = handleSurfaceValidationCliError(error);
  }
  if (!reportResult) return;
  if (reportResult.record.uncovered_path_result === 'fail') {
    throw new Error(
      'veritas run encountered changed files outside configured surfaces and the uncovered-path policy is fail',
    );
  }
  const currentStatus = feedbackHasFailures(reportResult.record, proofFailure) ? 'fail' : 'pass';
  const finishedAt = new Date().toISOString();
  const historyTimeToGreen = deriveTimeToGreenFromRunHistory(rootDir, {
    actor,
    currentStatus,
    finishedAt,
  });
  appendRunHistory(rootDir, {
    run_id: reportResult.record.run_id,
    started_at: startedAt,
    finished_at: finishedAt,
    status: currentStatus,
    actor,
  });
  const evalOptions = {
    ...options,
    timeToGreenMinutes: options.timeToGreenMinutes ?? historyTimeToGreen ?? undefined,
  };
  const draftResult = generateEvalDraft(
    {
      ...evalOptions,
      rootDir,
      evidencePath: reportResult.artifactPath,
      force: evalOptions.force ?? false,
    },
    { ...defaults, rootDir },
  );

  if (!hasShadowOutcomeInputs(evalOptions)) {
    if (format === 'feedback') {
      process.stdout.write(
        buildFeedbackSummary({
          record: reportResult.record,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          proofLabels: options.skipProof ? [] : proofLabels,
          proofRan: !options.skipProof,
          proofFailure,
        }),
      );
      if (feedbackHasFailures(reportResult.record, proofFailure)) {
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'report-and-draft',
          proofLabels: options.skipProof ? [] : proofLabels,
          proofResolutionSource: proofPlan.resolutionSource,
          proofRan: !options.skipProof,
          proofFailure,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          suggestedEvalCommand: draftResult.suggestedRecordCommand,
          message:
            'Proof, report, and eval draft completed. The final judgment fields still need confirmation.',
        },
        null,
        2,
      )}\n`,
    );
    if (feedbackHasFailures(reportResult.record, proofFailure)) {
      process.exitCode = 1;
    }
    return;
  }

  const evalResult = generateEvalRecord(
    {
      ...options,
      ...evalOptions,
      rootDir,
      draftPath: draftResult.artifactPath,
      force: evalOptions.force ?? false,
    },
    { ...defaults, rootDir },
  );

  if (format === 'feedback') {
    process.stdout.write(
      buildFeedbackSummary({
        record: reportResult.record,
        reportArtifactPath: reportResult.artifactPath,
        draftArtifactPath: draftResult.artifactPath,
        evalArtifactPath: evalResult.artifactPath,
        proofLabels: options.skipProof ? [] : proofLabels,
        proofRan: !options.skipProof,
        proofFailure,
      }),
    );
    if (feedbackHasFailures(reportResult.record, proofFailure)) {
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
        {
          mode: 'report-draft-and-eval',
          proofLabels: options.skipProof ? [] : proofLabels,
          proofResolutionSource: proofPlan.resolutionSource,
          proofRan: !options.skipProof,
          proofFailure,
          reportArtifactPath: reportResult.artifactPath,
          draftArtifactPath: draftResult.artifactPath,
          evalArtifactPath: evalResult.artifactPath,
          reportRunId: reportResult.record.run_id,
          reportSourceKind: reportResult.record.source_kind,
          evalMode: evalResult.record.mode,
        },
      null,
      2,
    )}\n`,
  );
  if (feedbackHasFailures(reportResult.record, proofFailure)) {
    process.exitCode = 1;
  }
}
