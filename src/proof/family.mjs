import { resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { loadJson } from '../load.mjs';
import { uniqueStrings } from '../util/strings.mjs';

export function readProofFamilyManifestPaths(config) {
  return uniqueStrings(config.evidence?.proofFamilyManifests ?? []);
}

const PROOF_FAMILY_DISPOSITIONS = [
  'required',
  'candidate',
  'advisory',
  'move-to-test',
  'retire',
  'upstream-abstraction',
];

function readProofFamilyField(family, camelKey, snakeKey, fallback = null) {
  if (family[camelKey] !== undefined) return family[camelKey];
  if (snakeKey && family[snakeKey] !== undefined) return family[snakeKey];
  return fallback;
}

function assertProofFamilyString(value, label, { required = true } = {}) {
  if (!required && (value === undefined || value === null)) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function normalizeProofFamilyDisposition(family) {
  const disposition = family.defaultDisposition ?? family.disposition ?? 'candidate';
  if (family.currentBlockingStatus === 'required' || disposition === 'required') return 'required';
  if (disposition === 'retire') return 'retire';
  if (disposition === 'move-to-test') return 'move-to-test';
  if (disposition === 'upstream-abstraction') return 'upstream-abstraction';
  if (family.currentBlockingStatus === 'advisory' || disposition === 'advisory') return 'advisory';
  return 'candidate';
}

export function validateProofFamilyManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`proof-family manifest must be an object: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.families) || manifest.families.length === 0) {
    throw new Error(`proof-family manifest requires a non-empty families array: ${manifestPath}`);
  }

  const ids = new Set();
  for (const family of manifest.families) {
    if (!family || typeof family !== 'object' || Array.isArray(family)) {
      throw new Error(`proof-family manifest family must be an object: ${manifestPath}`);
    }
    assertProofFamilyString(family.id, `proof-family id in ${manifestPath}`);
    if (ids.has(family.id)) throw new Error(`proof-family manifest contains duplicate family id: ${family.id}`);
    ids.add(family.id);

    const rawDisposition = family.defaultDisposition ?? family.disposition;
    if (rawDisposition !== undefined && !PROOF_FAMILY_DISPOSITIONS.includes(rawDisposition)) {
      throw new Error(`proof-family ${family.id} has unsupported defaultDisposition: ${rawDisposition}`);
    }

    const disposition = normalizeProofFamilyDisposition(family);
    if (!PROOF_FAMILY_DISPOSITIONS.includes(disposition)) {
      throw new Error(`proof-family ${family.id} has unsupported disposition: ${disposition}`);
    }

    const required = disposition === 'required' || family.currentBlockingStatus === 'required';
    assertProofFamilyString(
      readProofFamilyField(family, 'laneId', 'lane_id', manifest.sourceProofLaneId),
      `proof-family ${family.id} laneId`,
    );
    assertProofFamilyString(family.owner, `proof-family ${family.id} owner`, { required });
    assertProofFamilyString(
      readProofFamilyField(family, 'expiryOrReviewTrigger', 'review_trigger'),
      `proof-family ${family.id} review trigger`,
      { required },
    );
    if (required && readProofFamilyField(family, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown') === 'unknown') {
      throw new Error(`proof-family ${family.id} cannot be required with unknown recent catch evidence`);
    }
  }
}

export function verificationWeightForDisposition(disposition) {
  if (disposition === 'required') return 'blocking';
  if (disposition === 'candidate' || disposition === 'move-to-test' || disposition === 'upstream-abstraction') {
    return 'advisory';
  }
  return 'informational';
}

export function loadProofFamilyResults(config, rootDir, selectedProofLaneIds = []) {
  const selectedIds = new Set(selectedProofLaneIds);
  return readProofFamilyManifestPaths(config).flatMap((manifestPath) => {
    const resolvedManifestPath = resolve(rootDir, manifestPath);
    assertWithinDir(
      resolvedManifestPath,
      resolve(rootDir, '.veritas'),
      'proof-family manifests must live inside .veritas/',
    );
    const manifest = loadJson(resolvedManifestPath, 'proof-family manifest');
    const relativeManifestPath = relativeRepoPath(rootDir, resolvedManifestPath);
    validateProofFamilyManifest(manifest, relativeManifestPath);
    return (manifest.families ?? []).map((family) => {
      const disposition = normalizeProofFamilyDisposition(family);
      const laneId = family.laneId ?? family.proofLaneId ?? manifest.sourceProofLaneId ?? 'unknown';
      const recentCatchEvidence = readProofFamilyField(family, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown');
      const reviewTrigger = readProofFamilyField(family, 'expiryOrReviewTrigger', 'review_trigger', null);
      const evidenceBasis = readProofFamilyField(
        family,
        'evidenceBasis',
        'evidence_basis',
        recentCatchEvidence === 'unknown' ? 'unknown' : 'recorded-catch-evidence',
      );
      const freshnessStatus =
        readProofFamilyField(family, 'freshnessStatus', 'freshness_status') ??
        (disposition === 'retire' ? 'retiring' : !reviewTrigger || recentCatchEvidence === 'unknown' ? 'review-needed' : 'current');
      return {
        id: family.id,
        lane_id: laneId,
        source_proof_lane_id: manifest.sourceProofLaneId ?? null,
        manifest_path: relativeManifestPath,
        destination: family.destination ?? null,
        owner: family.owner ?? null,
        disposition,
        blocking_status: family.currentBlockingStatus ?? disposition,
        verification_weight: verificationWeightForDisposition(disposition),
        selected: selectedIds.has(laneId),
        recent_catch_evidence: recentCatchEvidence,
        regression_severity: family.regressionSeverity ?? 'unknown',
        false_positive_risk: family.falsePositiveRisk ?? 'unknown',
        replacement_test_available: family.replacementTestAvailable ?? null,
        review_trigger: reviewTrigger,
        last_reviewed: readProofFamilyField(family, 'lastReviewed', 'last_reviewed', null),
        evidence_basis: evidenceBasis,
        freshness_status: freshnessStatus,
        rationale: family.rationale ?? '',
      };
    });
  });
}

export function buildVerificationBudget({ proofLanes, proofFamilyResults }) {
  const unknownCatchEvidenceFamilies = proofFamilyResults.filter((family) => family.recent_catch_evidence === 'unknown').map((family) => family.id);
  const missingReviewTriggerFamilies = proofFamilyResults.filter((family) => !family.review_trigger).map((family) => family.id);
  const staleFamilies = proofFamilyResults
    .filter((family) => family.freshness_status === 'review-needed' || family.freshness_status === 'stale' || family.disposition === 'retire')
    .map((family) => family.id);
  const staleOrUnknownFamilies = uniqueStrings([...unknownCatchEvidenceFamilies, ...missingReviewTriggerFamilies, ...staleFamilies]);

  return {
    proof_lane_count: proofLanes.length,
    selected_proof_lane_count: proofLanes.filter((lane) => lane.selected).length,
    proof_family_count: proofFamilyResults.length,
    required_family_count: proofFamilyResults.filter((family) => family.disposition === 'required').length,
    candidate_family_count: proofFamilyResults.filter((family) => family.disposition === 'candidate').length,
    advisory_family_count: proofFamilyResults.filter((family) => family.disposition === 'advisory').length,
    move_to_test_family_count: proofFamilyResults.filter((family) => family.disposition === 'move-to-test').length,
    retire_family_count: proofFamilyResults.filter((family) => family.disposition === 'retire').length,
    upstream_candidate_count: proofFamilyResults.filter((family) => family.disposition === 'upstream-abstraction').length,
    unknown_catch_evidence_family_ids: unknownCatchEvidenceFamilies,
    missing_review_trigger_family_ids: missingReviewTriggerFamilies,
    stale_family_ids: staleFamilies,
    stale_or_unknown_family_ids: staleOrUnknownFamilies,
    recommendation:
      staleOrUnknownFamilies.length > 0
        ? 'Review unknown, retiring, or triggerless proof families before promoting more checks.'
        : 'Verification budget has owners, review triggers, and no unknown catch-evidence families.',
  };
}
