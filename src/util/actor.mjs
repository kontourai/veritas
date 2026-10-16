// The governance actor for a readiness run: the first explicit candidate (for example `--actor`),
// then VERITAS_ACTOR. An empty string counts as unset, so `--actor ''` neither names an actor
// nor hides VERITAS_ACTOR. Returns null when nothing names an actor; callers decide whether that
// fails closed (work-area-boundary) or falls back to a label (run history, authority trace).
export function resolveActor(...candidates) {
  for (const candidate of [...candidates, process.env.VERITAS_ACTOR]) {
    if (typeof candidate === 'string' && candidate !== '') return candidate;
  }
  return null;
}
