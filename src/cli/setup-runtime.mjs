import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseApplyArgs, parsePreToolUseArgs } from '../args.mjs';
import { evaluatePreToolUse } from '../hooks.mjs';
import { formatPreToolUseGuidance } from '../hooks/pre-tool-use.mjs';
import { runtimeIntegrationFor } from '../integrations/runtime-integrations.mjs';
import { evaluateCodexPreToolUse } from '../hooks/codex-pre-tool-use.mjs';
import { prepareGuidanceBriefing } from '../hooks/guidance-briefing.mjs';

function codexHookRoot(options, defaults, stdinText) {
  if (options.rootDir) return resolve(options.rootDir);
  let cwd = defaults.rootDir ?? process.cwd();
  try {
    const payload = JSON.parse(stdinText);
    if (typeof payload?.cwd === 'string' && payload.cwd.length > 0) cwd = payload.cwd;
  } catch {
    // The evaluator reports malformed input as a blocking decision.
  }
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return resolve(cwd);
  }
}

export function runCodexPreToolUseCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parsePreToolUseArgs(argv);
  const stdinText = readFileSync(0, 'utf8');
  const rootDir = codexHookRoot(options, defaults, stdinText);
  const result = evaluateCodexPreToolUse({ rootDir, stdinText, actor: options.actor });
  const briefing = result.decision === 'block'
    ? { guidanceContext: '' }
    : prepareGuidanceBriefing({ rootDir, stdinText, guidanceContext: result.guidanceContext });
  const output = { decision: result.decision, reason: result.reason, paths: result.paths };
  if (result.exceptionPath) output.exceptionPath = result.exceptionPath;
  if (result.decision === 'block') {
    output.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: result.reason,
    };
    process.exitCode = 2;
  } else if (briefing.guidanceContext) {
    output.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      additionalContext: briefing.guidanceContext,
    };
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  briefing.record?.();
  if (result.skipped) {
    process.stderr.write(`Veritas: Codex PreToolUse gate skipped; bypass recorded in ${result.exceptionPath}\n`);
  }
}

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
  const guidanceContext = result.guidance?.rules?.length > 0 && !result.skipped
    ? formatPreToolUseGuidance(result.guidance) : '';
  const briefing = result.decision === 'block'
    ? { guidanceContext: '' }
    : prepareGuidanceBriefing({ rootDir, stdinText, guidanceContext });
  const output = { decision: result.decision, reason: result.reason };
  if (briefing.guidanceContext) {
    output.guidance = result.guidance;
    output.hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      additionalContext: briefing.guidanceContext,
    };
  }
  if (result.exceptionPath) output.exceptionPath = result.exceptionPath;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  briefing.record?.();
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
