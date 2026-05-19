export default {
  name: 'npm-audit-example',
  version: '1.0.0',
  author: {
    name: 'Surface example (not affiliated with npm)',
    url: 'https://github.com/kontourai/surface',
  },
  claimTypes: [
    {
      id: 'package-version-safety',
      displayName: 'Package version safety',
      description: 'No critical or high vulnerabilities in npm dependencies.',
      defaultImpact: 'high',
      defaultSurface: 'security.dependencies',
      policyTemplateId: 'npm-audit.package-version-safety',
      metadataFields: [
        {
          key: 'auditFile',
          label: 'npm audit output file',
          type: 'string',
          hint: 'Path to npm audit --json output, relative to repo root',
        },
      ],
    },
  ],
  policyTemplates: {
    'npm-audit.package-version-safety': {
      claimType: 'package-version-safety',
      requiredEvidence: ['policy_rule'],
      requiredMethods: ['validation'],
      requiresCorroboration: false,
      requiredProof: ['npm audit --json'],
      reviewAuthority: 'package manager audit',
      validityRule: { kind: 'duration', durationDays: 1 },
      stalenessTriggers: ['new npm advisory', 'dependency version changes', 'lockfile changes'],
      conflictRules: ['present vulnerability rejects package-version safety'],
      impactLevel: 'high',
    },
  },
  importEvidence(rawOutput, claims, context) {
    if (!rawOutput) return [];
    let report;
    try {
      report = JSON.parse(rawOutput);
    } catch {
      return [];
    }
    const vulnerabilities = report.vulnerabilities ?? {};
    const criticalCount = countBySeverity(vulnerabilities, 'critical');
    const highCount = countBySeverity(vulnerabilities, 'high');
    const passing = criticalCount === 0 && highCount === 0;
    return claims.map((claim) => ({
      id: `${context.runId}.npm-audit.${safeId(claim.id)}`,
      claimId: claim.id,
      evidenceType: 'policy_rule',
      method: 'validation',
      sourceRef: context.sourceRef,
      excerptOrSummary: passing
        ? 'npm audit found no critical or high vulnerabilities.'
        : `npm audit found ${criticalCount} critical and ${highCount} high vulnerabilities.`,
      observedAt: context.timestamp,
      passing,
      blocking: !passing,
      metadata: {
        vulnerabilityCounts: { critical: criticalCount, high: highCount },
      },
    }));
  },
  scaffoldClaims(repoName) {
    const now = new Date().toISOString();
    return [{
      id: `${safeId(repoName)}.security.npm-audit`,
      surface: 'security.dependencies',
      claimType: 'package-version-safety',
      fieldOrBehavior: 'no critical or high npm vulnerabilities',
      subjectType: 'repository',
      subjectId: repoName,
      impactLevel: 'high',
      verificationPolicyId: 'npm-audit.package-version-safety',
      createdAt: now,
      updatedAt: now,
    }];
  },
};

function countBySeverity(vulnerabilities, severity) {
  return Object.values(vulnerabilities).filter((vulnerability) => vulnerability?.severity === severity).length;
}

function safeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'claim';
}
