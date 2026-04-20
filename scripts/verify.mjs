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
  gettingStartedGuide.includes('npm exec -- ai-guidance init'),
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
  gettingStartedGuide.includes('npm exec -- ai-guidance report --working-tree'),
  'Getting-started guide must include the working-tree report command.',
);
assert(
  gettingStartedGuide.includes('--changed-from main --changed-to HEAD'),
  'Getting-started guide must include the branch-diff report command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- ai-guidance eval record'),
  'Getting-started guide must include the eval record command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- ai-guidance eval draft'),
  'Getting-started guide must include the eval draft command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- ai-guidance shadow run'),
  'Getting-started guide must include the shadow run command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- ai-guidance apply git-hook --configure-git'),
  'Getting-started guide must include the git-hook apply command.',
);
assert(
  gettingStartedGuide.includes('npm exec -- ai-guidance apply runtime-hook'),
  'Getting-started guide must include the runtime-hook apply command.',
);
assert(
  gettingStartedGuide.includes('repo-local under `.ai-guidance/evidence/`'),
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
  activationGuide.includes('.ai-guidance/hooks/agent-runtime.sh'),
  'Activation guide must mention the tracked runtime-hook adapter.',
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
  bootstrapGuide.includes('npm exec -- ai-guidance init'),
  'Bootstrap guide must include the bootstrap command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance print package-scripts'),
  'Bootstrap guide must include the package-script helper command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance print ci-snippet'),
  'Bootstrap guide must include the CI snippet helper command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance apply package-scripts'),
  'Bootstrap guide must include the package-script apply command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance apply ci-snippet'),
  'Bootstrap guide must include the CI snippet apply command.',
);
assert(
  bootstrapGuide.includes('repo shape it inferred'),
  'Bootstrap guide must explain inferred repo decisions.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance report --working-tree'),
  'Bootstrap guide must include the working-tree report command.',
);
assert(
  bootstrapGuide.includes('--changed-from <ref> --changed-to <ref>'),
  'Bootstrap guide must include the branch-diff report guidance.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance eval record'),
  'Bootstrap guide must include the eval record command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance eval draft'),
  'Bootstrap guide must include the eval draft command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance shadow run'),
  'Bootstrap guide must include the shadow run command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance apply git-hook --configure-git'),
  'Bootstrap guide must include the git-hook apply command.',
);
assert(
  bootstrapGuide.includes('npm exec -- ai-guidance apply runtime-hook'),
  'Bootstrap guide must include the runtime-hook apply command.',
);
assert(
  bootstrapGuide.includes('reruns should use `--force`'),
  'Bootstrap guide must explain explicit overwrite for eval reruns.',
);

const rootReadme = readText('README.md');
assert(
  rootReadme.includes('npm exec -- ai-guidance init'),
  'README must present the bootstrap command.',
);
assert(
  rootReadme.includes('bootstrap a starter `.ai-guidance/` setup'),
  'README must describe bootstrap as a current capability.',
);
assert(
  rootReadme.includes('infer conservative starter defaults'),
  'README must describe adaptive bootstrap as a current capability.',
);
assert(
  rootReadme.includes('print suggested package scripts and a starter CI snippet'),
  'README must describe the print-first integration helper capability.',
);
assert(
  rootReadme.includes('explicitly apply suggested package scripts'),
  'README must describe the explicit apply capability.',
);
assert(
  rootReadme.includes('current working tree'),
  'README must describe current-state working-tree reporting.',
);
assert(
  rootReadme.includes('branch-diff reports'),
  'README must distinguish branch-diff reports from other report modes.',
);
assert(
  rootReadme.includes('capture a shadow eval record'),
  'README must describe shadow eval capture as a current capability.',
);
assert(
  rootReadme.includes('prepare a shadow eval draft artifact'),
  'README must describe shadow eval draft preparation as a current capability.',
);
assert(
  rootReadme.includes('hook-friendly shadow flow'),
  'README must describe the hook-friendly shadow flow as a current capability.',
);
assert(
  rootReadme.includes('generate tracked git-hook adapters'),
  'README must describe tracked git-hook adapters as a current capability.',
);
assert(
  rootReadme.includes('generate tracked runtime-hook templates'),
  'README must describe tracked runtime-hook templates as a current capability.',
);
assert(
  rootReadme.includes('npm exec -- ai-guidance eval record'),
  'README must include the eval record command.',
);
assert(
  rootReadme.includes('npm exec -- ai-guidance eval draft'),
  'README must include the eval draft command.',
);
assert(
  rootReadme.includes('npm exec -- ai-guidance shadow run'),
  'README must include the shadow run command.',
);
assert(
  rootReadme.includes('npm exec -- ai-guidance apply git-hook --configure-git'),
  'README must include the git-hook apply command.',
);
assert(
  rootReadme.includes('npm exec -- ai-guidance apply runtime-hook'),
  'README must include the runtime-hook apply command.',
);
assert(
  rootReadme.includes('refuses to overwrite an existing eval artifact unless you pass `--force`'),
  'README must describe explicit overwrite behavior for eval artifacts.',
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
  readText('package.json').includes('"ai-guidance": "./bin/ai-guidance.mjs"'),
  'package.json must expose the ai-guidance CLI.',
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
}

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
