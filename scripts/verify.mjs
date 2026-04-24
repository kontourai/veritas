import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootUrl = new URL('../', import.meta.url);
const rootDir = fileURLToPath(rootUrl);

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, rootUrl), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(new URL(relativePath, rootUrl), 'utf8');
}

function fileExists(relativePath) {
  return existsSync(new URL(relativePath, rootUrl));
}

function assertNoAbsoluteFilesystemLinks(markdown, label) {
  const absoluteLinkPattern = /\]\(((?:\/|[A-Za-z]:[\\/]|file:\/\/)[^)]+)\)/g;
  const allowedUrlPattern = /^(https?:\/\/|mailto:)/;
  for (const match of markdown.matchAll(absoluteLinkPattern)) {
    const target = match[1];
    if (!allowedUrlPattern.test(target)) {
      throw new Error(`${label} must not contain absolute filesystem-style links: ${target}`);
    }
  }
}

function* iterDocFiles(relativeDir) {
  const dirUrl = new URL(`${relativeDir}/`, rootUrl);
  for (const entry of readdirSync(dirUrl, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* iterDocFiles(relativePath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      yield relativePath;
    }
  }
}

function assertMarkdownLinksResolve(relativePath) {
  const text = readText(relativePath);
  const sourceUrl = new URL(relativePath, rootUrl);
  const markdownLinks = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
  const hrefLinks = [...text.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

  for (const rawTarget of [...markdownLinks, ...hrefLinks]) {
    if (
      rawTarget.startsWith('http://') ||
      rawTarget.startsWith('https://') ||
      rawTarget.startsWith('mailto:') ||
      rawTarget.startsWith('#')
    ) {
      continue;
    }

    const [targetWithoutFragment] = rawTarget.split('#');
    const [targetPath] = targetWithoutFragment.split('?');
    if (!targetPath) continue;

    const resolvedUrl = new URL(targetPath, sourceUrl);
    if (!existsSync(resolvedUrl)) {
      throw new Error(
        `${relativePath} contains a broken local link: ${rawTarget}`,
      );
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const readme = readText('README.md');
const packageJson = readJson('package.json');

assert(packageJson.name === '@kontourai/veritas', 'package.json must keep the published package name.');
assert(packageJson.license === 'Apache-2.0', 'package.json must declare the Apache-2.0 license.');
assert(
  packageJson.repository?.url === 'git+https://github.com/kontourai/veritas.git',
  'package.json must declare the GitHub repository URL.',
);
assert(
  packageJson.bugs?.url === 'https://github.com/kontourai/veritas/issues',
  'package.json must declare the GitHub issues URL.',
);
assert(
  packageJson.engines?.node === '>=18.17',
  'package.json must declare the supported Node version range.',
);
assert(
  packageJson.scripts?.['test:coverage:check'] === 'node scripts/check-coverage.mjs',
  'package.json must expose the coverage gate script.',
);
assert(
  typeof packageJson.description === 'string' && packageJson.description.length > 0,
  'package.json must include a package description.',
);

assert(
  readme.includes('## What You Get'),
  'README must explain what the project offers.',
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
  readme.includes('docs/concepts.md'),
  'README must link to the concepts overview.',
);
assert(
  readme.includes('docs/guides/getting-started.md'),
  'README must link to the getting started guide.',
);
assert(
  readme.includes('https://kontourai.github.io/veritas/'),
  'README must link to the docs site.',
);
assert(
  readme.includes('img.shields.io/npm/v/%40kontourai%2Fveritas'),
  'README must include the npm badge.',
);
assert(
  readme.includes('actions/workflows/ci.yml/badge.svg'),
  'README must include the CI badge.',
);
assertNoAbsoluteFilesystemLinks(readme, 'README');
assertMarkdownLinksResolve('README.md');

const docsIndex = readText('docs/README.md');
assertNoAbsoluteFilesystemLinks(docsIndex, 'Docs index');
assertMarkdownLinksResolve('docs/README.md');
assert(
  docsIndex.includes('### Guides'),
  'Docs index must include a guides section.',
);
assert(
  docsIndex.includes('### Reference'),
  'Docs index must include a reference section.',
);
assert(
  docsIndex.includes('### Design'),
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
  docsIndex.includes('guides/operational-checkins.md'),
  'Docs index must link to the operational check-ins guide.',
);
assert(
  docsIndex.includes('guides/publish-and-release.md'),
  'Docs index must link to the publish and release guide.',
);
assert(
  docsIndex.includes('MIGRATING.md'),
  'Docs index must link to the migration guide.',
);
assert(
  docsIndex.includes('RELEASING.md'),
  'Docs index must link to the release process doc.',
);
assert(
  docsIndex.includes('reference/benchmarking.md'),
  'Docs index must link to the benchmarking methodology.',
);
assert(
  docsIndex.includes('design/schema-evolution.md'),
  'Docs index must link to the schema evolution policy.',
);

const cliReference = readText('docs/reference/cli.md');
assertMarkdownLinksResolve('docs/reference/cli.md');
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
  cliReference.includes('veritas eval marker'),
  'CLI reference must document the marker benchmark command.',
);
assert(
  cliReference.includes('veritas eval marker-suite'),
  'CLI reference must document the marker benchmark suite command.',
);
assert(
  cliReference.includes('veritas-report'),
  'CLI reference must document the report binary.',
);
assert(
  cliReference.includes('VERITAS_HOOK_SKIP=1'),
  'CLI reference must document the Veritas hook skip environment variable.',
);
assert(
  cliReference.includes('## Environment Variables'),
  'CLI reference must include an environment variables section.',
);
assert(
  cliReference.includes('../MIGRATING.md'),
  'CLI reference must link to the migration guide.',
);
assert(
  cliReference.includes('.veritas/GOVERNANCE.md'),
  'CLI reference must include the governance instruction artifact in init output.',
);

const artifactsReference = readText('docs/reference/artifacts-and-schemas.md');
assertMarkdownLinksResolve('docs/reference/artifacts-and-schemas.md');
assert(
  artifactsReference.includes('.veritas/repo.adapter.json'),
  'Artifacts reference must include the starter adapter path.',
);
assert(
  artifactsReference.includes('.veritas/GOVERNANCE.md'),
  'Artifacts reference must mention the governance instruction artifact.',
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
assertMarkdownLinksResolve('docs/reference/examples.md');
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
  examplesReference.includes('examples/checkins/veritas-repo-report.json'),
  'Examples reference must include the check-in report example.',
);
assert(
  examplesReference.includes('examples/checkins/veritas-repo-checkin-red.json'),
  'Examples reference must include the red checkin example.',
);
assert(
  examplesReference.includes('examples/benchmarks/migration-marker-scenario.json'),
  'Examples reference must include the marker benchmark scenario fixture.',
);
assert(
  examplesReference.includes('examples/benchmarks/migration-marker-comparison.json'),
  'Examples reference must include the marker benchmark comparison fixture.',
);
assert(
  examplesReference.includes('examples/benchmarks/marker-suite.json'),
  'Examples reference must include the marker benchmark suite fixture.',
);
assert(
  examplesReference.includes('examples/benchmarks/marker-suite-report.json'),
  'Examples reference must include the marker benchmark suite report fixture.',
);
assert(
  examplesReference.includes('examples/benchmarks/governance-zone1-marker-scenario.json'),
  'Examples reference must include the Zone 1 governance benchmark fixture.',
);
assert(
  examplesReference.includes('examples/benchmarks/governance-zone2-marker-scenario.json'),
  'Examples reference must include the Zone 2 governance benchmark fixture.',
);

const benchmarkingReference = readText('docs/reference/benchmarking.md');
assertMarkdownLinksResolve('docs/reference/benchmarking.md');
assert(
  benchmarkingReference.includes('examples/benchmarks/'),
  'Benchmarking reference must explain the benchmark fixtures directory.',
);
assert(
  benchmarkingReference.includes('veritas eval marker-suite'),
  'Benchmarking reference must mention the suite command.',
);
assert(
  benchmarkingReference.includes('Zone 1') && benchmarkingReference.includes('Zone 2'),
  'Benchmarking reference must explain the governance benchmark classes.',
);

const schemaEvolution = readText('docs/design/schema-evolution.md');
assertMarkdownLinksResolve('docs/design/schema-evolution.md');
assert(
  schemaEvolution.includes('artifact version'),
  'Schema evolution policy must describe artifact versioning.',
);

assert(fileExists('CHANGELOG.md'), 'Repo must include a changelog.');
assert(fileExists('SECURITY.md'), 'Repo must include a security policy.');
assert(fileExists('CODE_OF_CONDUCT.md'), 'Repo must include a code of conduct.');
assert(fileExists('.editorconfig'), 'Repo must include an editorconfig.');
assert(fileExists('.github/ISSUE_TEMPLATE/bug_report.md'), 'Repo must include a bug-report template.');
assert(fileExists('.github/ISSUE_TEMPLATE/feature_request.md'), 'Repo must include a feature-request template.');
assert(fileExists('.github/PULL_REQUEST_TEMPLATE.md'), 'Repo must include a pull-request template.');
assert(fileExists('docs/RELEASING.md'), 'Repo must include a release process doc.');
assert(fileExists('scripts/check-coverage.mjs'), 'Repo must include the coverage gate script.');

const ciWorkflow = readText('.github/workflows/ci.yml');
assert(
  ciWorkflow.includes('npm run test:coverage:check'),
  'CI workflow must run the coverage gate.',
);
assert(
  ciWorkflow.includes('actions/checkout@v6'),
  'CI workflow must use the current checkout action.',
);
assert(
  ciWorkflow.includes('actions/setup-node@v6'),
  'CI workflow must use the current setup-node action.',
);
assert(
  ciWorkflow.includes("node-version: ['18', '22']"),
  'CI workflow must validate on Node 18 and Node 22.',
);
assert(
  ciWorkflow.includes('npm run verify'),
  'CI workflow must run npm run verify.',
);
assert(
  ciWorkflow.includes('npm test'),
  'CI workflow must run npm test.',
);

const pagesWorkflow = readText('.github/workflows/pages.yml');
assert(
  pagesWorkflow.includes('npm run docs:pages:build'),
  'Pages workflow must build the docs site through the local pages build script.',
);
assert(
  pagesWorkflow.includes('actions/checkout@v6'),
  'Pages workflow must use the current checkout action.',
);
assert(
  pagesWorkflow.includes('actions/setup-node@v6'),
  'Pages workflow must use the current setup-node action.',
);
assert(
  pagesWorkflow.includes('actions/configure-pages@v6'),
  'Pages workflow must use the current configure-pages action.',
);
assert(
  pagesWorkflow.includes('actions/upload-pages-artifact@v5'),
  'Pages workflow must use the current upload-pages-artifact action.',
);
assert(
  pagesWorkflow.includes('actions/deploy-pages'),
  'Pages workflow must deploy to GitHub Pages.',
);
assert(
  pagesWorkflow.includes('actions/deploy-pages@v5'),
  'Pages workflow must use the current deploy-pages action.',
);

const publishWorkflow = readText('.github/workflows/publish-npm.yml');
assert(
  publishWorkflow.includes('npm run test:coverage:check'),
  'Publish workflow must run the coverage gate.',
);
assert(
  publishWorkflow.includes("node-version: ['18', '22']"),
  'Publish workflow must verify on Node 18 and Node 22 before publishing.',
);
assert(
  publishWorkflow.includes('npm publish --access public'),
  'Publish workflow must use npm publish with public access.',
);
assert(
  publishWorkflow.includes('Verify Tagged Commit Is On Main'),
  'Publish workflow must verify that the tagged commit is reachable from main.',
);
assert(
  publishWorkflow.includes('Verify Tag Matches Package Version'),
  'Publish workflow must verify the pushed tag matches package.json version.',
);
assert(
  publishWorkflow.includes('workflow_dispatch') === false,
  'Publish workflow should stay tag-driven unless the docs explicitly describe a manual publish path.',
);
assert(
  publishWorkflow.includes('id-token: write'),
  'Publish workflow must request OIDC token minting for npm trusted publishing.',
);
assert(
  publishWorkflow.includes('actions/checkout@v6'),
  'Publish workflow must use the current checkout action.',
);
assert(
  publishWorkflow.includes('actions/setup-node@v6'),
  'Publish workflow must use the current setup-node action.',
);
assert(
  publishWorkflow.includes('NPM_TOKEN') === false,
  'Publish workflow must not depend on a long-lived NPM_TOKEN secret.',
);

const checkinsWorkflow = readText('.github/workflows/veritas-checkins.yml');
assert(
  checkinsWorkflow.includes('actions/checkout@v6'),
  'Check-in workflow must use the current checkout action.',
);
assert(
  checkinsWorkflow.includes('actions/setup-node@v6'),
  'Check-in workflow must use the current setup-node action.',
);
assert(
  checkinsWorkflow.includes('actions/upload-artifact@v7'),
  'Check-in workflow must use the current upload-artifact action.',
);
assert(
  checkinsWorkflow.includes('actions/download-artifact@v8'),
  'Check-in workflow must use the current download-artifact action.',
);
assert(
  checkinsWorkflow.includes('actions/github-script@v9'),
  'Check-in workflow must use the current github-script action.',
);

execFileSync('node', ['scripts/build-pages-site.mjs'], {
  cwd: rootDir,
  encoding: 'utf8',
});
assert(fileExists('.site-src/index.md'), 'Pages build must emit the root index page.');
assert(
  readText('.site-src/_config.yml').includes('  - .github'),
  'Pages build config must explicitly include the .github path for published workflow links.',
);
assert(fileExists('.site-src/CONTRIBUTING.md'), 'Pages build must include CONTRIBUTING.md.');
assert(fileExists('.site-src/examples/checkins/README.md'), 'Pages build must include the check-in README.');
assert(fileExists('.site-src/package.json'), 'Pages build must include package.json for linked publish docs.');
assert(fileExists('.site-src/.github/workflows/veritas-checkins.yml'), 'Pages build must include workflow files referenced by the docs.');
assert(fileExists('.site-src/.github/workflows/ci.yml'), 'Pages build must include the CI workflow file.');
assert(fileExists('.site-src/.github/workflows/pages.yml'), 'Pages build must include the Pages workflow file.');
assert(fileExists('.site-src/.github/workflows/publish-npm.yml'), 'Pages build must include the npm publish workflow file.');

const designDoc = readText('docs/design/framework-core-vs-adapter.md');
assert(
  designDoc.includes('framework core') || designDoc.includes('Framework Core'),
  'Design doc must explain the framework core.',
);

for (const relativePath of [
  'CLAUDE.md',
  'CONTRIBUTING.md',
  ...iterDocFiles('docs'),
  ...iterDocFiles('examples/checkins'),
  ...iterDocFiles('.veritas'),
]) {
  assertNoAbsoluteFilesystemLinks(readText(relativePath), relativePath);
  assertMarkdownLinksResolve(relativePath);
}

const benchmarkFixtures = readdirSync(new URL('examples/benchmarks/', rootUrl));
assert(benchmarkFixtures.length >= 10, 'Expected a richer set of benchmark fixtures.');

console.log('Framework verification passed.');
