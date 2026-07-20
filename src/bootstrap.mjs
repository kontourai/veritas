import { basename, relative, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildGovernanceBlock, replaceGovernanceBlock } from './governance.mjs';
import { buildBaselineClaims } from './claims/templates.mjs';
import { inferBootstrapRepoInsights } from './bootstrap/insights.mjs';
import { buildBootstrapReadme } from './bootstrap/readme.mjs';
import {
  buildAdaptiveNodes,
  buildStarterAuthoritySettings,
  buildStarterRepoMap,
  buildStarterRepoStandards,
  loadStarterRepoStandards,
  slugifyProjectName,
} from './bootstrap/starter-artifacts.mjs';
import {
  buildGovernanceInstructions,
  buildSuggestedCiSnippet,
  buildSuggestedCodeownersBlock,
  buildSuggestedPackageScripts,
  normalizeInstructionTargets,
  selectExistingInstructionTargets,
  validateInstructionTargetPaths,
} from './bootstrap/guidance.mjs';
import { mergeGeneratedOutputIgnores } from './bootstrap/generated-output-ignore.mjs';
import { veritasArtifactPath } from './paths.mjs';

export {
  buildBootstrapReadme,
  inferBootstrapRepoInsights,
  buildStarterAuthoritySettings,
  buildStarterRepoMap,
  buildStarterRepoStandards,
  buildSuggestedCiSnippet,
  buildSuggestedPackageScripts,
  slugifyProjectName,
};

export function buildBootstrapStarterKitPlan({
  rootDir,
  projectName = basename(resolve(rootDir)),
  evidenceCheck,
  instructionTargets,
  template,
}) {
  const repoInsights = inferBootstrapRepoInsights(rootDir);
  const resolvedEvidenceCheck = evidenceCheck ?? repoInsights.evidenceCheck;
  const selectedInstructionTargets = instructionTargets === undefined
    ? selectExistingInstructionTargets(rootDir)
    : normalizeInstructionTargets(instructionTargets);
  validateInstructionTargetPaths(rootDir, selectedInstructionTargets, 'bootstrap');
  const repoMapPath = resolve(rootDir, '.veritas/repo-map.json');
  const repoStandardsPath = resolve(rootDir, '.veritas/repo-standards/default.repo-standards.json');
  const authoritySettingsPath = resolve(rootDir, '.veritas/authority/default.authority-settings.json');
  const readmePath = resolve(rootDir, '.veritas/README.md');
  const governancePath = resolve(rootDir, '.veritas/GOVERNANCE.md');
  const claimStorePath = resolve(rootDir, 'veritas.claims.json');
  const requiredInstructionFiles = selectedInstructionTargets.map((target) => resolve(rootDir, target.path));
  const starterRepoMap = buildStarterRepoMap({ projectName, evidenceCheck: resolvedEvidenceCheck, repoInsights, instructionTargets: selectedInstructionTargets });
  const governanceBlock = buildGovernanceBlock();
  const files = [
    [repoMapPath, starterRepoMap],
    [repoStandardsPath, loadStarterRepoStandards(template) ?? buildStarterRepoStandards({ projectName, instructionTargets: selectedInstructionTargets })],
    [authoritySettingsPath, buildStarterAuthoritySettings({ projectName, evidenceCheck: resolvedEvidenceCheck })],
    [claimStorePath, {
      schemaVersion: 1,
      producer: 'veritas',
      ...buildBaselineClaims(projectName, {
        hasGovernance: true,
        evidenceCheckCommands: [resolvedEvidenceCheck],
        workAreas: starterRepoMap.graph?.nodes ?? [],
      }),
    }],
  ];
  const textFiles = [
    [readmePath, buildBootstrapReadme({ projectName, evidenceCheck: resolvedEvidenceCheck, repoInsights })],
    [governancePath, buildGovernanceInstructions()],
    ...requiredInstructionFiles.map((instructionPath) => {
      const existingContent = existsSync(instructionPath)
        ? readFileSync(instructionPath, 'utf8')
        : '';
      return [instructionPath, replaceGovernanceBlock(existingContent, governanceBlock)];
    }),
  ];

  return {
    rootDir,
    projectName,
    template: template ?? null,
    evidenceCheck: resolvedEvidenceCheck,
    repoInsights,
    selectedInstructionTargets,
    files,
    textFiles,
    instructionFiles: requiredInstructionFiles,
    directories: [
      resolve(rootDir, '.veritas/repo-standards'),
      resolve(rootDir, '.veritas/authority'),
      veritasArtifactPath(rootDir, 'evidence'),
    ],
    codeownersBlock: buildSuggestedCodeownersBlock(),
    generatedFiles: [
      relative(rootDir, readmePath).replaceAll('\\', '/'),
      relative(rootDir, governancePath).replaceAll('\\', '/'),
      relative(rootDir, repoMapPath).replaceAll('\\', '/'),
      relative(rootDir, repoStandardsPath).replaceAll('\\', '/'),
      relative(rootDir, authoritySettingsPath).replaceAll('\\', '/'),
      relative(rootDir, claimStorePath).replaceAll('\\', '/'),
      ...requiredInstructionFiles.map((filePath) =>
        relative(rootDir, filePath).replaceAll('\\', '/'),
      ),
    ],
  };
}

export function writeBootstrapStarterKit({
  rootDir,
  projectName = basename(resolve(rootDir)),
  evidenceCheck,
  instructionTargets,
  template,
  force = false,
}) {
  const plan = buildBootstrapStarterKitPlan({
    rootDir,
    projectName,
    evidenceCheck,
    instructionTargets,
    template,
  });

  for (const [filePath] of plan.files) {
    if (existsSync(filePath) && !force) {
      throw new Error(
        `Refusing to overwrite existing file: ${relative(rootDir, filePath)} (use --force to replace it)`,
      );
    }
  }
  const instructionFileSet = new Set(plan.instructionFiles.map((filePath) => resolve(filePath)));
  for (const [filePath] of plan.textFiles) {
    if (instructionFileSet.has(resolve(filePath))) continue;
    if (existsSync(filePath) && !force) {
      throw new Error(
        `Refusing to overwrite existing file: ${relative(rootDir, filePath).replaceAll('\\', '/')} (use --force to replace it)`,
      );
    }
  }

  for (const directory of plan.directories) mkdirSync(directory, { recursive: true });

  for (const [filePath, payload] of plan.files) {
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  for (const [filePath, payload] of plan.textFiles) {
    writeFileSync(filePath, payload, 'utf8');
  }
  const ignoreResult = mergeGeneratedOutputIgnores(rootDir);

  return {
    rootDir: plan.rootDir,
    projectName: plan.projectName,
    template: plan.template,
    evidenceCheck: plan.evidenceCheck,
    repoInsights: plan.repoInsights,
    codeownersBlock: plan.codeownersBlock,
    generatedFiles: [
      ...plan.generatedFiles,
      ...(ignoreResult.changed ? [ignoreResult.path] : []),
    ],
    generatedOutputIgnores: ignoreResult.addedEntries,
  };
}
