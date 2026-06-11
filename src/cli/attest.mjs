import { resolve } from 'node:path';
import { parseAttestArgs } from '../args.mjs';
import {
  createAttestation,
  inspectAttestationStatus,
} from '../attestations.mjs';

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
  const result = createAttestation({
    rootDir,
    kind,
    actor: options.actor,
    displayName: options.displayName,
    notes: options.message ?? '',
    approvalRef: options.approvalRef,
    validUntilDays: options.validUntilDays,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
