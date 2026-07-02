import { loadVeritasClaimStore } from '../claims/store.mjs';
import { registerVeritasExtension } from './extension.mjs';
import { loadPluginsFromConfig, collectPluginEvidence } from '../plugins/loader.mjs';
import {
  collectAffectedSurfaceEvidence,
  collectEvidenceCheckEvidence,
  collectEvidenceInventoryEvidence,
  collectExternalToolEvidence,
  collectPolicyResultEvidence,
  collectReadinessCoverageEvidence,
  collectReadinessVerdictEvidence,
} from './evidence-projection.mjs';
import {
  collectGovernanceEvidence,
  collectRecommendationEvidence,
} from './governance-projection.mjs';
import {
  buildRepoStandardsClaimGroup,
  claimDefToClaim,
  withProjectedPolicyClaims,
} from './projected-claims.mjs';
import {
  createSurfaceTrustBundleAssembler,
} from './trust-bundle-assembler.mjs';

function collectClaimDefinitions({ effectiveClaimStore, record, claims }) {
  for (const definition of effectiveClaimStore.claims) {
    claims.push(claimDefToClaim(definition, record));
  }
}

function collectRecordProjection({ record, effectiveClaimStore, evidence, events, authorityTrace, rootDir }) {
  collectAffectedSurfaceEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceCheckEvidence(record, effectiveClaimStore, evidence, events);
  collectPolicyResultEvidence(record, effectiveClaimStore, evidence, events);
  collectEvidenceInventoryEvidence(record, effectiveClaimStore, evidence, events);
  collectExternalToolEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessCoverageEvidence(record, effectiveClaimStore, evidence, events);
  collectReadinessVerdictEvidence(record, effectiveClaimStore, evidence, events, authorityTrace);
  collectGovernanceEvidence(record, effectiveClaimStore, evidence, events);
  collectRecommendationEvidence(record, effectiveClaimStore, evidence, rootDir);
}

function collectClaimGroups({ record, effectiveClaimStore, claimGroups }) {
  const policyClaimGroup = buildRepoStandardsClaimGroup(record, effectiveClaimStore);
  if (policyClaimGroup) claimGroups.push(policyClaimGroup);
}

function collectPluginProjection({ claimStore, record, rootDir, evidence }) {
  const pluginContext = {
    runId: record.run_id,
    sourceRef: record.source_ref,
    timestamp: record.timestamp,
    rootDir,
  };
  for (const item of collectPluginEvidence(claimStore, pluginContext)) {
    evidence.push(item);
  }
}

export async function createSurfaceProjectionAssembly(record, {
  rootDir = process.cwd(),
  repoMapConfig = null,
} = {}) {
  registerVeritasExtension();
  if (repoMapConfig) await loadPluginsFromConfig(repoMapConfig, rootDir);
  const claimStore = loadVeritasClaimStore(rootDir);
  const effectiveClaimStore = withProjectedPolicyClaims(claimStore, record);
  const assembler = createSurfaceTrustBundleAssembler({
    source: `veritas:${record.run_id}`,
    schemaVersion: 5,
  });
  const { claims, evidence, events, claimGroups, authorityTrace } = assembler;

  collectClaimDefinitions({ effectiveClaimStore, record, claims });
  collectRecordProjection({ record, effectiveClaimStore, evidence, events, authorityTrace, rootDir });
  collectClaimGroups({ record, effectiveClaimStore, claimGroups });
  collectPluginProjection({ claimStore, record, rootDir, evidence });

  return {
    assembler,
    policies: effectiveClaimStore.policies,
  };
}
