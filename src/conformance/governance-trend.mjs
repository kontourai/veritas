import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function buildGovernanceTrendSummary(entries) {
  if (entries.length === 0) {
    return {
      available_runs: 0,
      sampled_runs: 0,
      clean: 0,
      additive_only: 0,
      protected_standards_modification: 0,
      latest_non_clean_run_id: null,
      latest_non_clean_classification: null,
      summary: 'no prior governance history',
    };
  }

  const counts = {
    clean: entries.filter((entry) => entry.classification === 'clean').length,
    additive_only: entries.filter((entry) => entry.classification === 'additive-only').length,
    protected_standards_modification: entries.filter(
      (entry) => entry.classification === 'protected-standards-modification',
    ).length,
  };
  const latestNonClean = [...entries]
    .reverse()
    .find((entry) => entry.classification !== 'clean');

  const summary = `last ${entries.length} governance run(s): ${counts.clean} clean, ${counts.additive_only} additive-only, ${counts.protected_standards_modification} protected-standards-modification`;

  return {
    available_runs: entries.length,
    sampled_runs: entries.length,
    ...counts,
    latest_non_clean_run_id: latestNonClean?.run_id ?? null,
    latest_non_clean_classification: latestNonClean?.classification ?? null,
    summary,
  };
}

export function summarizeGovernanceTrend({
  rootDir,
  currentRunId,
  currentGovernanceSurface,
}) {
  const conformanceDir = resolve(rootDir, '.veritas/repo-conformance');
  if (!existsSync(conformanceDir) || !readdirSync(conformanceDir, { withFileTypes: false }).length) {
    return buildGovernanceTrendSummary([
      {
        run_id: currentRunId,
        classification: currentGovernanceSurface.classification,
      },
    ]);
  }

  const historical = [];
  for (const entry of readdirSync(conformanceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'latest.json') {
      continue;
    }
    const filePath = resolve(conformanceDir, entry.name);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!parsed?.governance_surface?.classification) {
      continue;
    }
    if (parsed.run_id === currentRunId) {
      continue;
    }
    historical.push({
      run_id: parsed.run_id,
      classification: parsed.governance_surface.classification,
      generated_at: parsed.generated_at ?? parsed.timestamp ?? null,
    });
  }

  historical.sort((left, right) =>
    String(left.generated_at ?? left.run_id).localeCompare(String(right.generated_at ?? right.run_id)),
  );
  const sampled = historical.slice(-9);
  sampled.push({
    run_id: currentRunId,
    classification: currentGovernanceSurface.classification,
    generated_at: null,
  });
  return buildGovernanceTrendSummary(sampled);
}
