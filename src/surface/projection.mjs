import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Surface from '@kontourai/surface';
import { relativeRepoPath } from '../paths.mjs';
import { SURFACE_TRUST_POLICIES } from './policies.mjs';
import { loadVeritasClaimStore } from '../claims/store.mjs';
import { registerVeritasExtension } from './extension.mjs';
import { loadPluginsFromConfig, collectPluginEvidence } from '../plugins/loader.mjs';

const SURFACE_SUPPORTS_EVIDENCE_EVALUATION = typeof Surface.loadClaimStore === 'function';
const SURFACE_SUPPORTS_EVIDENCE_EXECUTION = (() => {
  if (typeof Surface.validateTrustInput !== 'function') return false;
  try {
    Surface.validateTrustInput({
      schemaVersion: 3,
      source: 'veritas-capability-detect',
      claims: [{
        id: 'claim.execution-capability',
        subjectType: 'repository',
        subjectId: 'repo',
        surface: 'veritas.evidence-checks',
        claimType: 'software-evidence-check',
        fieldOrBehavior: 'evidenceCheck',
        value: true,
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      }],
      evidence: [{
        id: 'evidence.execution-capability',
        claimId: 'claim.execution-capability',
        evidenceType: 'test_output',
        method: 'validation',
        sourceRef: 'capability-detect',
        excerptOrSummary: 'capability detection',
        observedAt: '2026-05-20T00:00:00.000Z',
        collectedBy: 'veritas',
        execution: { runner: 'bash', label: 'true', exitCode: 0, durationMs: 0 },
      }],
      policies: [],
      events: [],
    });
    return true;
  } catch {
    return false;
  }
})();
const SURFACE_SUPPORTS_AUTHORITY_TRACE = (() => {
  if (typeof Surface.validateTrustInput !== 'function') return false;
  try {
    Surface.validateTrustInput({
      schemaVersion: 3,
      source: 'veritas-authority-trace-capability-detect',
      claims: [{
        id: 'claim.authority-trace-capability',
        subjectType: 'repository-change',
        subjectId: 'repo',
        surface: 'veritas.readiness',
        claimType: 'software-readiness-verdict',
        fieldOrBehavior: 'mergeReadiness',
        value: 'ready',
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z',
      }],
      evidence: [],
      policies: [],
      events: [],
      authorityTrace: [{
        id: 'authority.trace.capability',
        subject: { subjectType: 'repository-change', subjectId: 'repo' },
        actorRef: 'actor:veritas',
        authorityType: 'system',
        authorityRef: 'producer:veritas',
        sourceRef: 'capability-detect',
        observedAt: '2026-05-20T00:00:00.000Z',
        claimIds: ['claim.authority-trace-capability'],
      }],
    });
    return true;
  } catch {
    return false;
  }
})();

export async function buildSurfaceTrustInput(record, { rootDir = process.cwd(), adapterConfig = null } = {}) {
  registerVeritasExtension();
  if (adapterConfig) await loadPluginsFromConfig(adapterConfig, rootDir);
  const claimStore = loadVeritasClaimStore(rootDir);
  const effectiveClaimStore = withProjectedPolicyClaims(claimStore, record);
  const assembler = createSurfaceTrustInputAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 2,
  });
  const { claims, evidence, events, claimGroups, authorityTrace } = assembler;

  for (const definition of effectiveClaimStore.claims) {
    claims.push(claimDefToClaim(definition, record));
  }

  collectAffectedSurfaceEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceCheckEvidence(record, effectiveClaimStore, evidence, events);
  collectPolicyResultEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceInventoryEvidence(record, effectiveClaimStore, evidence, events);
  collectExternalToolEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessCoverageEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessVerdictEvidence(record, effectiveClaimStore, evidence, events, authorityTrace);
  collectGovernanceEvidence(record, effectiveClaimStore, evidence, events);
  collectRecommendationEvidence(record, effectiveClaimStore, evidence, rootDir);
  const policyClaimGroup = buildRepoStandardsClaimGroup(record, effectiveClaimStore);
  if (policyClaimGroup) claimGroups.push(policyClaimGroup);
  const pluginContext = {
    runId: record.run_id,
    sourceRef: record.source_ref,
    timestamp: record.timestamp,
    rootDir,
  };
  for (const item of collectPluginEvidence(claimStore, pluginContext)) {
    evidence.push(item);
  }

  try {
    return assembler.build(effectiveClaimStore.policies);
  } catch (error) {
    return throwSurfaceTrustInputValidationError({
      error,
      input: error.trustInputDraft,
      record,
      rootDir,
    });
  }
}

function withProjectedPolicyClaims(claimStore, record) {
  const claims = [...claimStore.claims];
  const policies = [...claimStore.policies];
  const existingIds = new Set(claims.map((claim) => claim.id));
  const existingPolicyIds = new Set(policies.map((policy) => policy.id));
  const readinessClaim = buildReadinessVerdictClaim(record);
  if (!existingIds.has(readinessClaim.id)) {
    claims.push(readinessClaim);
    existingIds.add(readinessClaim.id);
  }
  if (!existingPolicyIds.has(SURFACE_TRUST_POLICIES.readinessVerdict.id)) {
    policies.push(SURFACE_TRUST_POLICIES.readinessVerdict);
    existingPolicyIds.add(SURFACE_TRUST_POLICIES.readinessVerdict.id);
  }
  for (const result of record.policy_results ?? []) {
    const id = policyResultClaimId(record, result.rule_id);
    if (existingIds.has(id)) continue;
    const existing = claims.find((claim) =>
      claim.claimType === 'veritas-policy-result' &&
      (claim.metadata?.ruleId === result.rule_id || claim.fieldOrBehavior === result.rule_id || claim.subjectId.endsWith(`:${result.rule_id}`))
    );
    if (existing) continue;
    claims.push({
      id,
      surface: 'veritas.policy-results',
      claimType: 'veritas-policy-result',
      fieldOrBehavior: result.rule_id,
      subjectType: 'policy-rule',
      subjectId: `${record.adapter?.name ?? 'adapter'}:${record.repo_standards?.name ?? 'repo-standards'}:${result.rule_id}`,
      impactLevel: surfacePolicyImpact(result),
      verificationPolicyId: SURFACE_TRUST_POLICIES.policyResult.id,
      metadata: {
        projected: true,
        ruleId: result.rule_id,
        stage: result.stage,
        classification: result.classification,
        repoStandards: record.repo_standards?.name,
        adapter: record.adapter?.name,
      },
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
    });
    existingIds.add(id);
  }
  if ((record.policy_results ?? []).length > 0 && !existingPolicyIds.has(SURFACE_TRUST_POLICIES.policyResult.id)) {
    policies.push(SURFACE_TRUST_POLICIES.policyResult);
  }
  return { ...claimStore, claims, policies };
}

function buildReadinessVerdictClaim(record) {
  const verdict = readinessVerdict(record);
  return {
    id: surfaceClaimId(record.run_id, 'readiness-verdict', record.source_ref ?? 'source'),
    surface: 'veritas.readiness',
    claimType: 'software-readiness-verdict',
    fieldOrBehavior: 'mergeReadiness',
    subjectType: 'repository-change',
    subjectId: readinessSubjectId(record),
    value: {
      verdict,
      promotionAllowed: record.promotion_allowed,
      uncoveredPathResult: record.uncovered_path_result,
      sourceRef: record.integrity?.sourceRef ?? record.source_ref,
    },
    status: readinessSurfaceStatus(record),
    impactLevel: 'high',
    verificationPolicyId: SURFACE_TRUST_POLICIES.readinessVerdict.id,
    currentIntegrityRef: record.integrity?.sourceRef ?? record.source_ref,
    createdAt: record.timestamp,
    updatedAt: record.timestamp,
    metadata: {
      producer: 'veritas',
      source: 'readiness',
      sourceRef: record.source_ref,
      sourceKind: record.source_kind,
      sourceScope: record.source_scope,
      policyCoverage: {
        policyResultCount: record.policy_results?.length ?? 0,
        selectedEvidenceCheckCount: record.selected_evidence_checks?.length ?? 0,
        readinessCoveragePresent: Boolean(record.readiness_coverage),
      },
      integrity: readinessIntegrityScope(record),
      authorityTrace: buildReadinessAuthorityTrace(record),
    },
  };
}

function readinessSubjectId(record) {
  const producer = record.adapter?.name ?? record.repo_standards?.name ?? 'veritas';
  return `${surfaceSafeId(producer)}:${surfaceSafeId(record.integrity?.sourceRef ?? record.source_ref ?? record.run_id)}`;
}

function buildRepoStandardsClaimGroup(record, claimStore) {
  const results = record.policy_results ?? [];
  if (results.length === 0) return null;
  const claims = claimsByType(claimStore, 'veritas-policy-result');
  const requirements = results.map((result) => {
    const claim = claims.find((item) =>
      item.metadata?.ruleId === result.rule_id ||
      item.fieldOrBehavior === result.rule_id ||
      item.subjectId.endsWith(`:${result.rule_id}`)
    );
    if (!claim) return null;
    return {
      id: `veritas.requirement.${surfaceSafeId(result.rule_id)}`,
      title: result.rule_id,
      claimIds: [claim.id],
      required: result.stage === 'block',
      severity: surfacePolicyImpact(result),
      validationStrategy: {
        requiredEvidence: ['policy_rule'],
        requiredMethods: ['validation'],
        acceptanceCriteria: ['requirements evaluation'],
        reviewAuthority: 'veritas requirements',
        metadata: {
          ruleId: result.rule_id,
          stage: result.stage,
          classification: result.classification,
        },
      },
      metadata: {
        implemented: result.implemented,
        stage: result.stage,
        classification: result.classification,
      },
    };
  }).filter(Boolean);
  if (requirements.length === 0) return null;
  const repoStandardsId = surfaceSafeId(record.repo_standards?.name ?? 'repo-standards');
  return {
    id: `veritas.requirements.${repoStandardsId}`,
    title: record.repo_standards?.name ?? 'Veritas requirements',
    kind: 'requirement-set',
    description: 'Veritas requirements projected as Surface trust claims.',
    claimIds: requirements.flatMap((requirement) => requirement.claimIds),
    requirements,
    rollupPolicy: {
      mode: 'all-required',
      requiredRequirementIds: requirements.filter((requirement) => requirement.required).map((requirement) => requirement.id),
      optionalRequirementIds: requirements.filter((requirement) => !requirement.required).map((requirement) => requirement.id),
    },
    metadata: {
      producer: 'veritas',
      repoStandards: record.repo_standards,
      adapter: record.adapter,
    },
  };
}

function claimDefToClaim(definition, record) {
  return {
    ...definition,
    value: definition.value ?? definition.metadata?.value ?? defaultClaimValue(definition),
    currentIntegrityRef: record.integrity?.sourceRef ?? record.source_ref,
    updatedAt: record.timestamp ?? definition.updatedAt,
  };
}

function defaultClaimValue(definition) {
  if (definition.claimType === 'software-evidence-check') return 'all checks pass';
  return definition.fieldOrBehavior;
}

function fileIntegrityForNode(record, nodeId) {
  const fileRefs = record.integrity?.fileRefs ?? [];
  if (!fileRefs.length) return [];
  const nodeFiles = Object.entries(record.file_nodes ?? {})
    .filter(([, nodes]) => nodes.some((node) => node.id === nodeId))
    .map(([file]) => file);
  if (!nodeFiles.length) return [];
  const nodeFileSet = new Set(nodeFiles);
  return fileRefs.filter((ref) => nodeFileSet.has(ref.path));
}

function claimsByType(claimStore, claimType) {
  return claimStore.claims.filter((claim) => claim.claimType === claimType);
}

function collectAffectedSurfaceEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-affected-surface');
  for (const node of record.components ?? []) {
    const claim = candidates.find((item) => item.metadata?.nodeId === node || item.fieldOrBehavior === node || item.subjectId.endsWith(`:${node}`));
    if (!claim) continue;
    const evidenceId = `${record.run_id}.surface.${surfaceSafeId(node)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: 'components',
      summary: `Veritas marked ${node} as an affected work area for ${record.resolved_workstream}.`,
      metadata: {
        affectedNode: node,
        fileIntegrity: fileIntegrityForNode(record, node),
      },
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.surface.${surfaceSafeId(node)}.verified`,
      claimId: claim.id,
      status: 'verified',
      method: 'affected work area resolution',
      evidenceIds: [evidenceId],
      record,
    }));
  }
}

function collectEvidenceCheckEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'software-evidence-check');
  for (const evidenceCheck of record.selected_evidence_checks ?? []) {
    const label = evidenceCheck.label ?? evidenceCheck.command ?? evidenceCheck.id;
    const claim = candidates.find((item) =>
      item.metadata?.evidenceCheckId === evidenceCheck.id ||
      item.metadata?.command === evidenceCheck.command ||
      item.metadata?.label === label ||
      item.fieldOrBehavior === (evidenceCheck.command ?? label)
    );
    if (!claim) continue;
    const evidenceCheckResult = evidenceCheck.evidence_check_result ?? null;
    const passing = typeof evidenceCheckResult?.passed === 'boolean'
      ? evidenceCheckResult.passed
      : record.baseline_ci_fast_passed === null ? undefined : record.baseline_ci_fast_passed;
    const observedStatus = typeof passing === 'boolean' ? (passing ? 'passed' : 'failed') : 'not captured';
    const observedSummary = evidenceCheckResultSummary(evidenceCheckResult)
      ?? (typeof passing === 'boolean'
        ? (passing ? 'All evidence checks passed.' : 'Evidence checks failed.')
        : `Evidence Check selected but output was not captured: ${label}`);
    const evidenceId = `${record.run_id}.evidence-check.${surfaceSafeId(evidenceCheck.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'test_output',
      method: evidenceCheck.method ?? 'validation',
      record,
      locator: 'selected_evidence_checks',
      summary: observedSummary,
      passing,
      blocking: true,
      metadata: {
        evidenceCheckLabel: label,
        ...(evidenceCheck.command ? { command: evidenceCheck.command } : {}),
        expectedResult: 'all checks pass',
        observedResult: {
          expected: 'all checks pass',
          status: observedStatus,
          summary: observedSummary,
        },
        ...(evidenceCheckResult ? {
          commandOutput: {
            command: evidenceCheck.command ?? label,
            exitCode: evidenceCheckResult.exitCode,
            signal: evidenceCheckResult.signal,
            stdout: evidenceCheckResult.stdout ?? '',
            stderr: evidenceCheckResult.stderr ?? '',
            combined: `${evidenceCheckResult.stdout ?? ''}${evidenceCheckResult.stderr ?? ''}`,
          },
        } : {}),
        evidenceCheckResolutionSource: record.evidence_check_resolution_source,
        baselineCiFastPassed: typeof passing === 'boolean' ? passing : record.baseline_ci_fast_passed,
        evidenceCheckId: evidenceCheck.id,
        evidenceCheckRunner: evidenceCheck.runner ?? 'bash',
        surfaceClaimIds: evidenceCheck.surface_claim_ids ?? [],
      },
      execution: evidenceCheckResult ? {
        runner: evidenceCheckResult.runner ?? evidenceCheck.runner ?? 'bash',
        label,
        ...(evidenceCheckResult.exitCode !== null && evidenceCheckResult.exitCode !== undefined ? { exitCode: evidenceCheckResult.exitCode } : {}),
        ...(evidenceCheckResult.runner === 'mcp' ? { isError: evidenceCheckResult.isError ?? false } : {}),
        durationMs: evidenceCheckResult.durationMs,
      } : undefined,
    }));
    if (typeof passing === 'boolean') {
      events.push(surfaceEvent({
        id: `${record.run_id}.evidence-check.${surfaceSafeId(evidenceCheck.id)}.${passing ? 'verified' : 'rejected'}`,
        claimId: claim.id,
        status: passing ? 'verified' : 'rejected',
        method: label,
        evidenceIds: [evidenceId],
        record,
      }));
    }
  }
}

function evidenceCheckResultSummary(result) {
  if (!result) return null;
  if (result.passed) return 'All evidence checks passed.';
  if (result.runner === 'mcp') {
    const text = result.content?.find((content) => content.type === 'text')?.text;
    return text
      ? `MCP tool error: ${text.split('\n')[0]}`
      : 'MCP tool returned an error.';
  }
  const status = result.exitCode !== null && result.exitCode !== undefined
    ? `exit code ${result.exitCode}`
    : `signal ${result.signal ?? 'unknown'}`;
  const firstOutputLine = String(result.stderr || result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstOutputLine
    ? `Evidence checks failed with ${status}: ${firstOutputLine}`
    : `Evidence checks failed with ${status}.`;
}

function collectPolicyResultEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-policy-result');
  for (const result of record.policy_results ?? []) {
    const claim = candidates.find((item) => item.metadata?.ruleId === result.rule_id || item.fieldOrBehavior === result.rule_id || item.subjectId.endsWith(`:${result.rule_id}`));
    if (!claim) continue;
    const status = surfacePolicyResultStatus(result);
    const impactLevel = surfacePolicyImpact(result);
    const evidenceId = `${record.run_id}.policy.${surfaceSafeId(result.rule_id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'validation',
      record,
      locator: `policy_results.${result.rule_id}`,
      summary: result.summary ?? result.message ?? `Policy ${result.rule_id} evaluated.`,
      passing: result.passed,
      blocking: result.stage === 'block',
      metadata: {
        stage: result.stage,
        classification: result.classification,
        implemented: result.implemented,
        passed: result.passed,
        transparencyGapHints: result.passed === false ? [{
          type: 'policy_violation',
          severity: impactLevel,
          message: result.message,
          blocking: result.stage === 'block',
        }] : [],
      },
    }));
    if (status !== 'proposed') {
      events.push(surfaceEvent({
        id: `${record.run_id}.policy.${surfaceSafeId(result.rule_id)}.${status}`,
        claimId: claim.id,
        status,
        method: 'requirements evaluation',
        evidenceIds: [evidenceId],
        record,
        notes: result.message,
      }));
    }
  }
}

function collectExternalToolEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-external-tool-result');
  for (const result of record.external_tool_results ?? []) {
    const claim = candidates.find((item) => item.metadata?.tool === result.tool || item.metadata?.evidenceCheckId === result.evidence_check_id);
    if (!claim) continue;
    const status = surfaceExternalToolStatus(result);
    const evidenceId = `${record.run_id}.external-tool.${surfaceSafeId(`${result.tool}-${result.evidence_check_id}`)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'test_output',
      method: 'auditability',
      record,
      locator: result.artifact_path,
      summary: `${result.tool} reported ${result.verdict} for evidenceCheck ${result.evidence_check_id}.`,
      passing: result.verdict === 'pass',
      blocking: result.blocking !== false,
      metadata: {
        externalToolResult: result,
        transparencyGapHints: status === 'verified' ? [] : [{
          type: result.blocking ? 'policy_violation' : 'provenance_gap',
          severity: result.blocking ? 'high' : 'medium',
          message: `${result.tool} verdict is ${result.verdict}.`,
          blocking: result.blocking !== false,
        }],
      },
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.external-tool.${surfaceSafeId(`${result.tool}-${result.evidence_check_id}`)}.${status}`,
      claimId: claim.id,
      status,
      method: result.command,
      evidenceIds: [evidenceId],
      record,
      notes: `${result.tool} ${result.format} verdict: ${result.verdict}`,
    }));
  }
}

function collectEvidenceInventoryEvidence(record, claimStore, evidence, events) {
  const candidates = claimsByType(claimStore, 'veritas-evidence-inventory');
  for (const suite of record.evidence_inventory_results ?? []) {
    const claim = candidates.find((item) => item.metadata?.suiteId === suite.id || item.fieldOrBehavior === suite.id);
    if (!claim) continue;
    const status = surfaceEvidenceInventoryStatus(suite);
    const evidenceId = `${record.run_id}.evidence-inventory.${surfaceSafeId(suite.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'validation',
      record,
      locator: suite.manifest_path,
      summary: surfaceEvidenceInventorySummary(suite),
      metadata: {
        suiteId: suite.id,
        evidenceCheckId: suite.evidence_check_id,
        owner: suite.owner,
        selected: suite.selected,
        recentCatchEvidence: suite.recent_catch_evidence,
        evidenceBasis: suite.evidence_basis,
        freshnessStatus: suite.freshness_status,
        transparencyGapHints: surfaceEvidenceInventoryTransparencyGapHints(suite),
      },
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.evidence-inventory.${surfaceSafeId(suite.id)}.${status}`,
      claimId: claim.id,
      status,
      method: 'evidence inventory',
      evidenceIds: [evidenceId],
      record,
      verifiedAt: isoDateTimeOrUndefined(suite.last_reviewed),
      notes: suite.rationale,
    }));
  }
}

function collectReadinessCoverageEvidence(record, claimStore, evidence, events) {
  if (!record.readiness_coverage) return;
  const claim = claimsByType(claimStore, 'veritas-readiness-coverage')[0];
  if (!claim) return;
  const staleCount = record.readiness_coverage.stale_or_unknown_inventory_ids?.length ?? 0;
  const status = staleCount > 0 ? 'disputed' : 'verified';
  const evidenceId = `${record.run_id}.readiness-coverage.evidence`;
  evidence.push(surfaceEvidence({
    id: evidenceId,
    claimId: claim.id,
    type: 'policy_rule',
    method: 'auditability',
    record,
    locator: 'readiness_coverage',
    summary: record.readiness_coverage.recommendation,
    passing: staleCount === 0,
    blocking: staleCount > 0,
    metadata: {
      readinessCoverage: record.readiness_coverage,
      transparencyGapHints: staleCount > 0 ? [{
        type: 'freshness_breach',
        severity: 'high',
        message: record.readiness_coverage.recommendation,
      }] : [],
    },
  }));
  events.push(surfaceEvent({
    id: `${record.run_id}.readiness-coverage.${status}`,
    claimId: claim.id,
    status,
    method: 'readiness coverage',
    evidenceIds: [evidenceId],
    record,
    notes: record.readiness_coverage.recommendation,
  }));
}

function collectReadinessVerdictEvidence(record, claimStore, evidence, events, authorityTraceRecords) {
  const claim = claimsByType(claimStore, 'software-readiness-verdict')
    .find((item) => item.id === surfaceClaimId(record.run_id, 'readiness-verdict', record.source_ref ?? 'source'));
  if (!claim) return;
  const status = readinessSurfaceStatus(record);
  const evidenceId = `${record.run_id}.readiness-verdict.evidence`;
  const authorityTrace = buildReadinessAuthorityTrace(record);
  const firstClassAuthorityTrace = buildReadinessAuthorityTraceRecord(record, claim, evidenceId);
  authorityTraceRecords.push(firstClassAuthorityTrace);
  evidence.push(surfaceEvidence({
    id: evidenceId,
    claimId: claim.id,
    type: 'policy_rule',
    method: 'validation',
    record,
    locator: 'readiness',
    summary: readinessVerdictSummary(record),
    passing: status === 'verified',
    blocking: status !== 'verified',
    metadata: {
      readinessVerdict: readinessVerdict(record),
      readinessStatus: status,
      promotionAllowed: record.promotion_allowed,
      uncoveredPathResult: record.uncovered_path_result,
      policyResults: readinessPolicyResultSummary(record),
      evidenceChecks: readinessEvidenceCheckSummary(record),
      integrity: readinessIntegrityScope(record),
      authorityTrace,
      transparencyGapHints: readinessTransparencyGapHints(record),
    },
  }));
  events.push(surfaceEvent({
    id: `${record.run_id}.readiness-verdict.${status}`,
    claimId: claim.id,
    status,
    method: 'readiness verdict',
    evidenceIds: [evidenceId],
    record,
    notes: readinessVerdictSummary(record),
  }));
}

function readinessVerdict(record) {
  if (record.promotion_allowed === true) return 'ready';
  if (readinessHasBlockingFailure(record)) return 'not-ready';
  return 'needs-review';
}

function readinessSurfaceStatus(record) {
  if (record.promotion_allowed === true) return 'verified';
  if (readinessHasBlockingFailure(record)) return 'rejected';
  return 'disputed';
}

function readinessHasBlockingFailure(record) {
  if (record.uncovered_path_result === 'fail') return true;
  if ((record.policy_results ?? []).some((result) => result.passed === false && result.stage === 'block')) return true;
  if ((record.selected_evidence_checks ?? []).some((check) => check.evidence_check_result?.passed === false)) return true;
  if ((record.external_tool_results ?? []).some((result) => result.blocking !== false && ['fail', 'missing'].includes(result.verdict))) return true;
  return false;
}

function readinessVerdictSummary(record) {
  const verdict = readinessVerdict(record);
  if (verdict === 'ready') return 'Veritas readiness verdict is ready for the evaluated repository change.';
  if (verdict === 'not-ready') return 'Veritas readiness verdict is not ready because blocking requirements or evidence failed.';
  return 'Veritas readiness verdict needs review because readiness could not be fully verified.';
}

function readinessPolicyResultSummary(record) {
  const results = record.policy_results ?? [];
  return {
    total: results.length,
    failedBlocking: results.filter((result) => result.passed === false && result.stage === 'block').map((result) => result.rule_id),
    warnings: results.filter((result) => result.passed === false && result.stage !== 'block').map((result) => result.rule_id),
  };
}

function readinessEvidenceCheckSummary(record) {
  const checks = record.selected_evidence_checks ?? [];
  return {
    selected: checks.map((check) => check.id),
    failed: checks.filter((check) => check.evidence_check_result?.passed === false).map((check) => check.id),
    baselineCiFastPassed: record.baseline_ci_fast_passed,
  };
}

function readinessIntegrityScope(record) {
  return {
    sourceRef: record.integrity?.sourceRef ?? record.source_ref,
    sourceKind: record.integrity?.sourceKind ?? record.source_kind,
    sourceScope: record.integrity?.sourceScope ?? record.source_scope ?? [],
    fileRefs: record.integrity?.fileRefs ?? [],
    configRefs: record.integrity?.configRefs ?? {},
  };
}

function readinessTransparencyGapHints(record) {
  const hints = [];
  for (const ruleId of readinessPolicyResultSummary(record).failedBlocking) {
    hints.push({
      type: 'policy_violation',
      severity: 'high',
      message: `Blocking readiness requirement failed: ${ruleId}.`,
      blocking: true,
    });
  }
  if (record.uncovered_path_result === 'fail') {
    hints.push({
      type: 'policy_violation',
      severity: 'high',
      message: 'Changed files were outside configured work areas and uncovered path policy is fail.',
      blocking: true,
    });
  }
  if (!record.governance_state || record.governance_state.state === 'missing') {
    hints.push({
      type: 'provenance_gap',
      severity: 'medium',
      message: 'No active governance attestation was available; Veritas used producer authority fallback.',
    });
  }
  return hints;
}

function buildReadinessAuthorityTrace(record) {
  const governanceState = record.governance_state;
  const actor = governanceState?.attestation?.actor ?? process.env.VERITAS_ACTOR ?? record.owner ?? 'veritas';
  const protectedStandards = governanceState?.protectedStandards ?? null;
  return {
    kind: governanceState?.attestation ? 'governance-attestation' : 'producer-fallback',
    producer: 'veritas',
    actor,
    method: governanceState?.attestation ? 'attestation' : 'readiness-producer',
    sourceRef: record.integrity?.sourceRef ?? record.source_ref,
    currentAttestationId: governanceState?.currentAttestationId ?? null,
    attestationState: governanceState?.state ?? 'absent',
    validUntil: governanceState?.validUntil ?? null,
    protectedStandards: protectedStandards ? {
      paths: protectedStandards.paths ?? {},
      hashes: protectedStandards.hashes ?? {},
      drift: governanceState?.drift ?? [],
    } : null,
  };
}

function buildReadinessAuthorityTraceRecord(record, claim, evidenceId) {
  const governanceState = record.governance_state;
  const metadataTrace = buildReadinessAuthorityTrace(record);
  const attestationActor = governanceState?.attestation?.actor;
  const actorRef = attestationActor
    ? `actor:${surfaceSafeId(attestationActor)}`
    : `system:${surfaceSafeId(process.env.VERITAS_ACTOR ?? record.owner ?? 'veritas')}`;
  const authorityRef = governanceState?.currentAttestationId
    ? `attestation:${surfaceSafeId(governanceState.currentAttestationId)}`
    : 'producer:veritas';
  return {
    id: `${claim.id}.authority`,
    subject: {
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
    },
    actorRef,
    authorityType: governanceState?.attestation ? 'credential' : 'system',
    authorityRef,
    sourceRef: record.integrity?.sourceRef ?? record.source_ref ?? record.run_id,
    observedAt: record.timestamp,
    evidenceIds: [evidenceId],
    claimIds: [claim.id],
    validUntil: governanceState?.validUntil ?? undefined,
    integrityRef: record.integrity?.sourceRef ?? record.source_ref,
    metadata: metadataTrace,
  };
}

function collectGovernanceEvidence(record, claimStore, evidence, events) {
  const claims = claimsByType(claimStore, 'veritas-governance-artifact');
  if (!record.governance_state || claims.length === 0) return;
  const status = governanceAttestationStatus(record.governance_state);
  for (const claim of claims) {
    const attestationEvidenceId = `${record.run_id}.governance.${surfaceSafeId(claim.id)}.attestation.evidence`;
    const auditEvidenceId = `${record.run_id}.governance.${surfaceSafeId(claim.id)}.audit.evidence`;
    evidence.push(surfaceEvidence({
      id: attestationEvidenceId,
      claimId: claim.id,
      type: 'attestation',
      method: 'attestation',
      record,
      locator: '.veritas/attestations',
      summary: `Authority-backed attestation currency is ${status} for Protected Standards state ${record.governance_state.state}.`,
      passing: status === 'verified',
      blocking: status !== 'verified',
    }));
    evidence.push(surfaceEvidence({
      id: auditEvidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: 'governance_state',
      summary: `Veritas inspected Protected Standards state ${record.governance_state.state} for ${claim.fieldOrBehavior}.`,
      passing: status === 'verified',
      blocking: status !== 'verified',
    }));
    events.push(surfaceEvent({
      id: `${record.run_id}.governance.${surfaceSafeId(claim.id)}.${status}`,
      claimId: claim.id,
      status,
      method: 'authority attestation status',
      evidenceIds: [attestationEvidenceId, auditEvidenceId],
      record,
      notes: `Authority-backed attestation currency is ${status}.`,
      verifiedAt: status === 'verified' ? record.timestamp : undefined,
    }));
  }
}

function collectRecommendationEvidence(record, claimStore, evidence, rootDir) {
  const candidates = claimsByType(claimStore, 'veritas-recommendation');
  for (const recommendation of readOpenRecommendationSummaries(rootDir)) {
    const claim = candidates.find((item) => item.metadata?.recommendationId === recommendation.id || item.subjectId === recommendation.id);
    if (!claim) continue;
    const evidenceId = `${record.run_id}.recommendation.${surfaceSafeId(recommendation.id)}.evidence`;
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: claim.id,
      type: 'policy_rule',
      method: 'auditability',
      record,
      locator: `.veritas/recommendations/${recommendation.id}.recommendation.json`,
      summary: recommendation.rationale,
      metadata: {
        recommendationType: recommendation.type,
        recommendationTarget: recommendation.target,
      },
    }));
  }
}

export function buildGovernanceArtifactClaims({
  record,
  claims,
  evidence,
  events,
  attestationPolicyClaimId,
}) {
  const governanceState = record.governance_state;
  if (!governanceState) return;

  const artifacts = [
    {
      key: 'repo-standards',
      hashField: 'repoStandardsHash',
      subjectId: record.repo_standards?.name ?? 'repo-standards',
      path: governanceState.protectedStandards?.paths?.repoStandardsPath,
      currentHash: governanceState.protectedStandards?.hashes?.repoStandardsHash,
      attestedHash: governanceState.attestation?.repoStandardsHash,
      applicability: 'policy-results',
    },
    {
      key: 'adapter',
      hashField: 'adapterHash',
      subjectId: record.adapter?.name ?? 'adapter',
      path: governanceState.protectedStandards?.paths?.adapterPath,
      currentHash: governanceState.protectedStandards?.hashes?.adapterHash,
      attestedHash: governanceState.attestation?.adapterHash,
      applicability: record.uncovered_path_result === 'clear' ? 'covered' : record.uncovered_path_result,
    },
    {
      key: 'team-profile',
      hashField: 'teamProfileHash',
      subjectId: record.owner ?? 'team-profile',
      path: governanceState.protectedStandards?.paths?.teamProfilePath,
      currentHash: governanceState.protectedStandards?.hashes?.teamProfileHash,
      attestedHash: governanceState.attestation?.teamProfileHash,
      applicability: 'governance-actor-context',
    },
  ];

  for (const artifact of artifacts) {
    const drift = governanceState.drift?.find((item) => item.field === artifact.hashField);
    const status = governanceArtifactStatus(governanceState, drift);
    const id = surfaceClaimId(record.run_id, 'governance-artifact', artifact.key);
    const evidenceId = `${id}.evidence`;
    claims.push({
      id,
      subjectType: 'veritas-governance-artifact',
      subjectId: `${artifact.key}:${artifact.subjectId}`,
      surface: 'veritas.governance-artifacts',
      claimType: 'veritas-governance-artifact',
      fieldOrBehavior: artifact.key === 'adapter' ? 'integrityAndApplicability' : 'integrityAndCurrentness',
      value: {
        artifact: artifact.key,
        path: artifact.path,
        currentHash: drift?.current ?? artifact.currentHash,
        attestedHash: drift?.attested ?? artifact.attestedHash ?? null,
        attestationState: governanceState.state,
        expired: governanceState.expired,
        applicability: artifact.applicability,
      },
      status,
      createdAt: record.timestamp,
      updatedAt: record.timestamp,
      impactLevel: 'high',
      currentIntegrityRef: drift?.current ?? artifact.currentHash ?? record.source_ref,
      derivedFrom: attestationPolicyClaimId ? [attestationPolicyClaimId] : undefined,
      verificationPolicyId: SURFACE_TRUST_POLICIES.governanceArtifact.id,
      confidenceBasis: {
        sourceQuality: status === 'verified' ? 'strong' : 'moderate',
        reviewerAuthority: governanceState.attestation?.actor ? 'authority' : 'none',
        evidenceStrength: status === 'verified' ? 'strong' : 'weak',
        conflictCount: status === 'verified' ? 0 : 1,
        impactLevel: 'high',
      },
      metadata: {
        source: 'Protected Standards hash inspection',
        currentAttestationId: governanceState.currentAttestationId,
        drift: drift ?? null,
        protectedStandardsError: governanceState.protectedStandards?.error,
      },
    });
    evidence.push(surfaceEvidence({
      id: evidenceId,
      claimId: id,
      type: 'attestation',
      method: 'auditability',
      record,
      locator: artifact.path ?? 'governance_state',
      summary: governanceArtifactSummary(artifact.key, status, governanceState),
      metadata: {
        governanceArtifact: artifact.key,
        attestationState: governanceState.state,
        transparencyGapHints: status === 'verified' ? [] : [{
          type: status === 'stale' ? 'freshness_breach' : 'provenance_gap',
          severity: 'high',
          message: governanceArtifactSummary(artifact.key, status, governanceState),
        }],
      },
    }));
    events.push(surfaceEvent({
      id: `${id}.${status}`,
      claimId: id,
      status,
      method: 'Protected Standards hash inspection',
      evidenceIds: [evidenceId],
      record,
      notes: governanceArtifactSummary(artifact.key, status, governanceState),
    }));
  }

  const status = governanceAttestationStatus(governanceState);
  const id = surfaceClaimId(record.run_id, 'governance-attestation', governanceState.currentAttestationId ?? governanceState.state);
  const evidenceId = `${id}.evidence`;
  claims.push({
    id,
    subjectType: 'veritas-human-attestation',
    subjectId: governanceState.currentAttestationId ?? 'missing',
    surface: 'veritas.attestations',
    claimType: 'veritas-governance-artifact',
    fieldOrBehavior: 'attestationCurrency',
    value: {
      state: governanceState.state,
      currentAttestationId: governanceState.currentAttestationId,
      ageDays: governanceState.ageDays,
      validUntil: governanceState.validUntil,
      expired: governanceState.expired,
    },
    status,
    createdAt: record.timestamp,
    updatedAt: record.timestamp,
    impactLevel: 'high',
    currentIntegrityRef: governanceState.currentAttestationId ?? record.source_ref,
    derivedFrom: attestationPolicyClaimId ? [attestationPolicyClaimId] : undefined,
    verificationPolicyId: SURFACE_TRUST_POLICIES.governanceArtifact.id,
    confidenceBasis: {
      sourceQuality: governanceState.attestation ? 'strong' : 'weak',
      reviewerAuthority: governanceState.attestation?.actor ? 'human' : 'none',
      evidenceStrength: status === 'verified' ? 'strong' : 'weak',
      conflictCount: status === 'verified' ? 0 : 1,
      impactLevel: 'high',
    },
    metadata: {
      pending: governanceState.pending,
      drift: governanceState.drift,
    },
  });
  evidence.push(surfaceEvidence({
    id: evidenceId,
    claimId: id,
    type: 'attestation',
    method: 'attestation',
    record,
    locator: '.veritas/attestations',
    summary: `Authority-backed attestation currency is ${status} for Protected Standards state ${governanceState.state}.`,
  }));
  events.push(surfaceEvent({
    id: `${id}.${status}`,
    claimId: id,
    status,
    method: 'authority attestation status',
    evidenceIds: [evidenceId],
    record,
    notes: `Authority-backed attestation currency is ${status}.`,
    verifiedAt: status === 'verified' ? record.timestamp : undefined,
  }));
}

function governanceArtifactStatus(governanceState, drift) {
  if (drift) return 'disputed';
  if (governanceState.state === 'drifted' || governanceState.state === 'broken-head') return 'verified';
  if (governanceState.state === 'missing' || governanceState.state === 'pending') return 'disputed';
  return 'verified';
}

function governanceAttestationStatus(governanceState) {
  if (governanceState.state === 'drifted' || governanceState.state === 'broken-head') return 'disputed';
  if (governanceState.state === 'missing' || governanceState.state === 'pending') return 'disputed';
  if (governanceState.expired) return 'stale';
  return 'verified';
}

function governanceArtifactSummary(artifact, status, governanceState) {
  if (status === 'disputed') {
    return `${artifact} governance state is disputed because attestation state is ${governanceState.state}.`;
  }
  if (status === 'stale') {
    return `${artifact} governance state is stale because the active attestation expired.`;
  }
  return `${artifact} governance state matches the active Protected Standards attestation.`;
}

export function validateSurfaceTrustInputAtBoundary({ input, record, rootDir }) {
  if (process.env.VERITAS_SKIP_SURFACE_VALIDATION === '1') {
    process.stderr.write('WARN: VERITAS_SKIP_SURFACE_VALIDATION=1 — this is intended as a short-lived escape hatch; remove once the underlying fixture is fixed.\n');
    return input;
  }
  try {
    return Surface.validateTrustInput(input);
  } catch (error) {
    return throwSurfaceTrustInputValidationError({ error, input, record, rootDir });
  }
}

export function throwSurfaceTrustInputValidationError({ error, input, record, rootDir }) {
  const failureDir = resolve(rootDir, '.veritas/external/surface-validation-failures');
  mkdirSync(failureDir, { recursive: true });
  const failurePath = resolve(failureDir, `${surfaceSafeId(record.run_id)}.json`);
  writeFileSync(failurePath, `${JSON.stringify(input ?? {}, null, 2)}\n`, 'utf8');
  const validationError = new Error(
    `Surface TrustInput validation failed: ${error.message}. Rejected input: ${relativeRepoPath(rootDir, failurePath)}`,
  );
  validationError.exitCode = 2;
  throw validationError;
}

export function buildSurfaceTrustReportSummary({ input, record }) {
  const report = Surface.buildTrustReport(input, {
    id: `veritas.${surfaceSafeId(record.run_id)}.surface-report`,
    now: new Date(record.timestamp),
  });
  return summarizeSurfaceTrustReport(report);
}

export function buildSurfaceTrustInputWithPublicApi(input) {
  if (typeof Surface.TrustInputBuilder !== 'function') {
    throw new Error('Surface TrustInputBuilder public API is required by Veritas projection.');
  }
  const builder = new Surface.TrustInputBuilder({
    source: input.source,
    schemaVersion: input.schemaVersion,
  });
  for (const claim of input.claims) builder.addClaim(claim);
  for (const policy of input.policies) builder.addPolicy(policy);
  for (const item of input.evidence) builder.addEvidence(item).linkTo(item.claimId);
  for (const event of input.events) builder.addEvent(event);
  for (const link of input.identityLinks ?? []) builder.addIdentityLink(link);
  for (const claimGroup of input.claimGroups ?? []) {
    if (typeof builder.addClaimGroup === 'function') builder.addClaimGroup(claimGroup);
  }
  return builder.build();
}

export function createSurfaceTrustInputAssembler({ source, schemaVersion }) {
  if (typeof Surface.TrustInputBuilder !== 'function') {
    throw new Error('Surface TrustInputBuilder public API is required by Veritas projection.');
  }
  const builder = new Surface.TrustInputBuilder({ source, schemaVersion });
  const draft = {
    schemaVersion,
    source,
    claims: [],
    evidence: [],
    policies: [],
    events: [],
    claimGroups: [],
    authorityTrace: [],
  };
  return {
    claims: {
      push: (...items) => {
        for (const item of items) {
          draft.claims.push(item);
          builder.addClaim(item);
        }
        return items.length;
      },
    },
    evidence: {
      push: (...items) => {
        for (const item of items) {
          const index = draft.evidence.findIndex((existing) => existing.id === item.id);
          if (index >= 0) draft.evidence[index] = item;
          else draft.evidence.push(item);
          builder.addEvidence(item).linkTo(item.claimId);
        }
        return items.length;
      },
    },
    events: {
      push: (...items) => {
        for (const item of items) {
          draft.events.push(item);
          builder.addEvent(item);
        }
        return items.length;
      },
    },
    claimGroups: {
      push: (...items) => {
        for (const item of items) {
          draft.claimGroups.push(item);
          if (typeof builder.addClaimGroup === 'function') builder.addClaimGroup(item);
        }
        return items.length;
      },
    },
    authorityTrace: {
      push: (...items) => {
        draft.authorityTrace.push(...items);
        return items.length;
      },
    },
    build: (policies) => {
      for (const policy of policies) {
        draft.policies.push(policy);
        builder.addPolicy(policy);
      }
      try {
        const input = builder.build();
        if (SURFACE_SUPPORTS_AUTHORITY_TRACE && draft.authorityTrace.length > 0) {
          return Surface.validateTrustInput({
            ...input,
            authorityTrace: [...draft.authorityTrace],
          });
        }
        return input;
      } catch (error) {
        error.trustInputDraft = {
          ...draft,
          claims: [...draft.claims],
          evidence: [...draft.evidence],
          policies: [...draft.policies],
          events: [...draft.events],
          claimGroups: [...draft.claimGroups],
          ...(SURFACE_SUPPORTS_AUTHORITY_TRACE ? { authorityTrace: [...draft.authorityTrace] } : {}),
        };
        throw error;
      }
    },
  };
}

export function summarizeSurfaceTrustReport(report) {
  const transparencyGapsByClaimId = new Map();
  for (const transparencyGap of report.transparencyGaps ?? []) {
    const entries = transparencyGapsByClaimId.get(transparencyGap.claimId) ?? [];
    entries.push({
      id: transparencyGap.id,
      type: transparencyGap.type,
      severity: transparencyGap.severity,
      message: transparencyGap.message,
      policyId: transparencyGap.policyId,
    });
    transparencyGapsByClaimId.set(transparencyGap.claimId, entries);
  }
  return {
    id: report.id,
    generatedAt: report.generatedAt,
    source: report.source,
    summary: report.summary,
    claims: report.claims.map((claim) => ({
      id: claim.id,
      status: claim.status,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      surface: claim.surface,
      claimType: claim.claimType,
      fieldOrBehavior: claim.fieldOrBehavior,
      value: claim.value,
      verificationPolicyId: claim.verificationPolicyId,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
      currentIntegrityRef: claim.currentIntegrityRef,
    })),
    transparencyGaps: report.transparencyGaps.map((transparencyGap) => ({
      id: transparencyGap.id,
      claimId: transparencyGap.claimId,
      type: transparencyGap.type,
      severity: transparencyGap.severity,
      message: transparencyGap.message,
      policyId: transparencyGap.policyId,
      createdAt: transparencyGap.createdAt,
      evidenceIds: transparencyGap.evidenceIds,
    })),
    transparencyGapsByClaimId: Object.fromEntries(transparencyGapsByClaimId.entries()),
    claimGroupRollups: report.claimGroupRollups ?? [],
  };
}

export function surfaceEvidence({ id, claimId, type, method, record, locator, summary, passing, blocking, metadata = {}, execution }) {
  const evidenceIntegrity = metadata.fileIntegrity
    ? { ...(record.integrity ?? {}), fileRefs: metadata.fileIntegrity }
    : record.integrity;
  return {
    id,
    claimId,
    evidenceType: type,
    method,
    sourceRef: record.run_id,
    sourceLocator: locator,
    excerptOrSummary: summary,
    observedAt: record.timestamp,
    collectedBy: 'veritas',
    integrityRef: record.integrity?.sourceRef ?? record.source_ref,
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof passing === 'boolean' ? { passing } : {}),
    ...(SURFACE_SUPPORTS_EVIDENCE_EVALUATION && typeof blocking === 'boolean' ? { blocking } : {}),
    ...(SURFACE_SUPPORTS_EVIDENCE_EXECUTION && execution ? { execution } : {}),
    metadata: {
      sourceKind: record.source_kind,
      sourceScope: record.source_scope,
      files: record.files ?? [],
      unresolvedFiles: record.unresolved_files ?? [],
      integrity: evidenceIntegrity ?? null,
      fileIntegrity: metadata.fileIntegrity ?? record.integrity?.fileRefs ?? [],
      configIntegrity: record.integrity?.configRefs ?? {},
      ...metadata,
    },
  };
}

export function surfaceEvent({ id, claimId, status, method, evidenceIds, record, notes, verifiedAt }) {
  return {
    id,
    claimId,
    status,
    actor: 'veritas',
    method,
    evidenceIds,
    createdAt: record.timestamp,
    verifiedAt: status === 'verified' ? (verifiedAt ?? record.timestamp) : undefined,
    notes,
  };
}

export function surfacePolicyResultStatus(result) {
  if (result.passed === true) return 'verified';
  if (result.passed === false && result.stage === 'block') return 'rejected';
  if (result.passed === false) return 'disputed';
  return 'proposed';
}

export function surfacePolicyImpact(result) {
  if (result.stage === 'block' || result.classification === 'hard-invariant') return 'high';
  if (result.stage === 'warn') return 'medium';
  return 'low';
}

export function surfaceEvidenceInventoryStatus(suite) {
  if (suite.freshness_status === 'stale' || suite.freshness_status === 'review-needed') return 'stale';
  if (suite.freshness_status === 'retiring' || suite.disposition === 'retire') return 'superseded';
  if (suite.blocking_status === 'rejected') return 'rejected';
  if (suite.blocking_status === 'disputed') return 'disputed';
  if (suite.disposition === 'required' && suite.recent_catch_evidence !== 'unknown') return 'verified';
  return 'proposed';
}

export function surfaceEvidenceInventoryImpact(suite) {
  if (suite.regression_severity === 'critical') return 'critical';
  if (suite.regression_severity === 'high' || suite.verification_weight === 'blocking' || suite.blocking_status === 'required') return 'high';
  if (suite.regression_severity === 'low' || suite.verification_weight === 'informational') return 'low';
  return 'medium';
}

export function surfaceEvidenceInventoryStrength(suite) {
  if (suite.recent_catch_evidence === 'unknown' || suite.evidence_basis === 'unknown') return 'weak';
  if (suite.disposition === 'required' && suite.freshness_status === 'current') return 'strong';
  return 'moderate';
}

export function surfaceEvidenceInventorySummary(suite) {
  const rationale = suite.rationale ? ` ${suite.rationale}` : '';
  return `Evidence inventory ${suite.id} is ${suite.disposition} / ${suite.blocking_status}; freshness ${suite.freshness_status}; evidence ${suite.evidence_basis}.${rationale}`;
}

export function surfaceExternalToolStatus(result) {
  if (result.verdict === 'pass') return 'verified';
  if (result.blocking && (result.verdict === 'fail' || result.verdict === 'missing')) return 'rejected';
  if (result.verdict === 'fail' || result.verdict === 'warn' || result.verdict === 'missing') return 'disputed';
  return 'proposed';
}

export function surfaceEvidenceInventoryTransparencyGapHints(suite) {
  const hints = [];
  if (suite.freshness_status === 'stale' || suite.freshness_status === 'review-needed' || suite.freshness_status === 'retiring') {
    hints.push({
      type: 'freshness_breach',
      severity: surfaceEvidenceInventoryImpact(suite),
      message: `Evidence inventory ${suite.id} freshness is ${suite.freshness_status}.`,
    });
  }
  if (suite.recent_catch_evidence === 'unknown' || suite.evidence_basis === 'unknown') {
    hints.push({
      type: 'provenance_gap',
      severity: surfaceEvidenceInventoryImpact(suite),
      message: `Evidence inventory ${suite.id} has weak or unknown catch evidence.`,
    });
  }
  return hints;
}

export function isoDateTimeOrUndefined(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return value;
  return undefined;
}

export function surfaceClaimId(runId, group, value) {
  return `veritas.${surfaceSafeId(runId)}.${group}.${surfaceSafeId(value)}`;
}

export function policyResultClaimId(record, ruleId) {
  return [
    'veritas',
    'policy',
    surfaceSafeId(record.adapter?.name ?? 'adapter'),
    surfaceSafeId(record.repo_standards?.name ?? 'repo-standards'),
    surfaceSafeId(ruleId),
  ].join('.');
}

export function surfaceSafeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function readOpenRecommendationSummaries(rootDir) {
  const dir = resolve(rootDir, '.veritas/recommendations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.recommendation.json'))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((recommendation) => recommendation?.status === 'proposed');
}
