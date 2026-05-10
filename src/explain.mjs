import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAdapterConfig, loadPolicyPack } from './load.mjs';
import { normalizeRepoPath } from './paths.mjs';
import { matchesPatterns } from './util/patterns.mjs';
import { evaluateCrossSurfaceWriteRule } from './rules/evaluate.mjs';
import { resolveVeritasPaths, listChangedFiles, listWorkingTreeFiles } from './report.mjs';
import { parseTokens } from './args.mjs';

function ruleMatchesFile(rule, filePath) {
  if (!filePath) return false;
  const match = rule.match ?? {};
  if (Array.isArray(match.artifacts)) return matchesPatterns(filePath, match.artifacts);
  if (Array.isArray(match['governance-block'])) return matchesPatterns(filePath, match['governance-block']);
  if (typeof match['if-changed'] === 'string' || typeof match['then-require'] === 'string') {
    return matchesPatterns(filePath, [match['if-changed'], match['then-require']].filter(Boolean));
  }
  if (Array.isArray(match.files)) return matchesPatterns(filePath, match.files);
  return false;
}

function ruleMatchesSurfaceNode(rule, node, config) {
  if (!node) return false;
  const surfaceNode = (config.graph?.nodes ?? []).find((item) => item.id === node);
  if (!surfaceNode) return rule.id === node;
  return (surfaceNode.patterns ?? []).some((pattern) => ruleMatchesFile(rule, pattern));
}

function governanceExcerpt(rootDir) {
  const governancePath = resolve(rootDir, '.veritas/GOVERNANCE.md');
  if (!existsSync(governancePath)) return [];
  return readFileSync(governancePath, 'utf8')
    .split('\n')
    .slice(0, 12)
    .filter(Boolean);
}

function explainRuleBlock(rule) {
  const explain = rule.explain ?? {};
  const lines = [
    `Rule: ${rule.id}`,
    `Kind: ${rule.kind}`,
    `Stage: ${rule.stage}`,
    `Summary: ${explain.summary ?? rule.message}`,
  ];
  for (const item of explain.mustDo ?? []) lines.push(`Do: ${item}`);
  for (const item of explain.mustNotDo ?? []) lines.push(`Do not: ${item}`);
  if (explain.exampleGood) lines.push(`Good: ${explain.exampleGood}`);
  if (explain.exampleBad) lines.push(`Bad: ${explain.exampleBad}`);
  for (const link of explain.contextLinks ?? []) lines.push(`Context: ${link}`);
  return lines;
}

function syntheticPolicyRules() {
  return [{
    id: 'policy-changes-require-attestation',
    kind: 'human-attestation',
    classification: 'hard-invariant',
    stage: 'block',
    enforcement: 'deny',
    message: 'Zone 1 governance changes require a current human attestation.',
    explain: {
      summary: 'Veritas hashes the adapter, policy pack, and team profile as Zone 1. Shadow runs fail on drift until a human records a fresh attestation.',
      mustDo: [
        'Run `veritas attest bootstrap --actor <human-id>` after first installing Veritas governance.',
        'Run `veritas attest policy-change --actor <human-id> --message <reason>` after changing Zone 1 files.',
      ],
      mustNotDo: [
        'Do not treat generated evidence or agent edits as a substitute for human governance review.',
      ],
      contextLinks: [
        'docs/guides/attestation.md',
        'docs/concepts.md#human-attestation',
      ],
    },
  }];
}

function latestSurfaceReportForRule(rootDir, ruleId) {
  const evidenceDir = resolve(rootDir, '.veritas/evidence');
  if (!ruleId || !existsSync(evidenceDir)) return null;
  const candidates = readdirSync(evidenceDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const path = resolve(evidenceDir, file);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    try {
      const record = JSON.parse(readFileSync(candidate.path, 'utf8'));
      const report = record.surface?.report;
      const claim = report?.claims?.find((item) => {
        return item.value?.ruleId === ruleId || item.subjectId?.endsWith(`:${ruleId}`);
      });
      if (claim) {
        return {
          claim,
          faultLines: report.faultLinesByClaimId?.[claim.id] ?? [],
          reportId: report.id,
          generatedAt: report.generatedAt,
        };
      }
    } catch {
      // Ignore malformed or partial evidence records while explaining current context.
    }
  }
  return null;
}

export function buildExplainText({ rootDir, adapter, policyPack, ruleId, filePath, surfaceNode }) {
  const normalizedFile = filePath ? normalizeRepoPath(filePath, rootDir) : null;
  const allRules = [...(policyPack.rules ?? []), ...syntheticPolicyRules()];
  const selectedRules = allRules.filter((rule) => {
    if (ruleId) return rule.id === ruleId;
    if (normalizedFile) return ruleMatchesFile(rule, normalizedFile);
    if (surfaceNode) return ruleMatchesSurfaceNode(rule, surfaceNode, adapter);
    return false;
  });
  const lines = [
    'Veritas JIT Context',
    '',
    ...governanceExcerpt(rootDir).map((line) => `Governance: ${line}`),
  ];
  if (selectedRules.length === 0) {
    lines.push('', 'No matching policy rule found.');
  }
  for (const rule of selectedRules) {
    lines.push('', ...explainRuleBlock(rule));
    const surfaceContext = latestSurfaceReportForRule(rootDir, rule.id);
    if (surfaceContext) {
      lines.push(`Surface status: ${surfaceContext.claim.status} (${surfaceContext.reportId})`);
      for (const faultLine of surfaceContext.faultLines.slice(0, 3)) {
        lines.push(`Surface fault: ${faultLine.type} — ${faultLine.message}`);
      }
    }
  }
  return `${lines.slice(0, 80).join('\n')}\n`;
}

export function runExplainCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rest } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--adapter': { type: 'string', key: 'adapterPath' },
    '--policy-pack': { type: 'string', key: 'policyPackPath' },
    '--file': { type: 'string', key: 'filePath' },
    '--surface-node': { type: 'string', key: 'surfaceNode' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const { adapterPath, policyPackPath } = resolveVeritasPaths({ ...options, rootDir }, { ...defaults, rootDir });
  const selector = rest[0];
  const adapter = loadAdapterConfig(adapterPath);
  const policyPack = loadPolicyPack(policyPackPath);
  const selectorIsRule = [...(policyPack.rules ?? []), ...syntheticPolicyRules()].some((rule) => rule.id === selector);
  const text = buildExplainText({
    rootDir,
    adapter,
    policyPack,
    ruleId: options.filePath || options.surfaceNode ? null : selectorIsRule ? selector : null,
    filePath: options.filePath ?? (!options.surfaceNode && !selectorIsRule && selector?.includes('/') ? selector : null),
    surfaceNode: options.surfaceNode ?? (!options.filePath && !selectorIsRule && selector && !selector.includes('/') ? selector : null),
  });
  process.stdout.write(text);
}

export function checkBoundaries({ rootDir, adapter, actor, files }) {
  const rule = {
    id: 'cross-surface-write',
    kind: 'cross-surface-write',
    classification: 'hard-invariant',
    stage: 'block',
    message: 'Actors may only edit strict surfaces they own or are explicitly allowed to cross.',
    match: {},
  };
  return evaluateCrossSurfaceWriteRule(rule, {
    rootDir,
    config: adapter,
    actor,
    changedFiles: files,
  });
}

export function runBoundariesCheckCli(argv = process.argv.slice(2), defaults = {}) {
  const { options } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--adapter': { type: 'string', key: 'adapterPath' },
    '--actor': { type: 'string', key: 'actor' },
    '--diff': { type: 'string', key: 'diffRef' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const { adapterPath } = resolveVeritasPaths({ ...options, rootDir }, { ...defaults, rootDir });
  const adapter = loadAdapterConfig(adapterPath);
  const files = options.diffRef
    ? listChangedFiles(options.diffRef, 'HEAD', rootDir)
    : listWorkingTreeFiles({ staged: true, unstaged: true, untracked: true }, rootDir);
  const result = checkBoundaries({
    rootDir,
    adapter,
    actor: options.actor ?? process.env.VERITAS_ACTOR ?? null,
    files,
  });
  const status = result.passed ? 'PASS' : 'FAIL';
  process.stdout.write(`${status} ${result.rule_id}: ${result.summary}\n`);
  for (const finding of result.findings) {
    process.stdout.write(`      -> ${finding.artifact} (${finding.node}): ${finding.remediation}\n`);
  }
  if (!result.passed) process.exitCode = 1;
}
