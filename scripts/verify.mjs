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
  gettingStartedGuide.includes('The point is not only to make agents faster.'),
  'Getting-started guide must explain the differentiator in end-user terms.',
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

for (const schemaFileName of readdirSync(new URL('schemas/', rootUrl))) {
  if (!schemaFileName.endsWith('.json')) {
    continue;
  }

  readJson(`schemas/${schemaFileName}`);
}

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

console.log('Framework verification passed.');
