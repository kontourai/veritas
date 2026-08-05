import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseApplyArgs, parsePreToolUseArgs } from '../args.mjs';
import { evaluatePreToolUse } from '../hooks.mjs';
import { runtimeIntegrationFor } from '../integrations/runtime-integrations.mjs';

export function runClaudeCodePreToolUseCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePreToolUseArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const stdinText = readFileSync(0, 'utf8');
  const result = evaluatePreToolUse({
    rootDir,
    filePath: options.filePath,
    actor: options.actor,
    stdinText,
  });
  const output = { decision: result.decision, reason: result.reason };
  if (result.exceptionPath) output.exceptionPath = result.exceptionPath;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (result.skipped) {
    process.stderr.write(
      `Veritas: PreToolUse gate skipped (VERITAS_HOOK_SKIP=1); bypass recorded in ${result.exceptionPath}\n`,
    );
  }
  // Claude Code's PreToolUse protocol treats exit 2 as "block"; any other
  // non-zero exit is a non-blocking error and the tool call proceeds.
  if (result.decision === 'block') {
    process.exitCode = 2;
  }
}

export function runIntegrationsCli(tool, action, argv = process.argv.slice(2), defaults = {}) {
  const options = parseApplyArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const integration = runtimeIntegrationFor(tool, rootDir, options);
  let result;
  if (action === 'status') {
    result = integration.status();
  } else if (action === 'install') {
    result = {
      preToolUse: integration.installPreToolUseHook(options),
      stop: integration.installStopHook(options),
      postSession: integration.installPostSessionHook(options),
    };
  } else if (action === 'uninstall') {
    result = integration.uninstall(options);
  } else {
    throw new Error(`Unsupported integrations action: ${action}`);
  }
  process.stdout.write(`${JSON.stringify({ tool, action, rootDir, ...result }, null, 2)}\n`);
}
