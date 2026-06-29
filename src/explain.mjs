import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRepoMap, loadRepoStandards } from './load.mjs';
import { normalizeRepoPath } from './paths.mjs';
import { matchesPatterns } from './util/patterns.mjs';
import { evaluateWorkAreaBoundaryRule } from './rules/evaluate.mjs';
import { resolveVeritasPaths, listChangedFiles, listWorkingTreeFiles } from './report/index.mjs';
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

function ruleMatchesWorkAreaNode(rule, node, config) {
  if (!node) return false;
  const workArea = (config.graph?.nodes ?? []).find((item) => item.id === node);
  if (!workArea) return rule.id === node;
  return (workArea.patterns ?? []).some((pattern) => ruleMatchesFile(rule, pattern));
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
    `Enforcement Level: ${rule.enforcementLevel}`,
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
    enforcementLevel: 'Require',
    enforcement: 'deny',
    message: 'Protected standards changes require a current authority-backed attestation.',
    explain: {
      summary: 'Veritas hashes the Repo Map, Repo Standards, and authority settings as Protected Standards. Readiness checks fail on drift until a valid authority records a fresh attestation.',
      mustDo: [
        'Run `veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference>` after first installing Veritas governance.',
        'Run `veritas attest policy-change --actor <authority-id> --approval-ref <human-approval-reference> --message <reason>` after changing Protected Standards files.',
      ],
      mustNotDo: [
        'Do not treat generated evidence or agent edits as a substitute for authority-backed standards review.',
        'Do not invent an approval reference; stop and request explicit human approval when no durable approval artifact exists.',
      ],
      contextLinks: [
        'docs/guides/attestation.md',
        'docs/concepts.md#attestation',
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
      const report = record.trust?.report;
      const claim = report?.claims?.find((item) => {
        return item.value?.ruleId === ruleId || item.subjectId?.endsWith(`:${ruleId}`);
      });
      if (claim) {
        return {
          claim,
          transparencyGaps: report.transparencyGapsByClaimId?.[claim.id] ?? [],
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

export function buildExplainText({ rootDir, repoMap, repoStandards, ruleId, filePath, workArea }) {
  const normalizedFile = filePath ? normalizeRepoPath(filePath, rootDir) : null;
  const allRules = [...(repoStandards.rules ?? []), ...syntheticPolicyRules()];
  const selectedRules = allRules.filter((rule) => {
    if (ruleId) return rule.id === ruleId;
    if (normalizedFile) return ruleMatchesFile(rule, normalizedFile);
    if (workArea) return ruleMatchesWorkAreaNode(rule, workArea, repoMap);
    return false;
  });
  const lines = [
    'Veritas JIT Context',
    '',
    ...governanceExcerpt(rootDir).map((line) => `Governance: ${line}`),
  ];
  if (selectedRules.length === 0) {
    lines.push('', 'No matching requirement found.');
  }
  for (const rule of selectedRules) {
    lines.push('', ...explainRuleBlock(rule));
    const surfaceContext = latestSurfaceReportForRule(rootDir, rule.id);
    if (surfaceContext) {
      lines.push(`Surface status: ${surfaceContext.claim.status} (${surfaceContext.reportId})`);
      for (const transparencyGap of surfaceContext.transparencyGaps.slice(0, 3)) {
        lines.push(`Surface fault: ${transparencyGap.type} — ${transparencyGap.message}`);
      }
    }
  }
  return `${lines.slice(0, 80).join('\n')}\n`;
}

export function runExplainCli(argv = process.argv.slice(2), defaults = {}) {
  const { options, rest } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--repo-map': { type: 'string', key: 'repoMapPath' },
    '--repo-standards': { type: 'string', key: 'repoStandardsPath' },
    '--file': { type: 'string', key: 'filePath' },
    '--work-area': { type: 'string', key: 'workArea' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const { repoMapPath, repoStandardsPath } = resolveVeritasPaths({ ...options, rootDir }, { ...defaults, rootDir });
  const selector = rest[0];
  const repoMap = loadRepoMap(repoMapPath);
  const repoStandards = loadRepoStandards(repoStandardsPath);
  const selectorIsRule = [...(repoStandards.rules ?? []), ...syntheticPolicyRules()].some((rule) => rule.id === selector);
  const text = buildExplainText({
    rootDir,
    repoMap,
    repoStandards,
    ruleId: options.filePath || options.workArea ? null : selectorIsRule ? selector : null,
    filePath: options.filePath ?? (!options.workArea && !selectorIsRule && selector?.includes('/') ? selector : null),
    workArea: options.workArea ?? (!options.filePath && !selectorIsRule && selector && !selector.includes('/') ? selector : null),
  });
  process.stdout.write(text);
}

export function checkBoundaries({ rootDir, repoMap, actor, files }) {
  const rule = {
    id: 'work-area-boundary',
    kind: 'work-area-boundary',
    classification: 'hard-invariant',
    enforcementLevel: 'Require',
    message: 'Actors may only edit strict work areas they own or are explicitly allowed to cross.',
    match: {},
  };
  return evaluateWorkAreaBoundaryRule(rule, {
    rootDir,
    config: repoMap,
    actor,
    changedFiles: files,
  });
}

export function runBoundariesCheckCli(argv = process.argv.slice(2), defaults = {}) {
  const { options } = parseTokens(argv, {
    '--root': { type: 'string', key: 'rootDir' },
    '--repo-map': { type: 'string', key: 'repoMapPath' },
    '--actor': { type: 'string', key: 'actor' },
    '--diff': { type: 'string', key: 'diffRef' },
  });
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const { repoMapPath } = resolveVeritasPaths({ ...options, rootDir }, { ...defaults, rootDir });
  const repoMap = loadRepoMap(repoMapPath);
  const files = options.diffRef
    ? listChangedFiles(options.diffRef, 'HEAD', rootDir)
    : listWorkingTreeFiles({ staged: true, unstaged: true, untracked: true }, rootDir);
  const result = checkBoundaries({
    rootDir,
    repoMap,
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
