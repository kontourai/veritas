import {
  appendFileSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';
import { loadRepoMap, loadRepoStandards } from '../load.mjs';
import {
  writeSurfaceConsoleReadModel,
} from '../surface/console.mjs';
import {
  inspectAttestationStatus,
} from '../attestations.mjs';
import {
  evidenceCheckRecordsForCommands,
} from '../evidence/index.mjs';
import {
  formatTriState,
  parseBaselineCiFastStatus,
  resolveEvidenceCheckPlan,
  resolveWorkstream,
} from './planning.mjs';
import {
  listChangedFiles,
  listWorkingTreeFiles,
  resolveReportInputs,
} from './inputs.mjs';
import {
  writeEvidenceArtifact,
  writeSurfaceClaimInputs,
} from './artifacts.mjs';
import { buildEvidenceRecord } from './record.mjs';
import {
  buildMarkdownSummary,
  feedbackStatusForPolicyResult,
  buildFeedbackSummary,
  feedbackHasFailures,
  buildStandardsFeedbackMarkdownSummary,
  buildStandardsFeedbackDraftMarkdownSummary,
} from './format.mjs';

export function mergeStandardsFeedbackRecordOptions(options, draft) {
  const falsePositiveRules = options.falsePositiveRules ?? [];
  const missedIssues = options.missedIssues ?? [];
  const notes = options.notes ?? [];

  return {
    acceptedWithoutMajorRewrite: options.acceptedWithoutMajorRewrite,
    requiredFollowup: options.requiredFollowup,
    reviewerConfidence:
      options.reviewerConfidence ?? draft?.prefilled_outcome?.reviewer_confidence,
    timeToGreenMinutes:
      options.timeToGreenMinutes ??
      (typeof draft?.prefilled_measurements?.time_to_green_minutes === 'number'
        ? draft.prefilled_measurements.time_to_green_minutes
        : undefined),
    exceptionCount:
      options.exceptionCount ?? draft?.prefilled_measurements?.exception_count,
    falsePositiveRules:
      falsePositiveRules.length > 0
        ? falsePositiveRules
        : (draft?.prefilled_measurements?.false_positive_rules ?? []),
    missedIssues:
      missedIssues.length > 0
        ? missedIssues
        : (draft?.prefilled_measurements?.missed_issues ?? []),
    notes: notes.length > 0 ? notes : (draft?.notes ?? []),
  };
}

// bootstrap/install domains live in dedicated modules

// hook/install runtime lives in dedicated modules

export function resolveVeritasPaths(options, defaults = {}) {
  const rootDir = options.rootDir ? resolve(options.rootDir) : defaults.rootDir;
  const defaultRepoMapPath =
    defaults.repoMapPath ??
    (rootDir ? resolve(rootDir, '.veritas/repo-map.json') : undefined);
  const defaultRepoStandardsPath =
    defaults.repoStandardsPath ??
    (rootDir
      ? resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json')
      : undefined);
  const defaultAuthoritySettingsPath =
    defaults.authoritySettingsPath ??
    (rootDir ? resolve(rootDir, '.veritas/authority/default.authority-settings.json') : undefined);

  return {
    rootDir,
    repoMapPath: options.repoMapPath
      ? resolve(rootDir ?? process.cwd(), options.repoMapPath)
      : defaultRepoMapPath,
    repoStandardsPath: options.repoStandardsPath
      ? resolve(rootDir ?? process.cwd(), options.repoStandardsPath)
      : defaultRepoStandardsPath,
    authoritySettingsPath: options.authoritySettingsPath
      ? resolve(rootDir ?? process.cwd(), options.authoritySettingsPath)
      : defaultAuthoritySettingsPath,
  };
}

export async function generateVeritasReport(options = {}, defaults = {}, explicitFiles = []) {
  const { rootDir, repoMapPath, repoStandardsPath, authoritySettingsPath } = resolveVeritasPaths(options, defaults);

  if (!rootDir || !repoMapPath || !repoStandardsPath) {
    throw new Error(
      'Veritas report requires rootDir, repoMapPath, and repoStandardsPath',
    );
  }

  const reportInputs = resolveReportInputs(explicitFiles, options, rootDir);
  const files = reportInputs.files;

  if (files.length === 0 && reportInputs.sourceKind === 'explicit-files') {
    throw new Error('veritas report requires at least one file path');
  }

  const config = loadRepoMap(repoMapPath);
  const repoStandards = loadRepoStandards(repoStandardsPath);
  const evidenceCheckPlan = resolveEvidenceCheckPlan({
    files,
    config,
    rootDir,
    explicitEvidenceCheckCommand: options.explicitEvidenceCheckCommand,
  });
  const attestationStatus = options.includeAttestationGate
    ? inspectAttestationStatus(rootDir, {
        repoStandardsPath,
        repoMapPath,
        authoritySettingsPath,
        now: options.attestationNow ?? options.timestamp,
      })
    : null;
  const record = await buildEvidenceRecord({
    files,
    options: {
      ...options,
      sourceRef: reportInputs.sourceRef,
      sourceKind: reportInputs.sourceKind,
      sourceScope: reportInputs.sourceScope,
      evidenceCheckPlan,
      integritySources: {
        repoMapPath,
        repoStandardsPath,
        authoritySettingsPath,
      },
      ...(attestationStatus ? { governanceState: attestationStatus } : {}),
    },
    config,
    repoStandards,
    rootDir,
  });
  const artifactPath = writeEvidenceArtifact(record, config, rootDir);
  const relativeArtifactPath = relative(rootDir, artifactPath).replaceAll('\\', '/');
  const claimInputPaths = writeSurfaceClaimInputs(record, rootDir);
  const consoleReadModelPath = writeSurfaceConsoleReadModel(record, rootDir, {
    evidenceArtifactPath: relativeArtifactPath,
    claimInputPaths,
  });
  const markdownSummary = buildMarkdownSummary(record, relativeArtifactPath);
  const resolvedSummaryPath =
    options.summaryPath ??
    (config.evidence.reportTransport === 'github-step-summary'
      ? process.env.GITHUB_STEP_SUMMARY
      : undefined);

  if (resolvedSummaryPath) {
    appendFileSync(resolvedSummaryPath, markdownSummary, 'utf8');
  }

  return {
    rootDir,
    config,
    record,
    artifactPath: relativeArtifactPath,
    claimInputPaths,
    consoleReadModelPath,
    markdownSummary,
  };
}

export function resolveEvidenceCheckCommands({ repoMapPath, files = [], rootDir, explicitEvidenceCheckCommand }) {
  if (!repoMapPath || !rootDir) {
    return {
      evidenceCheckCommands: explicitEvidenceCheckCommand ? [explicitEvidenceCheckCommand] : [],
      evidenceChecks: explicitEvidenceCheckCommand ? evidenceCheckRecordsForCommands({ evidence: { evidenceChecks: [{ id: 'explicit-evidence-check', runner: 'bash', command: explicitEvidenceCheckCommand, method: 'validation' }] } }, [explicitEvidenceCheckCommand]) : [],
      resolutionSource: explicitEvidenceCheckCommand ? 'explicit' : 'none',
      affectedNodes: [],
      affectedEvidenceChecks: [],
      triggeredEvidenceChecks: [],
      unmatchedFiles: [],
      uncoveredPathPolicy: 'warn',
      uncoveredPathResult: 'clear',
    };
  }
  const config = loadRepoMap(repoMapPath);
  return resolveEvidenceCheckPlan({
    files,
    config,
    rootDir,
    explicitEvidenceCheckCommand,
  });
}

export {
  buildEvidenceRecord,
  formatTriState,
  listChangedFiles,
  listWorkingTreeFiles,
  parseBaselineCiFastStatus,
  resolveEvidenceCheckPlan,
  resolveReportInputs,
  resolveWorkstream,
  buildMarkdownSummary,
  feedbackStatusForPolicyResult,
  buildFeedbackSummary,
  feedbackHasFailures,
  buildStandardsFeedbackMarkdownSummary,
  buildStandardsFeedbackDraftMarkdownSummary,
  writeEvidenceArtifact,
  writeSurfaceClaimInputs,
};
