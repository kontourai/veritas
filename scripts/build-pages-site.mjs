import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const rootDir = process.cwd();
const siteDir = join(rootDir, '.site-src');
const layoutDir = join(siteDir, '_layouts');
const assetsDir = join(siteDir, 'assets');

const markdownFiles = [
  'CONTRIBUTING.md',
  'README.md',
  'docs/README.md',
  'docs/design/agent-activation.md',
  'docs/design/framework-core-vs-adapter.md',
  'docs/design/live-eval-roadmap.md',
  'docs/design/live-evals.md',
  'docs/design/policy-packs.md',
  'docs/guides/getting-started.md',
  'docs/guides/operational-checkins.md',
  'docs/guides/publish-and-release.md',
  'docs/guides/start-your-next-project.md',
  'docs/guides/tune-for-your-team.md',
  'docs/reference/artifacts-and-schemas.md',
  'docs/reference/cli.md',
  'docs/reference/examples.md',
  'docs/reference/telemetry-and-read-models.md',
  'examples/checkins/README.md',
];

const passthroughFiles = [
  'package.json',
  '.github/workflows/veritas-checkins.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/pages.yml',
  '.github/workflows/publish-npm.yml',
];

const normalizedRootDir = rootDir.replaceAll('\\', '/');
const repoAbsolutePrefix = `${normalizedRootDir}/`;

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function extractTitle(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function rewriteMarkdownLinks(markdown, currentFile) {
  return markdown.replace(/\]\(([^)]+)\)/g, (full, target) => {
    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:') ||
      target.startsWith('#')
    ) {
      return full;
    }

    const [pathPart, anchor = ''] = target.split('#');
    let normalizedTarget = pathPart;
    if (normalizedTarget.startsWith('/Users/')) {
      normalizedTarget = normalizedTarget.replace(repoAbsolutePrefix, '');
    }
    if (isAbsolute(normalizedTarget.replaceAll('\\', '/'))) {
      if (normalizedTarget.replaceAll('\\', '/').startsWith(repoAbsolutePrefix)) {
        normalizedTarget = normalizedTarget.replaceAll('\\', '/').replace(repoAbsolutePrefix, '');
      } else {
        throw new Error(`Unsupported absolute filesystem link target: ${normalizedTarget}`);
      }
    }
    if (normalizedTarget.length === 0) {
      return full;
    }

    const currentDir = dirname(currentFile);
    const currentDirAbs = resolve(rootDir, currentDir);
    const resolvedTargetAbs = resolve(currentDirAbs, normalizedTarget);
    const relativeTargetFromRoot = relative(rootDir, resolvedTargetAbs).replaceAll('\\', '/');
    const targetForPages = relativeTargetFromRoot.endsWith('.md')
      ? relativeTargetFromRoot.replace(/\.md$/, '.html')
      : relativeTargetFromRoot;
    const relativeTarget = relative(currentDirAbs, resolve(rootDir, targetForPages)).replaceAll('\\', '/');
    const finalTarget =
      relativeTarget.length === 0 ? targetForPages : relativeTarget;
    const anchorSuffix = anchor ? `#${anchor}` : '';
    return `](${finalTarget}${anchorSuffix})`;
  });
}

function frontmatter(title) {
  return `---\nlayout: default\ntitle: ${JSON.stringify(title)}\n---\n\n`;
}

rmSync(siteDir, { recursive: true, force: true });
ensureDir(layoutDir);
ensureDir(assetsDir);

writeFileSync(
  join(siteDir, '_config.yml'),
  [
    'title: Veritas',
    'description: Repo-native framework and CLI for trustworthy AI-assisted development',
    'include:',
    '  - .github',
    'markdown: kramdown',
    'kramdown:',
    '  input: GFM',
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  join(layoutDir, 'default.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ page.title }} | {{ site.title }}</title>
    <link rel="stylesheet" href="{{ '/assets/site.css' | relative_url }}">
  </head>
  <body>
    <header class="site-header">
      <div class="shell">
        <a class="brand" href="{{ '/' | relative_url }}">{{ site.title }}</a>
        <nav class="nav">
          <a href="{{ '/index.html' | relative_url }}">Home</a>
          <a href="{{ '/docs/README.html' | relative_url }}">Docs</a>
          <a href="https://www.npmjs.com/package/@kontourai/veritas">npm</a>
          <a href="https://github.com/kontourai/veritas">GitHub</a>
        </nav>
      </div>
    </header>
    <main class="shell content">
      {{ content }}
    </main>
  </body>
</html>
`,
  'utf8',
);

writeFileSync(
  join(assetsDir, 'site.css'),
  `:root {
  --bg: #f7f7f2;
  --fg: #1d1d1b;
  --muted: #5b5a55;
  --line: #ddd8c8;
  --accent: #0e7490;
}
body {
  margin: 0;
  font-family: Georgia, 'Iowan Old Style', serif;
  background: linear-gradient(180deg, #fffdf7 0%, var(--bg) 100%);
  color: var(--fg);
}
.shell {
  width: min(920px, calc(100% - 2rem));
  margin: 0 auto;
}
.site-header {
  border-bottom: 1px solid var(--line);
  background: rgba(255, 253, 247, 0.92);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
}
.site-header .shell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
}
.brand {
  color: var(--fg);
  text-decoration: none;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.nav {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.nav a {
  color: var(--muted);
  text-decoration: none;
}
.content {
  padding: 2rem 0 4rem;
  line-height: 1.65;
}
a {
  color: var(--accent);
}
pre, code {
  font-family: 'SFMono-Regular', Menlo, monospace;
}
pre {
  padding: 1rem;
  overflow: auto;
  background: #f2efe3;
  border: 1px solid var(--line);
}
blockquote {
  margin-left: 0;
  padding-left: 1rem;
  border-left: 4px solid var(--line);
  color: var(--muted);
}
table {
  border-collapse: collapse;
}
td, th {
  border: 1px solid var(--line);
  padding: 0.5rem;
}
img {
  max-width: 100%;
}
`,
  'utf8',
);

for (const relativePath of markdownFiles) {
  const sourcePath = join(rootDir, relativePath);
  const destinationPath =
    relativePath === 'README.md'
      ? join(siteDir, 'index.md')
      : join(siteDir, relativePath);
  ensureDir(dirname(destinationPath));
  const original = readFileSync(sourcePath, 'utf8');
  const rewritten = rewriteMarkdownLinks(original, relativePath === 'README.md' ? 'index.md' : relativePath);
  const title = extractTitle(original, relativePath);
  writeFileSync(destinationPath, `${frontmatter(title)}${rewritten}`, 'utf8');
}

for (const relativePath of passthroughFiles) {
  const sourcePath = join(rootDir, relativePath);
  if (!existsSync(sourcePath)) continue;
  const destinationPath = join(siteDir, relativePath);
  ensureDir(dirname(destinationPath));
  copyFileSync(sourcePath, destinationPath);
}
