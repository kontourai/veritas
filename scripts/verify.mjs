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
  gettingStartedGuide.includes('The point is not only to make agents faster.'),
  'Getting-started guide must explain the differentiator in end-user terms.',
);
assert(
  gettingStartedGuide.includes('Step 4: Add Live Eval Later, Not First'),
  'Getting-started guide must explain the staged live-eval rollout.',
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

const liveEvalRoadmap = readText('docs/design/live-eval-roadmap.md');
assert(
  liveEvalRoadmap.includes('Phase 1: Shadow Mode'),
  'Live-eval roadmap must describe shadow mode.',
);
assert(
  liveEvalRoadmap.includes('Phase 3: Gate Mode'),
  'Live-eval roadmap must describe gate mode.',
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

const rootReadme = readText('README.md');
assert(
  rootReadme.includes('npm exec -- ai-guidance init'),
  'README must present the bootstrap command.',
);
assert(
  rootReadme.includes('bootstrap a starter `.ai-guidance/` setup'),
  'README must describe bootstrap as a current capability.',
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
