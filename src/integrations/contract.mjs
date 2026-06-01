/**
 * @typedef {Object} NormalizedEvent
 * @property {"tool-call"|"readiness-check"|"edit"|"exception"|"completion"} kind
 * @property {string|null} timestamp
 * @property {string[]} files
 * @property {string|null} commandText
 * @property {number|null} exitCode
 * @property {unknown} raw
 */

/**
 * @param {object} reader
 * @returns {{ name: string, canRead(sessionLogPath: string): boolean, readEvents(sessionLogPath: string): IterableIterator<NormalizedEvent> }}
 */
export function defineSessionLogReader(reader) {
  return reader;
}

/**
 * @param {object} integration
 * @returns {{ name: string, installPreToolUseHook(opts: object): object, installStopHook(opts: object): object, installPostSessionHook(opts: object): object, uninstall(): object, status(): object }}
 */
export function defineRuntimeIntegration(integration) {
  return integration;
}
