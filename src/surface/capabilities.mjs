import * as Surface from '@kontourai/surface';

export const SURFACE_SUPPORTS_EVIDENCE_EVALUATION = typeof Surface.loadClaimStore === 'function';

export const SURFACE_SUPPORTS_EVIDENCE_EXECUTION = (() => {
  if (typeof Surface.validateTrustBundle !== 'function') return false;
  try {
    Surface.validateTrustBundle({
      schemaVersion: 5,
      source: 'veritas-capability-detect',
      claims: [{
        id: 'claim.execution-capability',
        subjectType: 'repository',
        subjectId: 'repo',
        facet: 'veritas.evidence-checks',
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

export const SURFACE_SUPPORTS_AUTHORITY_TRACE = (() => {
  if (typeof Surface.validateTrustBundle !== 'function') return false;
  try {
    Surface.validateTrustBundle({
      schemaVersion: 5,
      source: 'veritas-authority-trace-capability-detect',
      claims: [{
        id: 'claim.authority-trace-capability',
        subjectType: 'repository-change',
        subjectId: 'repo',
        facet: 'veritas.readiness',
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
