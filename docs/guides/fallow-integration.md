# Fallow Integration

Use this guide when a JavaScript or TypeScript repo wants Veritas to record Fallow codebase-intelligence results as external-tool evidence.

Fallow and Veritas should stay separate:

- Fallow finds codebase facts: unused code, duplicate logic, circular dependencies, complexity hotspots, architecture boundary violations, and optional runtime hot/cold-path evidence.
- Veritas governs whether those facts were checked, baselined, promoted, and shown to agents before they finish work.
- Veritas records Fallow results as an external-tool evidenceCheck (advisory or blocking).
- Surface receives the normalized `trust.bundle` projection from Veritas evidence; Veritas does not become a second trust report generator.

## Start Advisory

Do not make Fallow blocking on the first day in an existing repo. A first run often reveals real cleanup debt that should be triaged before it becomes a gate.

For example, a one-off Fallow smoke on this Veritas checkout reported:

- 8 unused exports
- 19 clone groups
- 4.5% duplicated lines
- 100 functions above threshold

That is useful evidence, but it is not a reason to fail every Veritas readiness check before the repo has either cleaned up the issues or committed an intentional baseline.

## External-Tool Evidence Checks

Veritas evidence checks can declare an external tool via the `externalTool` field. The external tool produces a JSON artifact that Veritas reads and normalizes into evidence.

Keep compound shell behavior in a script because Veritas evidence-check commands are tokenized argv, not implicit shell snippets.

Example Repo Map check:

```json
{
  "id": "fallow-advisory",
  "command": "npm run veritas:fallow:advisory",
  "method": "auditability",
  "summary": "Runs Fallow audit as advisory codebase-intelligence evidence.",
  "externalTool": {
    "tool": "fallow",
    "format": "fallow-audit-json",
    "blocking": false,
    "artifactPath": ".kontourai/veritas/external/fallow-audit.json"
  }
}
```

Example script:

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('.kontourai/veritas/external', { recursive: true });

let output = '';
try {
  output = execFileSync(
    'npx',
    ['-y', 'fallow', '--format', 'json', '--quiet'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (error) {
  // Fallow exit code 1 means findings were reported. Keep the JSON artifact
  // so Veritas can decide whether this lane is advisory or blocking.
  if (error.status !== 1 || !error.stdout) throw error;
  output = error.stdout;
}

const payload = JSON.parse(output);
const summary = {
  dead_code_issues: payload.check?.total_issues ?? 0,
  duplication_clone_groups: payload.dupes?.stats?.clone_groups ?? 0,
  duplication_percent: payload.dupes?.stats?.duplication_percentage ?? 0,
  complexity_findings: payload.health?.summary?.functions_above_threshold ?? 0,
  average_maintainability: payload.health?.summary?.average_maintainability ?? 0,
};
const baseline = {
  dead_code_issues: 0,
  duplication_clone_groups: 0,
  complexity_findings: 0,
};
const deltas = Object.fromEntries(
  Object.entries(baseline).map(([key, value]) => [key, Math.max(0, summary[key] - value)]),
);
const findingsAboveBaseline = Object.values(deltas).reduce((sum, value) => sum + value, 0);

writeFileSync(
  '.kontourai/veritas/external/fallow-audit.json',
  `${JSON.stringify({
    schema_version: 'veritas-fallow-advisory-v1',
    tool: 'fallow',
    verdict: findingsAboveBaseline > 0 ? 'warn' : 'pass',
    summary,
    baseline,
    deltas,
  }, null, 2)}\n`,
  'utf8',
);
```

Then include the check as a default or routed evidenceCheck while it is advisory. Promote it to required only after the team has reviewed the results.

## Baseline Existing Debt

If the repo is not ready for full cleanup, use Fallow baselines deliberately:

```bash
fallow dead-code --save-baseline fallow-baselines/dead-code.json
fallow health --save-baseline fallow-baselines/health.json
fallow dupes --save-baseline fallow-baselines/dupes.json
```

Keep committed baselines outside `.fallow/`. The `.fallow/` directory is cache/local data and should not become the reviewable migration contract.

For an advisory lane, prefer warning only on findings above the committed baseline. The artifact should still include the raw Fallow counts so reviewers can see total debt, but the Veritas verdict should stay `pass` when the repo is no worse than the accepted baseline.

After baseline, run:

```bash
fallow audit \
  --dead-code-baseline fallow-baselines/dead-code.json \
  --health-baseline fallow-baselines/health.json \
  --dupes-baseline fallow-baselines/dupes.json \
  --format json \
  --quiet
```

## Promotion Path

1. **Advisory** — Veritas records Fallow output as `external_tool_results`, but non-pass verdicts are warnings.
2. **Candidate** — the evidence-check inventory item has an owner, review trigger, and recent catch evidence.
3. **Required** — the Fallow check is blocking only after standards feedback shows useful catches and tolerable false positives.

If Fallow Runtime is available, treat hot/cold-path findings the same way: external evidence first, promotion only after the repo has a reviewable baseline and owner.
