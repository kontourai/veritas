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

const policyPack = readJson('policy-packs/work-agent-convergence.policy-pack.json');
assert(
  Array.isArray(policyPack.rules) && policyPack.rules.length > 0,
  'policy pack must declare rules',
);

console.log('Framework verification passed.');
