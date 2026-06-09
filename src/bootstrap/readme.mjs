export function buildBootstrapReadme({
  projectName,
  evidenceCheck = 'npm test',
  recommendationSummary = null,
  ownerAnswers = null,
  repoInsights = {
    repoKind: 'application',
    sourceRoots: [],
    toolingRoots: [],
    testRoots: [],
    hasWorkflows: false,
    matchedScripts: [],
  },
}) {
  return `# Veritas Starter Kit

This repo was bootstrapped for \`${projectName}\` with a conservative starter kit for agent-guided development.

## Generated Files

- \`.veritas/README.md\`
- \`.veritas/GOVERNANCE.md\`
- \`.veritas/repo-map.json\`
- \`.veritas/repo-standards/default.repo-standards.json\`
- \`.veritas/authority/default.authority-settings.json\`

## Inferred Repo Shape

- Repo kind: \`${repoInsights.repoKind}\`
- Source roots: ${
    repoInsights.sourceRoots.length > 0
      ? `\`${repoInsights.sourceRoots.join('`, `')}\``
      : '`src/` (default)'
  }
- Tooling roots: ${
    (repoInsights.toolingRoots ?? []).length > 0
      ? `\`${repoInsights.toolingRoots.join('`, `')}\``
      : '`none`'
  }
- Test roots: ${
    repoInsights.testRoots.length > 0
      ? `\`${repoInsights.testRoots.join('`, `')}\``
      : '`tests/` (default)'
  }
- GitHub workflows detected: \`${repoInsights.hasWorkflows ? 'yes' : 'no'}\`
- Matching scripts seen: ${
    repoInsights.matchedScripts.length > 0
      ? `\`${repoInsights.matchedScripts.join('`, `')}\``
      : '`none`'
  }

## What To Do Next

1. Confirm the inferred source/test roots match the real repo layout.
2. Replace the suggested evidenceCheck if a stronger project health command exists.
3. Keep uncertain requirements in Observe or Guide until evidence shows they should be required.

${
  recommendationSummary
    ? `## Initialization Recommendation\n\n${recommendationSummary}\n\n`
    : ''
}${
  ownerAnswers && Object.keys(ownerAnswers).length > 0
    ? `## Owner Answers\n\n\`\`\`json\n${JSON.stringify(ownerAnswers, null, 2)}\n\`\`\`\n\n`
    : ''
}

## Suggested Commands

\`\`\`bash
npx @kontourai/veritas readiness --working-tree
npx @kontourai/veritas readiness --check coverage --working-tree
npx @kontourai/veritas integrations codex status
npx @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
\`\`\`

If you prefer explicit paths:

\`\`\`bash
npx @kontourai/veritas readiness --check evidence \\
  --repo-map ./.veritas/repo-map.json \\
  --repo-standards ./.veritas/repo-standards/default.repo-standards.json \\
  package.json
\`\`\`

## Suggested Evidence Check

\`${evidenceCheck}\`

## Work-Area Evidence Routing

${
  repoInsights.enableWorkAreaEvidenceRouting
    ? 'This repo shape justifies work-area evidence routing, so the starter Repo Map also includes `defaultEvidenceCheckIds` and `uncoveredPathPolicy` alongside explicit evidence-check objects.'
    : 'This starter stays on the minimal single-check path by default. Work-area evidence routing can be added later if the repo grows multiple independently verified work areas.'
}

## Why This Exists

The goal is to give developers and agents just-in-time repo guidance from day one, while keeping review and CI grounded in the same starter standards.
`;
}
