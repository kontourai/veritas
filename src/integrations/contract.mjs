/**
 * @typedef {Object} NormalizedEvent
 * @property {"tool-call"|"shadow-run"|"edit"|"override"|"completion"} kind
 * @property {string|null} timestamp
 * @property {string[]} files
 * @property {string|null} commandText
 * @property {number|null} exitCode
 * @property {unknown} raw
 */

/**
 * @param {object} reader
 * @returns {{ name: string, canRead(transcriptPath: string): boolean, readEvents(transcriptPath: string): IterableIterator<NormalizedEvent> }}
 */
export function defineTranscriptReader(reader) {
  return reader;
}

/**
 * @param {object} adapter
 * @returns {{ name: string, installPreToolUseHook(opts: object): object, installStopHook(opts: object): object, installPostSessionHook(opts: object): object, uninstall(): object, status(): object }}
 */
export function defineRuntimeAdapter(adapter) {
  return adapter;
}
