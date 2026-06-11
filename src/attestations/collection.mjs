/**
 * Testimony admissibility helpers.
 *
 * Builds the structured `authorizing` block that describes how an attestation
 * was authorized, and computes the optional admissibility warning annotation.
 */

/**
 * Tokenize a string into lowercase alpha-numeric tokens for overlap testing.
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  if (typeof text !== 'string' || !text) return new Set();
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/**
 * Build a validated `authorizing` block from raw option values.
 *
 * @param {object} options
 * @param {string} [options.statement]          - for kind=explicit-statement
 * @param {string} [options.prompt]             - for kind=exchange
 * @param {string} [options.response]           - for kind=exchange
 * @param {string} [options.excerptSource]      - for kind=exchange (source)
 * @param {string} [options.promptRef]          - for kind=authorized-action
 * @param {string} [options.renderedPrompt]     - for kind=authorized-action
 * @param {string} [options.action]             - for kind=authorized-action
 * @param {string} [options.authorityRef]       - for kind=authorized-action
 * @returns {{ kind: string, [key: string]: string }|null}  null when no authorizing options provided
 */
export function buildAuthorizing(options = {}) {
  const {
    statement,
    prompt,
    response,
    excerptSource,
    promptRef,
    renderedPrompt,
    action,
    authorityRef,
  } = options;

  const hasStatement = typeof statement === 'string' && statement.trim() !== '';
  const hasPrompt = typeof prompt === 'string' && prompt.trim() !== '';
  const hasResponse = typeof response === 'string' && response.trim() !== '';
  const hasExchange = hasPrompt || hasResponse;
  const hasAuthorizedAction = promptRef || renderedPrompt || action || authorityRef;

  // No authorizing info provided — caller omits the block.
  if (!hasStatement && !hasExchange && !hasAuthorizedAction) {
    return null;
  }

  // explicit-statement: standalone words naming the act
  if (hasStatement && !hasExchange && !hasAuthorizedAction) {
    return { kind: 'explicit-statement', statement: statement.trim() };
  }

  // exchange: BOTH prompt and response required
  if (hasExchange && !hasStatement && !hasAuthorizedAction) {
    if (!hasPrompt) {
      throw new Error(
        'authorizing kind=exchange requires --authorizing-prompt (both prompt and response are required)',
      );
    }
    if (!hasResponse) {
      throw new Error(
        'authorizing kind=exchange requires --authorizing-response (both prompt and response are required)',
      );
    }
    const block = { kind: 'exchange', prompt: prompt.trim(), response: response.trim() };
    if (excerptSource) block.source = excerptSource;
    return block;
  }

  // authorized-action: all four fields required
  if (hasAuthorizedAction && !hasStatement && !hasExchange) {
    const missing = [];
    if (!promptRef) missing.push('--prompt-ref');
    if (!renderedPrompt) missing.push('--rendered-prompt');
    if (!action) missing.push('--action');
    if (!authorityRef) missing.push('--authority-ref');
    if (missing.length > 0) {
      throw new Error(
        `authorizing kind=authorized-action requires all four fields: ${missing.join(', ')}`,
      );
    }
    const validActions = ['affirmed-control', 'typed'];
    if (!validActions.includes(action)) {
      throw new Error(
        `authorizing kind=authorized-action action must be one of: ${validActions.join(', ')}`,
      );
    }
    return {
      kind: 'authorized-action',
      promptRef,
      renderedPrompt,
      action,
      authorityRef,
    };
  }

  throw new Error(
    'authorizing block has conflicting or ambiguous fields — supply exactly one of: statement, (prompt+response), or (promptRef+renderedPrompt+action+authorityRef)',
  );
}

/**
 * Compute an admissibility warning for an explicit-statement authorizing block.
 *
 * Produces a warning when the statement shares no token overlap with the
 * changed protected-standard field names and the change notes.
 *
 * @param {object} params
 * @param {{ kind: string, statement?: string }|null} params.authorizing
 * @param {string[]} params.changedFields - array of changed hash field names (e.g. ['repoStandardsHash'])
 * @param {string} params.notes - attestation notes / change summary
 * @returns {{ admissibilityWarning: boolean, admissibilityWarningReason: string|null }}
 */
export function computeAdmissibilityWarning({ authorizing, changedFields = [], notes = '' }) {
  if (!authorizing || authorizing.kind !== 'explicit-statement') {
    return { admissibilityWarning: false, admissibilityWarningReason: null };
  }

  const statementTokens = tokenize(authorizing.statement);
  if (statementTokens.size === 0) {
    return {
      admissibilityWarning: true,
      admissibilityWarningReason: 'explicit-statement is empty',
    };
  }

  // Build corpus: changed field names + notes
  const corpusText = [
    ...changedFields,
    notes,
    // Human-readable aliases for well-known field names
    'repostandardshash repo standards standard policy',
    'repomaphash repo map',
    'authoritysettingshash authority settings',
  ].join(' ');
  const corpusTokens = tokenize(corpusText);

  const hasOverlap = [...statementTokens].some((token) => corpusTokens.has(token));
  if (hasOverlap) {
    return { admissibilityWarning: false, admissibilityWarningReason: null };
  }

  return {
    admissibilityWarning: true,
    admissibilityWarningReason:
      `explicit-statement "${authorizing.statement}" shares no token overlap with the changed protected-standard fields or change notes`,
  };
}
