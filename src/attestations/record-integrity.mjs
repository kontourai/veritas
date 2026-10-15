import { sha256Hex } from './protected-standards.mjs';

// Versions the record digest the same way repoMapHashAlgorithm versions the
// Repo Map hash: a record names the algorithm that bound it, so a later change
// to what is covered gets a new name instead of reinterpreting old records.
export const RECORD_INTEGRITY_ALGORITHM = 'veritas-attestation-record-v1';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

// Digest of every field except `recordIntegrity` itself, taken over the JSON
// form that is written to disk, so actor, notes, metadata.approvalRef and any
// field added later are all covered without listing them here.
export function computeAttestationRecordDigest(record) {
  const covered = JSON.parse(JSON.stringify(record));
  delete covered.recordIntegrity;
  return sha256Hex(JSON.stringify(canonicalize(covered)));
}

export function bindAttestationRecordIntegrity(record) {
  return {
    ...record,
    recordIntegrity: {
      algorithm: RECORD_INTEGRITY_ALGORITHM,
      digest: computeAttestationRecordDigest(record),
    },
  };
}

// The digest is unkeyed and lives in the record it covers: it detects an edit
// that did not also recompute it, not a deliberate forgery. Records written
// before record integrity existed carry no binding and report `unbound`.
export function verifyAttestationRecordIntegrity(record) {
  if (!Object.hasOwn(record, 'recordIntegrity')) {
    return {
      status: 'unbound',
      algorithm: null,
      recordedDigest: null,
      currentDigest: null,
    };
  }
  const binding = record.recordIntegrity;
  const algorithm = typeof binding?.algorithm === 'string' ? binding.algorithm : null;
  const recordedDigest = typeof binding?.digest === 'string' ? binding.digest : null;
  if (algorithm && algorithm !== RECORD_INTEGRITY_ALGORITHM) {
    return { status: 'unsupported-algorithm', algorithm, recordedDigest, currentDigest: null };
  }
  const currentDigest = computeAttestationRecordDigest(record);
  return {
    status: algorithm && recordedDigest === currentDigest ? 'verified' : 'mismatch',
    algorithm,
    recordedDigest,
    currentDigest,
  };
}
