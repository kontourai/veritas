import { readFileSync, readdirSync } from 'node:fs';

const rootUrl = new URL('../', import.meta.url);

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, rootUrl), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(new URL(relativePath, rootUrl), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const readme = readText('README.md');
assert(
  readme.includes('## What This Project Ships'),
  'README must explain what the project ships.',
);
assert(
  readme.includes('## Quickstart'),
  'README must include a quickstart section.',
);
assert(
  readme.includes('docs/reference/cli.md'),
  'README must link to the CLI reference.',
);
assert(
  readme.includes('docs/reference/artifacts-and-schemas.md'),
  'README must link to the artifacts and schemas reference.',
);
assert(
  readme.includes('docs/reference/examples.md'),
  'README must link to the example fixtures reference.',
);
assert(
  readme.includes('## Dogfooding'),
  'README must include a dogfooding section.',
);
assert(
  readme.includes('veritas:dogfood:examples'),
  'README must mention the dogfood example command.',
);
assert(
  readme.includes('.github/workflows/veritas-dogfood.yml'),
  'README must mention the dogfood workflow.',
);

const docsIndex = readText('docs/README.md');
assert(
  docsIndex.includes('## Guides'),
  'Docs index must include a guides section.',
);
assert(
  docsIndex.includes('## Reference'),
  'Docs index must include a reference section.',
);
assert(
  docsIndex.includes('## Design'),
  'Docs index must include a design section.',
);
assert(
  docsIndex.includes('reference/cli.md'),
  'Docs index must link to the CLI reference.',
);
assert(
  docsIndex.includes('reference/artifacts-and-schemas.md'),
  'Docs index must link to the artifacts and schemas reference.',
);
assert(
  docsIndex.includes('reference/examples.md'),
  'Docs index must link to the example fixtures reference.',
);
assert(
  docsIndex.includes('guides/dogfooding-veritas.md'),
  'Docs index must link to the dogfooding guide.',
);

const cliReference = readText('docs/reference/cli.md');
assert(
  cliReference.includes('All commands print JSON to stdout'),
  'CLI reference must explain the JSON stdout contract.',
);
assert(
  cliReference.includes('npm exec -- veritas --help'),
  'CLI reference must include the top-level help path.',
);
assert(
  cliReference.includes('npm exec -- veritas report --help'),
  'CLI reference must include subcommand help.',
);
assert(
  cliReference.includes('npx') === false,
  'CLI reference should stay aligned with npm exec usage in this repo.',
);
assert(
  cliReference.includes('veritas shadow run'),
  'CLI reference must document shadow run.',
);
assert(
  cliReference.includes('veritas runtime status'),
  'CLI reference must document runtime status.',
);
assert(
  cliReference.includes('veritas-report'),
  'CLI reference must document the report binary.',
);
assert(
  cliReference.includes('VERITAS_HOOK_SKIP=1'),
  'CLI reference must document the Veritas hook skip environment variable.',
);

const artifactsReference = readText('docs/reference/artifacts-and-schemas.md');
assert(
  artifactsReference.includes('.veritas/repo.adapter.json'),
  'Artifacts reference must include the starter adapter path.',
);
assert(
  artifactsReference.includes('.veritas/evidence/<run-id>.json'),
  'Artifacts reference must include evidence output paths.',
);
assert(
  artifactsReference.includes('schemas/'),
  'Artifacts reference must mention schema files.',
);
assert(
  artifactsReference.includes('adapters/'),
  'Artifacts reference must mention adapters.',
);
assert(
  artifactsReference.includes('policy-packs/'),
  'Artifacts reference must mention policy packs.',
);
assert(
  artifactsReference.includes('examples/'),
  'Artifacts reference must mention example fixtures.',
);

const examplesReference = readText('docs/reference/examples.md');
assert(
  examplesReference.includes('examples/evidence/work-agent-pass.json'),
  'Examples reference must include the pass evidence fixture.',
);
assert(
  examplesReference.includes('examples/evidence/work-agent-fail.json'),
  'Examples reference must include the fail evidence fixture.',
);
assert(
  examplesReference.includes('examples/evals/work-agent-shadow-eval-draft.json'),
  'Examples reference must include the eval draft fixture.',
);
assert(
  examplesReference.includes('examples/classification/work-agent-convergence-rule-families.json'),
  'Examples reference must include the classification fixture.',
);
assert(
  examplesReference.includes('examples/dogfood/veritas-repo-report.json'),
  'Examples reference must include the dogfood report example.',
);

const designDoc = readText('docs/design/framework-core-vs-adapter.md');
assert(
  designDoc.includes('framework core') || designDoc.includes('Framework Core'),
  'Design doc must describe the framework core.',
);
assert(
  designDoc.includes('Repo Adapter'),
  'Design doc must describe the adapter layer.',
);
assert(
  designDoc.includes('auditability') || designDoc.includes('audit'),
  'Design doc must explain the auditability value of the structure.',
);

const gettingStartedGuide = readText('docs/guides/getting-started.md');
assert(
  gettingStartedGuide.includes('Minimal Onboarding'),
  'Getting-started guide must include a minimal onboarding section.',
);
assert(
  gettingStartedGuide.includes('Install First'),
  'Getting-started guide must prioritize installation and usage.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas init'),
  'Getting-started guide must include the bootstrap command.',
);
assert(
  gettingStartedGuide.includes('inferred about the repo'),
  'Getting-started guide must mention inferred bootstrap decisions.',
);
assert(
  gettingStartedGuide.includes('The point is not only to make agents faster.'),
  'Getting-started guide must explain the differentiator in end-user terms.',
);
assert(
  gettingStartedGuide.includes('Step 4: Add Live Eval Later, Not First'),
  'Getting-started guide must explain the staged live-eval rollout.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas report --working-tree'),
  'Getting-started guide must include the working-tree report command.',
);
assert(
  gettingStartedGuide.includes('--changed-from main --changed-to HEAD'),
  'Getting-started guide must include the branch-diff report command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas eval record'),
  'Getting-started guide must include the eval record command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas eval draft'),
  'Getting-started guide must include the eval draft command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas shadow run'),
  'Getting-started guide must include the shadow run command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas apply git-hook --configure-git'),
  'Getting-started guide must include the git-hook apply command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas apply runtime-hook'),
  'Getting-started guide must include the runtime-hook apply command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas apply codex-hook --target-hooks-file'),
  'Getting-started guide must include the Codex hook apply command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas apply codex-hook --codex-home'),
  'Getting-started guide must include the Codex-home apply command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas print codex-hook --codex-home'),
  'Getting-started guide must include the Codex-home preview command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- veritas runtime status --codex-home'),
  'Getting-started guide must include the runtime status command.',
);
assert(
  gettingStartedGuide.includes('no Codex target was checked yet'),
  'Getting-started guide must explain the no-target-checked runtime status case.',
);
assert(
  gettingStartedGuide.includes('repo-local under `.veritas/evidence/`'),
  'Getting-started guide must explain repo-local evidence provenance for eval capture.',
);

const activationGuide = readText('docs/design/agent-activation.md');
assert(
  activationGuide.includes('The Three Activation Modes'),
  'Activation guide must explain the activation modes.',
);
assert(
  activationGuide.includes('Does It Work With Every Agent?'),
  'Activation guide must answer the compatibility question directly.',
);
assert(
  activationGuide.includes('agent-agnostic'),
  'Activation guide must explain the agent-agnostic goal.',
);
assert(
  activationGuide.includes('.veritas/hooks/agent-runtime.sh'),
  'Activation guide must mention the tracked runtime-hook adapter.',
);
assert(
  activationGuide.includes('tracked runtime-specific artifact'),
  'Activation guide must explain runtime-specific adapters as explicit tracked artifacts.',
);

const policyPackGuide = readText('docs/design/policy-packs.md');
assert(
  policyPackGuide.includes('Rule Classes'),
  'Policy-pack guide must explain rule classes.',
);
assert(
  policyPackGuide.includes('Enforcement Stages'),
  'Policy-pack guide must explain enforcement stages.',
);

const liveEvalGuide = readText('docs/design/live-evals.md');
assert(
  liveEvalGuide.includes('Phase 1: Shadow Mode'),
  'Live-eval guide must describe a staged rollout.',
);
assert(
  liveEvalGuide.includes('focus') && liveEvalGuide.includes('auditability'),
  'Live-eval guide must explain focus and auditability value.',
);
assert(
  liveEvalGuide.includes('current working tree'),
  'Live-eval guide must mention current-state evidence sources.',
);
assert(
  liveEvalGuide.includes('run `eval record --draft ...`'),
  'Live-eval guide must describe the explicit report-to-eval flow.',
);
assert(
  liveEvalGuide.includes('run `eval draft` against that artifact'),
  'Live-eval guide must describe the draft-first report-to-eval flow.',
);
assert(
  liveEvalGuide.includes('run `shadow run`'),
  'Live-eval guide must describe the passive shadow-run flow.',
);
assert(
  liveEvalGuide.includes('tracked `.githooks/*` file'),
  'Live-eval guide must describe tracked git-hook adapters.',
);
assert(
  liveEvalGuide.includes('immutable digest'),
  'Live-eval guide must describe immutable evidence provenance in eval capture.',
);

const liveEvalRoadmap = readText('docs/design/live-eval-roadmap.md');
assert(
  liveEvalRoadmap.includes('Phase 1: Shadow Mode'),
  'Live-eval roadmap must describe shadow mode.',
);
assert(
  liveEvalRoadmap.includes('Phase 3: Gate Mode'),
  'Live-eval roadmap must describe gate mode.',
);
assert(
  liveEvalRoadmap.includes('report artifact to eval artifact'),
  'Live-eval roadmap must mention the shipped report-to-eval CLI path.',
);
assert(
  liveEvalRoadmap.includes('eval draft capture'),
  'Live-eval roadmap must mention eval draft capture.',
);

const teamTuningGuide = readText('docs/guides/tune-for-your-team.md');
assert(
  teamTuningGuide.includes('The Two Things To Adjust'),
  'Team-tuning guide must explain the main operator controls.',
);
assert(
  teamTuningGuide.includes('Do not start with model fine-tuning.'),
  'Team-tuning guide must steer users toward framework tuning first.',
);

const bootstrapGuide = readText('docs/guides/start-your-next-project.md');
assert(
  bootstrapGuide.includes('The Current Experience'),
  'Bootstrap guide must explain the current init flow.',
);
assert(
  bootstrapGuide.includes('The Minimum Starter Kit'),
  'Bootstrap guide must define the minimum starter kit.',
);
assert(
  bootstrapGuide.includes('Activation In Practice'),
  'Bootstrap guide must connect bootstrap to activation.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas init'),
  'Bootstrap guide must include the bootstrap command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas print package-scripts'),
  'Bootstrap guide must include the package-script helper command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas print ci-snippet'),
  'Bootstrap guide must include the CI snippet helper command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas apply package-scripts'),
  'Bootstrap guide must include the package-script apply command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas apply ci-snippet'),
  'Bootstrap guide must include the CI snippet apply command.',
);
assert(
  bootstrapGuide.includes('repo shape it inferred'),
  'Bootstrap guide must explain inferred repo decisions.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas report --working-tree'),
  'Bootstrap guide must include the working-tree report command.',
);
assert(
  bootstrapGuide.includes('--changed-from <ref> --changed-to <ref>'),
  'Bootstrap guide must include the branch-diff report guidance.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas eval record'),
  'Bootstrap guide must include the eval record command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas eval draft'),
  'Bootstrap guide must include the eval draft command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas shadow run'),
  'Bootstrap guide must include the shadow run command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas apply git-hook --configure-git'),
  'Bootstrap guide must include the git-hook apply command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas apply runtime-hook'),
  'Bootstrap guide must include the runtime-hook apply command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas apply codex-hook --target-hooks-file'),
  'Bootstrap guide must include the Codex hook apply command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas apply codex-hook --codex-home'),
  'Bootstrap guide must include the Codex-home apply command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas print codex-hook --codex-home'),
  'Bootstrap guide must include the Codex-home preview command.',
);
assert(
  bootstrapGuide.includes('npm exec -- veritas runtime status --codex-home'),
  'Bootstrap guide must include the runtime status command.',
);
assert(
  bootstrapGuide.includes('Codex target not inspected yet'),
  'Bootstrap guide must explain the no-target-checked runtime status case.',
);
assert(
  bootstrapGuide.includes('reruns should use `--force`'),
  'Bootstrap guide must explain explicit overwrite for eval reruns.',
);

const rootReadme = readText('README.md');
assert(
  rootReadme.includes('npm exec -- veritas init'),
  'README must present the bootstrap command.',
);
assert(
  rootReadme.includes('## What This Project Ships'),
  'README must explain what the project ships.',
);
assert(
  rootReadme.includes('repo-local framework and CLI'),
  'README must describe the project clearly at the top level.',
);
assert(
  rootReadme.includes('docs/README.md'),
  'README must link to the docs index.',
);
assert(
  rootReadme.includes('docs/reference/cli.md'),
  'README must link to the CLI reference.',
);
assert(
  rootReadme.includes('docs/reference/artifacts-and-schemas.md'),
  'README must link to the artifacts and schemas reference.',
);
assert(
  rootReadme.includes('docs/reference/examples.md'),
  'README must link to the example fixtures reference.',
);
assert(
  rootReadme.includes('npm exec -- veritas print package-scripts'),
  'README must include the package-scripts print command.',
);
assert(
  rootReadme.includes('npm exec -- veritas apply package-scripts'),
  'README must include the package-scripts apply command.',
);
assert(
  rootReadme.includes('npm exec -- veritas report --working-tree'),
  'README must include the working-tree report command.',
);
assert(
  rootReadme.includes('npm exec -- veritas shadow run'),
  'README must include the shadow run command.',
);
assert(
  rootReadme.includes('npm exec -- veritas --help'),
  'README must include the top-level help command.',
);
assert(
  rootReadme.includes('All shipped CLI commands print JSON to stdout'),
  'README must explain the CLI output contract.',
);

const contributingGuide = readText('CONTRIBUTING.md');
assert(
  contributingGuide.includes('The main docs in this repo are written for people installing and using the framework.'),
  'Contributing guide must keep install/use docs as the primary surface.',
);

for (const schemaFileName of readdirSync(new URL('schemas/', rootUrl))) {
  if (!schemaFileName.endsWith('.json')) {
    continue;
  }

  readJson(`schemas/${schemaFileName}`);
}

assert(
  readText('package.json').includes('"veritas": "./bin/veritas.mjs"'),
  'package.json must expose the veritas CLI.',
);
assert(
  readText('package.json').includes('"veritas:dogfood:examples"'),
  'package.json must expose the dogfood example script.',
);
assert(
  readText('package.json').includes('"veritas:dogfood:checkin"'),
  'package.json must expose the dogfood checkin script.',
);
assert(
  readText('package.json').includes('"veritas:ci:dogfood"'),
  'package.json must expose the CI dogfood script.',
);

const dogfoodWorkflow = readText('.github/workflows/veritas-dogfood.yml');
assert(
  dogfoodWorkflow.includes('schedule:'),
  'Dogfood workflow must include a schedule.',
);
assert(
  dogfoodWorkflow.includes('npm run veritas:ci:dogfood'),
  'Dogfood workflow must run the CI dogfood script.',
);
assert(
  dogfoodWorkflow.includes('actions/upload-artifact@v4'),
  'Dogfood workflow must upload artifacts.',
);

const workAgentAdapter = readJson('adapters/work-agent.adapter.json');
assert(
  workAgentAdapter.kind === 'repo-adapter',
  'work-agent adapter must be repo-adapter',
);
assert(
  Array.isArray(workAgentAdapter.graph.nodes) && workAgentAdapter.graph.nodes.length > 0,
  'work-agent adapter must declare nodes',
);

const demoDocsAdapter = readJson('adapters/demo-docs-site.adapter.json');
assert(
  demoDocsAdapter.kind === 'repo-adapter',
  'demo docs adapter must be repo-adapter',
);
assert(
  Array.isArray(demoDocsAdapter.graph.nodes) && demoDocsAdapter.graph.nodes.length >= 3,
  'demo docs adapter must declare multiple nodes',
);

const policyPack = readJson('policy-packs/work-agent-convergence.policy-pack.json');
assert(
  Array.isArray(policyPack.rules) && policyPack.rules.length > 0,
  'policy pack must declare rules',
);
assert(
  Array.isArray(policyPack.rules[0].match?.artifacts) &&
    policyPack.rules[0].match.artifacts.length >= 10,
  'work-agent policy pack must carry the required artifact rule payload.',
);

const classificationArtifact = readJson(
  'examples/classification/work-agent-convergence-rule-families.json',
);
assert(
  Array.isArray(classificationArtifact.families) &&
    classificationArtifact.families.length >= 10,
  'classification artifact must define rule families.',
);
assert(
  classificationArtifact.families.some(
    (family) => family.id === 'repo-governance-and-distribution',
  ),
  'classification artifact must include repo governance coverage.',
);

for (const evidenceExample of [
  'examples/evidence/work-agent-pass.json',
  'examples/evidence/work-agent-fail.json',
  'examples/evidence/work-agent-policy-gap.json',
]) {
  const parsed = readJson(evidenceExample);
  assert(parsed.policy_pack?.name === 'work-agent-convergence', `${evidenceExample} must name the work-agent policy pack.`);
  assert(parsed.framework?.version === 1, `${evidenceExample} must target framework version 1.`);
  assert(Array.isArray(parsed.selected_proof_commands), `${evidenceExample} must include selected proof commands.`);
  assert(typeof parsed.proof_resolution_source === 'string', `${evidenceExample} must include a proof resolution source.`);
  assert(typeof parsed.uncovered_path_result === 'string', `${evidenceExample} must include an uncovered-path result.`);
  assert(Array.isArray(parsed.adapter?.default_proof_lanes), `${evidenceExample} must include adapter default proof lanes.`);
  assert(Array.isArray(parsed.adapter?.surface_proof_lanes), `${evidenceExample} must include adapter surface proof lanes.`);
  assert(typeof parsed.adapter?.uncovered_path_policy === 'string', `${evidenceExample} must include an adapter uncovered-path policy.`);
  assert(Array.isArray(parsed.policy_results), `${evidenceExample} must include policy results.`);
}

const dogfoodGuide = readText('docs/guides/dogfooding-veritas.md');
assert(
  dogfoodGuide.includes('npm run veritas:dogfood:prove'),
  'Dogfooding guide must include the prove command.',
);
assert(
  dogfoodGuide.includes('npm run veritas:dogfood:checkin'),
  'Dogfooding guide must include the checkin command.',
);
assert(
  dogfoodGuide.includes('examples/dogfood/veritas-repo-report.json'),
  'Dogfooding guide must link to the committed dogfood report example.',
);
assert(
  dogfoodGuide.includes('.github/workflows/veritas-dogfood.yml'),
  'Dogfooding guide must mention the dogfood workflow.',
);

const dogfoodReadme = readText('examples/dogfood/README.md');
assert(
  dogfoodReadme.includes('npm run veritas:dogfood:examples'),
  'Dogfood examples README must include the refresh command.',
);
assert(
  dogfoodReadme.includes('npm run veritas:dogfood:checkin'),
  'Dogfood examples README must include the checkin command.',
);

const dogfoodReport = readJson('examples/dogfood/veritas-repo-report.json');
assert(dogfoodReport.adapter?.name === 'veritas', 'Dogfood report must target the veritas adapter.');
assert(Array.isArray(dogfoodReport.policy_results), 'Dogfood report must include policy results.');
assert(
  dogfoodReport.policy_results.some((result) => result.passed === true),
  'Dogfood report must include passing policy results.',
);

const evalRecordExample = readJson('examples/evals/work-agent-shadow-eval.json');
assert(evalRecordExample.mode === 'shadow', 'Eval example must use shadow mode.');
assert(
  typeof evalRecordExample.measurements.time_to_green_minutes === 'number',
  'Eval example must include time-to-green.',
);

const teamProfileExample = readJson('examples/evals/work-agent-team-profile.json');
assert(
  teamProfileExample.defaults.mode === 'shadow',
  'Team profile example must default to shadow mode.',
);
assert(
  teamProfileExample.review_preferences.human_signoff_required_for_stage_promotion === true,
  'Team profile example must describe stage-promotion signoff.',
);
assert(
  teamProfileExample.promotion_preferences.warnings_block_in_ci === false,
  'Team profile example must describe warning behavior in CI.',
);

console.log('Framework verification passed.');
