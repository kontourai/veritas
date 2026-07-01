import { VERITAS_ARTIFACT_ROOT } from '../paths.mjs';

export const DEFAULT_SELECTED_INSTRUCTION_TARGETS = [
  { path: 'AGENTS.md', tool: 'codex', required: true },
  { path: 'CLAUDE.md', tool: 'claude-code', required: true },
];

export const OPTIONAL_INSTRUCTION_TARGETS = [
  { path: '.cursorrules', tool: 'cursor', required: false },
  {
    path: '.github/copilot-instructions.md',
    tool: 'github-copilot',
    required: false,
  },
];

function toolForInstructionPath(path) {
  if (path === 'AGENTS.md') return 'codex';
  if (path === 'CLAUDE.md') return 'claude-code';
  if (path === '.cursorrules') return 'cursor';
  if (path === '.github/copilot-instructions.md') return 'github-copilot';
  return 'agent';
}

export function normalizeInstructionTargets(targets) {
  if (!Array.isArray(targets)) return [...DEFAULT_SELECTED_INSTRUCTION_TARGETS];
  return targets.map((target) => {
    if (typeof target === 'string') {
      return {
        path: target,
        tool: toolForInstructionPath(target),
        required: target === 'AGENTS.md' || target === 'CLAUDE.md',
      };
    }
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error('selectedInstructionTargets must contain strings or target objects');
    }
    if (typeof target.path !== 'string' || target.path.length === 0) {
      throw new Error('selectedInstructionTargets entries require a path');
    }
    return {
      path: target.path,
      tool: typeof target.tool === 'string' && target.tool.length > 0 ? target.tool : toolForInstructionPath(target.path),
      required: typeof target.required === 'boolean' ? target.required : target.path === 'AGENTS.md' || target.path === 'CLAUDE.md',
    };
  });
}

export function selectedInstructionTargetsFromAnswers(answers) {
  return normalizeInstructionTargets(answers?.selectedInstructionTargets ?? answers?.selected_instruction_targets);
}

export function validateOwnerAnswers(answers) {
  if (answers === undefined || answers === null) return {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('init answers must be an object');
  }
  const allowedKeys = new Set([
    'evidenceCheck',
    'selectedInstructionTargets',
    'selected_instruction_targets',
    'boundaries',
    'codingStyle',
    'coding_style',
    'releaseExpectations',
    'release_expectations',
    'reviewRules',
    'review_rules',
    'protectedPaths',
    'protected_paths',
    'notes',
  ]);
  for (const key of Object.keys(answers)) {
    if (!allowedKeys.has(key)) throw new Error(`init answers contain unsupported key: ${key}`);
  }
  const selected = answers.selectedInstructionTargets ?? answers.selected_instruction_targets;
  if (selected !== undefined && !Array.isArray(selected)) {
    throw new Error('init answers selectedInstructionTargets must be an array');
  }
  return answers;
}

export function buildGovernanceInstructions() {
  return `# Veritas Governance

Protected Standards require authority-backed review. Do not modify without a fresh Veritas attestation:
- \`.veritas/repo-map.json\`
- \`.veritas/repo-standards/\`
- \`.veritas/authority/\`

Authority-backed attestations require an explicit human approval reference. Agents may prepare
\`veritas attest ... --approval-ref <ref>\` commands, but must not invent the reference or record
the attestation without a durable approval artifact from the human authority.

Standards Growth is additive. Developers and agents may propose:
- new work areas for new feature directories
- advisory requirements for new work areas
- clearer change guidance backed by evidence

Do not weaken or delete existing standards without the required authority.

Generated Evidence is output, not the source of standards:
- \`${VERITAS_ARTIFACT_ROOT}/evidence/\`
- \`${VERITAS_ARTIFACT_ROOT}/standards-feedback-drafts/\`
- \`${VERITAS_ARTIFACT_ROOT}/standards-feedback/\`
- \`${VERITAS_ARTIFACT_ROOT}/repo-conformance/\`
`;
}

export function buildSuggestedCodeownersBlock() {
  return `# Veritas protected standards - changes require authority-backed review
.veritas/repo-map.json  @your-team/governance
.veritas/repo-standards/      @your-team/governance
.veritas/authority/              @your-team/governance`;
}

export function buildSuggestedPackageScripts({
  evidenceCheck = 'npm test',
  baseRef = '<base-ref>',
}) {
  return {
    'veritas:init': 'npm exec -- veritas init',
    'veritas:status:codex': 'npm exec -- veritas integrations codex status',
    'veritas:check': 'npm exec -- veritas readiness --run-id local-smoke package.json',
    'veritas:check:working-tree': 'npm exec -- veritas readiness --working-tree',
    'veritas:check:diff': `npm exec -- veritas readiness --changed-from ${baseRef} --changed-to HEAD`,
    'veritas:coverage': 'npm exec -- veritas readiness --check coverage --working-tree',
    'veritas:evidence-check': evidenceCheck,
    'lint:governance': 'npm exec -- veritas readiness --format feedback --working-tree',
    'veritas:readiness': 'npm exec -- veritas readiness',
    'test:prepush': 'npm run veritas:evidence-check',
    'prepush': 'npm run test:prepush',
  };
}

export function buildSuggestedCiSnippet({
  evidenceCheck = 'npm test',
  baseRef = '<base-ref>',
}) {
  return `# Suggested Veritas CI snippet
- name: Run project evidenceCheck
  run: ${evidenceCheck}

- name: Generate Veritas readiness report
  run: npm exec -- veritas readiness --changed-from ${baseRef} --changed-to HEAD
`;
}
