import { resolve } from 'node:path';
import { parseAttestArgs } from '../args.mjs';
import {
  createAttestation,
  inspectAttestationStatus,
} from '../attestations.mjs';
import { buildAuthorizing } from '../attestations/collection.mjs';

export function runAttestCli(kind, argv = process.argv.slice(2), defaults = {}) {
  const options = parseAttestArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  if (kind === 'status') {
    process.stdout.write(`${JSON.stringify(inspectAttestationStatus(rootDir), null, 2)}\n`);
    return;
  }
  if (!['bootstrap', 'policy-change'].includes(kind)) {
    throw new Error(`Unsupported attest command: ${kind}`);
  }

  // Build the authorizing block from CLI options.
  // When --executed-by is present, it must be paired with either
  // --authorizing-statement OR (--authorizing-prompt AND --authorizing-response).
  let authorizing = null;
  if (options.executedBy) {
    const hasStatement = typeof options.authorizingStatement === 'string' && options.authorizingStatement.trim() !== '';
    const hasPrompt = typeof options.authorizingPrompt === 'string' && options.authorizingPrompt.trim() !== '';
    const hasResponse = typeof options.authorizingResponse === 'string' && options.authorizingResponse.trim() !== '';
    if (!hasStatement && !hasPrompt && !hasResponse) {
      throw new Error(
        '--executed-by requires either --authorizing-statement OR (--authorizing-prompt AND --authorizing-response)',
      );
    }
    authorizing = buildAuthorizing({
      statement: options.authorizingStatement,
      prompt: options.authorizingPrompt,
      response: options.authorizingResponse,
      excerptSource: options.excerptSource,
      promptRef: options.promptRef,
      renderedPrompt: options.renderedPrompt,
      action: options.action,
      authorityRef: options.authorityRef,
    });
  } else {
    // Attempt to build authorizing from whichever fields were supplied (all optional).
    try {
      authorizing = buildAuthorizing({
        statement: options.authorizingStatement,
        prompt: options.authorizingPrompt,
        response: options.authorizingResponse,
        excerptSource: options.excerptSource,
        promptRef: options.promptRef,
        renderedPrompt: options.renderedPrompt,
        action: options.action,
        authorityRef: options.authorityRef,
      });
    } catch (error) {
      throw new Error(`attest authorizing block error: ${error.message}`);
    }
  }

  const result = createAttestation({
    rootDir,
    kind,
    actor: options.actor,
    displayName: options.displayName,
    notes: options.message ?? '',
    approvalRef: options.approvalRef,
    validUntilDays: options.validUntilDays,
    authorizing,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
