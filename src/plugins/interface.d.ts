export interface VeritasPluginClaimType {
  id: string;
  displayName: string;
  description: string;
  defaultImpact: 'low' | 'medium' | 'high' | 'critical';
  defaultFacet?: string;
  policyTemplateId?: string;
  metadataFields?: Array<{
    key: string;
    label: string;
    type: 'string' | 'boolean' | 'number';
    required?: boolean;
    hint?: string;
  }>;
}

export interface VeritasPluginEvidence {
  id: string;
  claimId: string;
  evidenceType: string;
  method: string;
  sourceRef?: string;
  excerptOrSummary: string;
  observedAt: string;
  passing?: boolean;
  blocking?: boolean;
  metadata?: Record<string, unknown>;
}

export interface VeritasPluginImportContext {
  runId: string;
  sourceRef?: string;
  timestamp: string;
  rootDir: string;
}

export interface VeritasPlugin {
  name: string;
  version: string;
  author: {
    name: string;
    url?: string;
  };
  claimTypes: VeritasPluginClaimType[];
  policyTemplates?: Record<string, object>;
  importEvidence(
    rawOutput: string,
    claims: object[],
    context: VeritasPluginImportContext,
  ): VeritasPluginEvidence[];
  scaffoldClaims?(repoName: string, options?: Record<string, unknown>): object[];
}
