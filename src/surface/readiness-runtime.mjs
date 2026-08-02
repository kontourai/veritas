// Required-evidence execution state is intentionally process-local. Evidence
// records retain the v1-compatible selection/result fields; this side channel
// lets the active readiness run distinguish skipped, missing, and timed-out
// requirements without inventing a new serialized record field.
const readinessRuntimeByRecord = new WeakMap();

export function setReadinessRuntime(record, runtime) {
  readinessRuntimeByRecord.set(record, runtime);
  return record;
}

export function readinessRuntimeFor(record) {
  return readinessRuntimeByRecord.get(record) ?? null;
}
