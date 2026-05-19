import * as Surface from '@kontourai/surface';
import { SURFACE_TRUST_POLICIES } from './policies.mjs';

export const VERITAS_EXTENSION = {
  name: 'veritas',
  displayName: 'Veritas',
  vocab: {
    projectKind: 'repository',
    surfaceLabels: {
      'veritas.affected-surface': 'Affected Surface',
      'veritas.proof-lane': 'Proof Lanes',
      'veritas.governance': 'Governance',
      'veritas.external-tools': 'External Tools',
      'veritas.proposals': 'Proposals',
    },
    claimTypeLabels: {
      'veritas-affected-surface': 'Affected surface node',
      'software-proof': 'Proof lane',
      'veritas-governance-artifact': 'Governance artifact',
      'veritas-policy-result': 'Policy result',
      'veritas-external-tool-result': 'External tool result',
      'veritas-verification-budget': 'Verification budget',
      'veritas-proposal': 'Proposal',
    },
    statusLabels: {
      proposed: 'Pending evidence',
      verified: 'Verified',
      stale: 'Needs re-verification',
      disputed: 'Has failures',
      rejected: 'Rejected',
      unknown: 'Not yet evaluated',
      superseded: 'Superseded',
    },
    actionText: {
      reviewItem: 'Review in Veritas',
      refreshEvidence: 'Re-run veritas',
      markProposed: 'Mark as pending',
    },
  },
  theme: {
    brandName: 'Veritas',
    primaryColor: '#6366f1',
  },
  claimTypes: [
    {
      id: 'software-proof',
      displayName: 'Proof Lane',
      description: 'An automated test suite or proof command that verifies code correctness.',
      defaultImpact: 'high',
      defaultSurface: 'veritas.proof-lane',
      policyTemplateId: 'veritas.proof-lane',
      metadataFields: [
        { key: 'command', label: 'Proof command', type: 'string', required: true },
        { key: 'scope', label: 'Scope', type: 'string' },
      ],
    },
    {
      id: 'veritas-governance-artifact',
      displayName: 'Governance Artifact',
      description: 'A governance artifact that must remain in sync with policy and adapter configuration.',
      defaultImpact: 'high',
      defaultSurface: 'veritas.governance',
      policyTemplateId: 'veritas.governance-artifact',
    },
    {
      id: 'veritas-external-tool-result',
      displayName: 'External Tool Result',
      description: 'Result from an external analysis tool integrated via a Veritas adapter.',
      defaultImpact: 'medium',
      defaultSurface: 'veritas.external-tools',
      policyTemplateId: 'veritas.external-tool-result',
      metadataFields: [
        { key: 'tool', label: 'Tool name', type: 'string', required: true },
        { key: 'resultFile', label: 'Result file path', type: 'string' },
      ],
    },
  ],
  policyTemplates: Object.values(SURFACE_TRUST_POLICIES).map((policy) => ({
    id: policy.id,
    template: Object.fromEntries(Object.entries(policy).filter(([key]) => key !== 'id')),
  })),
};

export function registerVeritasExtension() {
  if (typeof Surface.registerExtension === 'function') {
    Surface.registerExtension(VERITAS_EXTENSION);
  }
}
