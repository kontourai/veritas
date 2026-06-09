import {
  readinessEvidenceCheckSummary,
  readinessIntegrityScope,
  readinessPolicyResultSummary,
  readinessSurfaceStatus,
  readinessTransparencyGapHints,
  readinessVerdict,
  readinessVerdictSummary,
} from './readiness.mjs';
import {
  surfaceClaimId,
  surfaceEvidence,
  surfaceEvent,
  surfaceSafeId,
} from './primitives.mjs';

function claimsByType(claimStore, claimType) {
  return claimStore.claims.filter((claim) => claim.claimType === claimType);
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

export function collectAffectedSurfaceEvidence(record, claimStore, evidence, events) {
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

export function collectEvidenceCheckEvidence(record, claimStore, evidence, events) {
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

export function collectPolicyResultEvidence(record, claimStore, evidence, events) {
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

export function collectExternalToolEvidence(record, claimStore, evidence, events) {
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

export function collectEvidenceInventoryEvidence(record, claimStore, evidence, events) {
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

export function collectReadinessCoverageEvidence(record, claimStore, evidence, events) {
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

export function collectReadinessVerdictEvidence(record, claimStore, evidence, events, authorityTraceRecords) {
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

export function buildReadinessAuthorityTrace(record) {
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
