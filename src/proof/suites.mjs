import { resolve } from 'node:path';
import { assertWithinDir, relativeRepoPath } from '../paths.mjs';
import { loadJson } from '../load.mjs';
import { uniqueStrings } from '../util/strings.mjs';

export function readProofSuiteManifestPaths(config) {
  return uniqueStrings(config.evidence?.proofSuiteManifests ?? []);
}

const PROOF_SUITE_DISPOSITIONS = [
  'required',
  'candidate',
  'advisory',
  'move-to-test',
  'retire',
  'upstream-abstraction',
];

function readProofSuiteField(suite, camelKey, snakeKey, fallback = null) {
  if (suite[camelKey] !== undefined) return suite[camelKey];
  if (snakeKey && suite[snakeKey] !== undefined) return suite[snakeKey];
  return fallback;
}

function assertProofSuiteString(value, label, { required = true } = {}) {
  if (!required && (value === undefined || value === null)) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function normalizeProofSuiteDisposition(suite) {
  const disposition = suite.defaultDisposition ?? suite.disposition ?? 'candidate';
  if (suite.currentBlockingStatus === 'required' || disposition === 'required') return 'required';
  if (disposition === 'retire') return 'retire';
  if (disposition === 'move-to-test') return 'move-to-test';
  if (disposition === 'upstream-abstraction') return 'upstream-abstraction';
  if (suite.currentBlockingStatus === 'advisory' || disposition === 'advisory') return 'advisory';
  return 'candidate';
}

export function validateProofSuiteManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`proof-suite manifest must be an object: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.families) || manifest.families.length === 0) {
    throw new Error(`proof-suite manifest requires a non-empty families array: ${manifestPath}`);
  }

  const ids = new Set();
  for (const suite of manifest.families) {
    if (!suite || typeof suite !== 'object' || Array.isArray(suite)) {
      throw new Error(`proof-suite manifest entry must be an object: ${manifestPath}`);
    }
    assertProofSuiteString(suite.id, `proof-suite id in ${manifestPath}`);
    if (ids.has(suite.id)) throw new Error(`proof-suite manifest contains duplicate id: ${suite.id}`);
    ids.add(suite.id);

    const rawDisposition = suite.defaultDisposition ?? suite.disposition;
    if (rawDisposition !== undefined && !PROOF_SUITE_DISPOSITIONS.includes(rawDisposition)) {
      throw new Error(`proof-suite ${suite.id} has unsupported defaultDisposition: ${rawDisposition}`);
    }

    const disposition = normalizeProofSuiteDisposition(suite);
    if (!PROOF_SUITE_DISPOSITIONS.includes(disposition)) {
      throw new Error(`proof-suite ${suite.id} has unsupported disposition: ${disposition}`);
    }

    const required = disposition === 'required' || suite.currentBlockingStatus === 'required';
    assertProofSuiteString(
      readProofSuiteField(suite, 'proofId', 'proof_id', manifest.sourceProofId ?? manifest.sourceProofLaneId),
      `proof-suite ${suite.id} proofId`,
    );
    assertProofSuiteString(suite.owner, `proof-suite ${suite.id} owner`, { required });
    assertProofSuiteString(
      readProofSuiteField(suite, 'expiryOrReviewTrigger', 'review_trigger'),
      `proof-suite ${suite.id} review trigger`,
      { required },
    );
    if (required && readProofSuiteField(suite, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown') === 'unknown') {
      throw new Error(`proof-suite ${suite.id} cannot be required with unknown recent catch evidence`);
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

export function loadProofSuiteResults(config, rootDir, selectedProofIds = []) {
  const selectedIds = new Set(selectedProofIds);
  return readProofSuiteManifestPaths(config).flatMap((manifestPath) => {
    const resolvedManifestPath = resolve(rootDir, manifestPath);
    assertWithinDir(
      resolvedManifestPath,
      resolve(rootDir, '.veritas'),
      'proof-suite manifests must live inside .veritas/',
    );
    const manifest = loadJson(resolvedManifestPath, 'proof-suite manifest');
    const relativeManifestPath = relativeRepoPath(rootDir, resolvedManifestPath);
    validateProofSuiteManifest(manifest, relativeManifestPath);
    return (manifest.families ?? []).map((suite) => {
      const disposition = normalizeProofSuiteDisposition(suite);
      const proofId = suite.proofId ?? suite.laneId ?? suite.proofLaneId ?? manifest.sourceProofId ?? manifest.sourceProofLaneId ?? 'unknown';
      const recentCatchEvidence = readProofSuiteField(suite, 'recentCatchEvidence', 'recent_catch_evidence', 'unknown');
      const reviewTrigger = readProofSuiteField(suite, 'expiryOrReviewTrigger', 'review_trigger', null);
      const evidenceBasis = readProofSuiteField(
        suite,
        'evidenceBasis',
        'evidence_basis',
        recentCatchEvidence === 'unknown' ? 'unknown' : 'recorded-catch-evidence',
      );
      const freshnessStatus =
        readProofSuiteField(suite, 'freshnessStatus', 'freshness_status') ??
        (disposition === 'retire' ? 'retiring' : !reviewTrigger || recentCatchEvidence === 'unknown' ? 'review-needed' : 'current');
      return {
        id: suite.id,
        proof_id: proofId,
        source_proof_id: manifest.sourceProofId ?? manifest.sourceProofLaneId ?? null,
        manifest_path: relativeManifestPath,
        destination: suite.destination ?? null,
        owner: suite.owner ?? null,
        disposition,
        blocking_status: suite.currentBlockingStatus ?? disposition,
        verification_weight: verificationWeightForDisposition(disposition),
        selected: selectedIds.has(proofId),
        recent_catch_evidence: recentCatchEvidence,
        regression_severity: suite.regressionSeverity ?? 'unknown',
        false_positive_risk: suite.falsePositiveRisk ?? 'unknown',
        replacement_test_available: suite.replacementTestAvailable ?? null,
        review_trigger: reviewTrigger,
        last_reviewed: readProofSuiteField(suite, 'lastReviewed', 'last_reviewed', null),
        evidence_basis: evidenceBasis,
        freshness_status: freshnessStatus,
        rationale: suite.rationale ?? '',
      };
    });
  });
}

export function buildVerificationBudget({ proofs, proofSuiteResults }) {
  const unknownCatchEvidenceSuites = proofSuiteResults.filter((suite) => suite.recent_catch_evidence === 'unknown').map((suite) => suite.id);
  const missingReviewTriggerSuites = proofSuiteResults.filter((suite) => !suite.review_trigger).map((suite) => suite.id);
  const staleSuites = proofSuiteResults
    .filter((suite) => suite.freshness_status === 'review-needed' || suite.freshness_status === 'stale' || suite.disposition === 'retire')
    .map((suite) => suite.id);
  const staleOrUnknownSuites = uniqueStrings([...unknownCatchEvidenceSuites, ...missingReviewTriggerSuites, ...staleSuites]);

  return {
    proof_count: proofs.length,
    selected_proof_count: proofs.filter((proof) => proof.selected).length,
    proof_suite_count: proofSuiteResults.length,
    required_family_count: proofSuiteResults.filter((suite) => suite.disposition === 'required').length,
    candidate_family_count: proofSuiteResults.filter((suite) => suite.disposition === 'candidate').length,
    advisory_family_count: proofSuiteResults.filter((suite) => suite.disposition === 'advisory').length,
    move_to_test_family_count: proofSuiteResults.filter((suite) => suite.disposition === 'move-to-test').length,
    retire_family_count: proofSuiteResults.filter((suite) => suite.disposition === 'retire').length,
    upstream_candidate_count: proofSuiteResults.filter((suite) => suite.disposition === 'upstream-abstraction').length,
    unknown_catch_evidence_family_ids: unknownCatchEvidenceSuites,
    missing_review_trigger_family_ids: missingReviewTriggerSuites,
    stale_family_ids: staleSuites,
    stale_or_unknown_family_ids: staleOrUnknownSuites,
    recommendation:
      staleOrUnknownSuites.length > 0
        ? 'Review unknown, retiring, or triggerless proof suites before promoting more checks.'
        : 'Verification budget has owners, review triggers, and no unknown catch-evidence proof suites.',
  };
}
