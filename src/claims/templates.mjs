import { SURFACE_TRUST_POLICIES } from '../surface/policies.mjs';

export function buildBaselineClaims(repoName, { hasGovernance = false, evidenceCheckCommands = [], workAreas = [] } = {}) {
  const now = new Date().toISOString();
  const claims = [];
  const policies = new Map();

  for (const node of workAreas) {
    claims.push({
      id: `${safeId(repoName)}.surface.${safeId(node.id ?? node)}`,
      surface: 'veritas.affected-surface',
      claimType: 'veritas-affected-surface',
      fieldOrBehavior: node.id ?? node,
      subjectType: 'repo-surface',
      subjectId: `${repoName}:${node.id ?? node}`,
      impactLevel: 'medium',
      verificationPolicyId: SURFACE_TRUST_POLICIES.affectedSurface.id,
      metadata: { nodeId: node.id ?? node },
      createdAt: now,
      updatedAt: now,
    });
    policies.set(SURFACE_TRUST_POLICIES.affectedSurface.id, SURFACE_TRUST_POLICIES.affectedSurface);
  }

  if (hasGovernance) {
    claims.push({
      id: `${safeId(repoName)}.governance`,
      surface: 'veritas.governance',
      claimType: 'veritas-governance-artifact',
      fieldOrBehavior: 'governance artifact integrity',
      subjectType: 'repository',
      subjectId: repoName,
      impactLevel: 'high',
      verificationPolicyId: SURFACE_TRUST_POLICIES.governanceArtifact.id,
      createdAt: now,
      updatedAt: now,
    });
    policies.set(SURFACE_TRUST_POLICIES.governanceArtifact.id, SURFACE_TRUST_POLICIES.governanceArtifact);
  }

  for (const command of evidenceCheckCommands) {
    claims.push({
      id: `${safeId(repoName)}.evidence-check.${safeId(command)}`,
      surface: 'veritas.evidence-check',
      claimType: 'software-evidence-check',
      fieldOrBehavior: command,
      subjectType: 'repository',
      subjectId: repoName,
      impactLevel: 'high',
      verificationPolicyId: SURFACE_TRUST_POLICIES.evidenceCheck.id,
      metadata: { command },
      createdAt: now,
      updatedAt: now,
    });
    policies.set(SURFACE_TRUST_POLICIES.evidenceCheck.id, SURFACE_TRUST_POLICIES.evidenceCheck);
  }

  return { claims, policies: [...policies.values()] };
}

export function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'unknown';
}
