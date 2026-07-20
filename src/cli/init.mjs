import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { parseInitArgs } from '../args.mjs';
import { writeBootstrapStarterKit } from '../bootstrap.mjs';
import {
  buildInitRecommendation,
  applyInitRecommendation,
} from '../bootstrap/recommendation.mjs';
import { writePendingAttestationMarker } from '../attestations.mjs';
import { loadJson } from '../load.mjs';
import { assertWithinDir } from '../paths.mjs';

export function runInitCli(argv = process.argv.slice(2), defaults = {}) {
  const options = parseInitArgs(argv);
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const projectName = options.projectName ?? defaults.projectName ?? basename(rootDir);
  if (options.explore && options.apply) {
    throw new Error('veritas init cannot combine --explore and --apply');
  }
  if (options.apply && !options.planPath) {
    throw new Error('veritas init --apply requires --plan <path>');
  }
  if (options.answersPath && !options.guided) {
    throw new Error('veritas init --answers requires --guided');
  }
  if (options.template && (options.explore || options.guided || options.apply)) {
    throw new Error('veritas init --template is only supported on the direct init path');
  }

  if (options.explore || options.guided) {
    const answers = options.answersPath ? loadJson(resolve(rootDir, options.answersPath), 'init answers') : undefined;
    const recommendation = buildInitRecommendation({
      rootDir,
      projectName,
      evidenceCheck: options.evidenceCheck ?? defaults.evidenceCheck,
      answers,
      mode: options.guided ? 'guided' : 'explore',
    });
    const outputPath = resolve(
      rootDir,
      options.outputPath ?? `.veritas/init-plans/${options.guided ? 'guided' : 'explore'}.json`,
    );
    const allowedDir = resolve(rootDir, '.veritas/init-plans');
    assertWithinDir(outputPath, allowedDir, 'init --output must stay inside .veritas/init-plans/');
    recommendation.output_path = relative(rootDir, outputPath).replaceAll('\\', '/');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(recommendation, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(recommendation, null, 2)}\n`);
    return;
  }

  if (options.apply) {
    const planPath = resolve(rootDir, options.planPath);
    const recommendation = loadJson(planPath, 'init recommendation');
    const result = applyInitRecommendation({
      rootDir,
      recommendation,
      force: options.force ?? false,
    });
    process.stderr.write(
      `Next Steps\n\nSuggested CODEOWNERS block for protected standards (not written automatically):\n\n${result.codeownersBlock}\n\n`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const result = writeBootstrapStarterKit({
    rootDir,
    projectName,
    evidenceCheck: options.evidenceCheck ?? defaults.evidenceCheck,
    template: options.template,
    force: options.force ?? false,
  });
  if (options.nonInteractive) {
    result.attestation = writePendingAttestationMarker(rootDir, {
      reason: 'veritas init ran in non-interactive mode.',
    });
  } else {
    result.attestation = {
      status: 'not-recorded',
      suggestedCommand: `veritas attest bootstrap --actor <authority-id> --approval-ref <approval-reference> --non-interactive --root ${rootDir}`,
    };
  }

  process.stderr.write(
    `Next Steps\n\nSuggested CODEOWNERS block for protected standards (not written automatically):\n\n${result.codeownersBlock}\n\n`,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
