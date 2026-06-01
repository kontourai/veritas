import { resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { loadJson } from '../load.mjs';
import { uniqueStrings } from '../util/strings.mjs';

export function readEvidenceInventoryManifestPaths(config) {
  return uniqueStrings(config.evidence?.evidenceInventoryManifests ?? []);
}

const EVIDENCE_INVENTORY_DISPOSITIONS = [
  'required',
  'candidate',
  'advisory',
  'move-to-test',
  'retire',
  'upstream-abstraction',
];

function readEvidenceInventoryField(suite, camelKey, snakeKey, fallback = null) {
  if (suite[camelKey] !== undefined) return suite[camelKey];
  if (snakeKey && suite[snakeKey] !== undefined) return suite[snakeKey];
  return fallback;
}

function assertEvidenceInventoryString(value, label, { required = true } = {}) {
  if (!required && (value === undefined || value === null)) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function normalizeEvidenceInventoryDisposition(suite) {
  const disposition = suite.defaultDisposition ?? suite.disposition ?? 'candidate';
  if (suite.currentBlockingStatus === 'required' || disposition === 'required') return 'required';
  if (disposition === 'retire') return 'retire';
  if (disposition === 'move-to-test') return 'move-to-test';
  if (disposition === 'upstream-abstraction') return 'upstream-abstraction';
  if (suite.currentBlockingStatus === 'advisory' || disposition === 'advisory') return 'advisory';
  return 'candidate';
}

export function validateEvidenceInventoryManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`evidence-inventory manifest must be an object: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
    throw new Error(`evidence-inventory manifest requires a non-empty items array: ${manifestPath}`);
  }

  const ids = new Set();
  for (const suite of manifest.items) {
    if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
      throw new Error(`evidence-inventory manifest entry must be an object: ${manifestPath}`);
    }
    assertEvidenceInventoryString(suite.id, `evidence-inventory id in ${manifestPath}`);
    if (ids.has(suite.id)) throw new Error(`evidence-inventory manifest contains duplicate id: ${suite.id}`);
    ids.add(suite.id);

    const rawDisposition = suite.defaultDisposition ?? suite.disposition;
    if (rawDisposition !== undefined && !EVIDENCE_INVENTORY_DISPOSITIONS.includes(rawDisposition)) {
      throw new Error(`evidence-inventory ${suite.id} has unsupported defaultDisposition: ${rawDisposition}`);
    }

    const disposition = normalizeEvidenceInventoryDisposition(suite);
    if (!EVIDENCE_INVENTORY_DISPOSITIONS.includes(disposition)) {
      throw new Error(`evidence-inventory ${suite.id} has unsupported disposition: ${disposition}`);
    }

    const required = disposition === 'required' || suite.currentBlockingStatus === 'required';
    assertEvidenceInventoryString(
      readEvidenceInventoryField(suite, 'evidenceCheckId', 'evidence_check_id', manifest.sourceEvidenceCheckId ?? manifest.sourceEvidenceCheckId),
      `evidence-inventory ${suite.id} evidenceCheckId`,
    );
    assertEvidenceInventoryString(suite.owner, `evidence-inventory ${suite.id} owner`, { required });
    assertEvidenceInventoryString(
      readEvidenceInventoryField(suite, 'expiryOrReviewTrigger', 'review_trigger'),
      `evidence-inventory ${suite.id} review trigger`,
      { required },
    );
    if (required && readEvidenceInventoryField(suite, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown') === 'unknown') {
      throw new Error(`evidence-inventory ${suite.id} cannot be required with unknown recent catch evidence`);
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

export function loadEvidenceInventoryResults(config, rootDir, selectedEvidenceCheckIds = []) {
  const selectedIds = new Set(selectedEvidenceCheckIds);
  return readEvidenceInventoryManifestPaths(config).flatMap((manifestPath) => {
    const resolvedManifestPath = resolve(rootDir, manifestPath);
    assertWithinDir(
      resolvedManifestPath,
      resolve(rootDir, '.veritas'),
      'evidence-inventory manifests must live inside .veritas/',
    );
    const manifest = loadJson(resolvedManifestPath, 'evidence-inventory manifest');
    const relativeManifestPath = relativeRepoPath(rootDir, resolvedManifestPath);
    validateEvidenceInventoryManifest(manifest, relativeManifestPath);
    return (manifest.items ?? []).map((suite) => {
      const disposition = normalizeEvidenceInventoryDisposition(suite);
      const evidenceCheckId = suite.evidenceCheckId ?? suite.laneId ?? suite.evidenceCheckId ?? manifest.sourceEvidenceCheckId ?? manifest.sourceEvidenceCheckId ?? 'unknown';
      const recentCatchEvidence = readEvidenceInventoryField(suite, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown');
      const reviewTrigger = readEvidenceInventoryField(suite, 'expiryOrReviewTrigger', 'review_trigger', null);
      const evidenceBasis = readEvidenceInventoryField(
        suite,
        'evidenceBasis',
        'evidence_basis',
        recentCatchEvidence === 'unknown' ? 'unknown' : 'recorded-catch-evidence',
      );
      const freshnessStatus =
        readEvidenceInventoryField(suite, 'freshnessStatus', 'freshness_status') ??
        (disposition === 'retire' ? 'retiring' : !reviewTrigger || recentCatchEvidence === 'unknown' ? 'review-needed' : 'current');
      return {
        id: suite.id,
        evidence_check_id: evidenceCheckId,
        source_evidence_check_id: manifest.sourceEvidenceCheckId ?? manifest.sourceEvidenceCheckId ?? null,
        manifest_path: relativeManifestPath,
        destination: suite.destination ?? null,
        owner: suite.owner ?? null,
        disposition,
        blocking_status: suite.currentBlockingStatus ?? disposition,
        verification_weight: verificationWeightForDisposition(disposition),
        selected: selectedIds.has(evidenceCheckId),
        recent_catch_evidence: recentCatchEvidence,
        regression_severity: suite.regressionSeverity ?? 'unknown',
        false_positive_risk: suite.falsePositiveRisk ?? 'unknown',
        replacement_test_available: suite.replacementTestAvailable ?? null,
        review_trigger: reviewTrigger,
        last_reviewed: readEvidenceInventoryField(suite, 'lastReviewed', 'last_reviewed', null),
        evidence_basis: evidenceBasis,
        freshness_status: freshnessStatus,
        rationale: suite.rationale ?? '',
      };
    });
  });
}

export function buildReadinessCoverage({ evidenceChecks, evidenceInventoryResults }) {
  const unknownCatchEvidenceSuites = evidenceInventoryResults.filter((suite) => suite.recent_catch_evidence === 'unknown').map((suite) => suite.id);
  const missingReviewTriggerSuites = evidenceInventoryResults.filter((suite) => !suite.review_trigger).map((suite) => suite.id);
  const staleSuites = evidenceInventoryResults
    .filter((suite) => suite.freshness_status === 'review-needed' || suite.freshness_status === 'stale' || suite.disposition === 'retire')
    .map((suite) => suite.id);
  const staleOrUnknownSuites = uniqueStrings([...unknownCatchEvidenceSuites, ...missingReviewTriggerSuites, ...staleSuites]);

  return {
    evidence_check_count: evidenceChecks.length,
    selected_evidence_check_count: evidenceChecks.filter((evidenceCheck) => evidenceCheck.selected).length,
    evidence_inventory_count: evidenceInventoryResults.length,
    required_inventory_count: evidenceInventoryResults.filter((suite) => suite.disposition === 'required').length,
    candidate_inventory_count: evidenceInventoryResults.filter((suite) => suite.disposition === 'candidate').length,
    advisory_inventory_count: evidenceInventoryResults.filter((suite) => suite.disposition === 'advisory').length,
    move_to_test_inventory_count: evidenceInventoryResults.filter((suite) => suite.disposition === 'move-to-test').length,
    retire_inventory_count: evidenceInventoryResults.filter((suite) => suite.disposition === 'retire').length,
    upstream_candidate_count: evidenceInventoryResults.filter((suite) => suite.disposition === 'upstream-abstraction').length,
    unknown_catch_evidence_inventory_ids: unknownCatchEvidenceSuites,
    missing_review_trigger_inventory_ids: missingReviewTriggerSuites,
    stale_inventory_ids: staleSuites,
    stale_or_unknown_inventory_ids: staleOrUnknownSuites,
    recommendation:
      staleOrUnknownSuites.length > 0
        ? 'Review unknown, retiring, or triggerless evidence inventories before promoting more checks.'
        : 'Readiness coverage has owners, review triggers, and no unknown catch-evidence inventories.',
  };
}
