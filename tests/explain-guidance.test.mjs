import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildExplainGuidance, buildExplainText, writeBootstrapStarterKit } from '../src/index.mjs';
import { initCommittedRepo } from './helpers.mjs';

test('structured explain and text explain select the same rules for a file', () => {
  const rootDir = initCommittedRepo('veritas-explain-guidance-');
  writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ scripts: { test: 'node --version' } }));
  writeBootstrapStarterKit({ rootDir, projectName: 'guidance-fixture', evidenceCheck: 'npm test', force: true });
  const map = JSON.parse(readFileSync(join(rootDir, '.veritas/repo-map.json'), 'utf8'));
  const standardsPath = join(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const standards = JSON.parse(readFileSync(standardsPath, 'utf8'));
  standards.rules.push({
    id: 'docs-review',
    kind: 'required-artifacts',
    classification: 'promotable-policy',
    enforcementLevel: 'Guide',
    message: 'Review docs.',
    explain: { summary: 'Review docs intent.', mustDo: ['Verify the source.'] },
    match: { artifacts: ['docs/notes.md'] },
  });
  writeFileSync(standardsPath, `${JSON.stringify(standards, null, 2)}\n`);

  const input = { rootDir, repoMap: map, repoStandards: standards, filePath: 'docs/notes.md' };
  const structured = buildExplainGuidance(input);
  const text = buildExplainText(input);
  assert.deepEqual(structured.rules.map((rule) => rule.id), ['docs-review']);
  assert.match(text, /Rule: docs-review/);

  const output = execFileSync(process.execPath, [
    'bin/veritas.mjs', 'explain', '--root', rootDir, '--file', 'docs/notes.md', '--json',
  ], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), structured);
  assert.deepEqual(
    buildExplainGuidance({ ...input, filePath: 'docs/other.md' }).rules,
    [],
  );
});
