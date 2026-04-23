import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const rootDir = process.cwd();
const siteDir = join(rootDir, '.site-src');
const layoutDir = join(siteDir, '_layouts');
const assetsDir = join(siteDir, 'assets');

// The landing page lives at docs/site-index.md in the repo but becomes
// index.md in the site.  All other markdown files keep their repo paths.
const landingPage = { source: 'docs/site-index.md', dest: 'index.md' };

const markdownFiles = [
  'CONTRIBUTING.md',
  'docs/README.md',
  'docs/concepts.md',
  'docs/MIGRATING.md',
  'docs/RELEASING.md',
  'docs/design/agent-activation.md',
  'docs/design/framework-core-vs-adapter.md',
  'docs/design/live-eval-roadmap.md',
  'docs/design/live-evals.md',
  'docs/design/policy-packs.md',
  'docs/design/schema-evolution.md',
  'docs/guides/agent-runtime-integrations.md',
  'docs/guides/getting-started.md',
  'docs/guides/operational-checkins.md',
  'docs/guides/publish-and-release.md',
  'docs/guides/start-your-next-project.md',
  'docs/guides/tune-for-your-team.md',
  'docs/reference/artifacts-and-schemas.md',
  'docs/reference/benchmarking.md',
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

/**
 * Rewrite a single link target from its source position to its dest position.
 * Returns the rewritten target, or null if the link should be left unchanged.
 */
function rewriteLinkTarget(target, sourceFile, destFile) {
  if (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('#')
  ) {
    return null;
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
    return null;
  }

  // Resolve the target relative to the SOURCE file in the repo
  const sourceDir = dirname(sourceFile);
  const sourceDirAbs = resolve(rootDir, sourceDir);
  const resolvedTargetAbs = resolve(sourceDirAbs, normalizedTarget);
  const relativeTargetFromRoot = relative(rootDir, resolvedTargetAbs).replaceAll('\\', '/');
  const targetForPages = relativeTargetFromRoot.endsWith('.md')
    ? relativeTargetFromRoot.replace(/\.md$/, '.html')
    : relativeTargetFromRoot;

  // Compute the output path relative to the DESTINATION file in the site
  const destDir = dirname(destFile);
  const destDirAbs = resolve(rootDir, destDir);
  const relativeResult = relative(destDirAbs, resolve(rootDir, targetForPages)).replaceAll('\\', '/');
  const finalTarget = relativeResult.length === 0 ? targetForPages : relativeResult;
  const anchorSuffix = anchor ? `#${anchor}` : '';
  return `${finalTarget}${anchorSuffix}`;
}

/**
 * Rewrite both markdown links [text](target) and HTML href="target" links.
 *
 * sourceFile: the file's path in the repo  (for resolving relative links)
 * destFile:   the file's path in the site  (for computing output relative paths)
 */
function rewriteLinks(markdown, sourceFile, destFile) {
  destFile = destFile || sourceFile;

  // Markdown links: [text](target)
  let result = markdown.replace(/\]\(([^)]+)\)/g, (full, target) => {
    const rewritten = rewriteLinkTarget(target, sourceFile, destFile);
    return rewritten !== null ? `](${rewritten})` : full;
  });

  // HTML href links: href="target"
  result = result.replace(/href="([^"]+)"/g, (full, target) => {
    const rewritten = rewriteLinkTarget(target, sourceFile, destFile);
    return rewritten !== null ? `href="${rewritten}"` : full;
  });

  return result;
}

function frontmatter(title) {
  return `---\nlayout: default\ntitle: ${JSON.stringify(title)}\n---\n\n`;
}

// ---------------------------------------------------------------------------
// Generate the site
// ---------------------------------------------------------------------------

rmSync(siteDir, { recursive: true, force: true });
ensureDir(layoutDir);
ensureDir(assetsDir);

// --- Config ----------------------------------------------------------------

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

// --- Layout ----------------------------------------------------------------

writeFileSync(
  join(layoutDir, 'default.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ page.title }} | {{ site.title }}</title>
    <link rel="stylesheet" href="{{ '/assets/site.css' | relative_url }}">
    <script>
      (function () {
        var t = localStorage.getItem('theme');
        if (t) document.documentElement.setAttribute('data-theme', t);
      })();
    </script>
  </head>
  <body>
    <header class="site-header">
      <div class="shell">
        <a class="brand" href="{{ '/' | relative_url }}">{{ site.title }}</a>
        <nav class="nav">
          <a href="{{ '/index.html' | relative_url }}">Home</a>
          <a href="{{ '/docs/concepts.html' | relative_url }}">Concepts</a>
          <a href="{{ '/docs/README.html' | relative_url }}">Docs</a>
          <a href="https://www.npmjs.com/package/@kontourai/veritas">npm</a>
          <a href="https://github.com/kontourai/veritas">GitHub</a>
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark/light mode" title="Toggle dark/light mode">
            <span class="theme-toggle-icon"></span>
          </button>
        </nav>
      </div>
    </header>
    <main class="shell content">
      {{ content }}
    </main>
    <footer class="site-footer">
      <div class="shell">
        <span>Veritas &mdash; trustworthy AI-assisted development</span>
        <div class="footer-links">
          <a href="{{ '/docs/guides/getting-started.html' | relative_url }}">Get Started</a>
          <a href="{{ '/docs/README.html' | relative_url }}">Docs</a>
          <a href="https://github.com/kontourai/veritas">GitHub</a>
        </div>
      </div>
    </footer>
    <script>
      (function () {
        function isDark() {
          var t = document.documentElement.getAttribute('data-theme');
          if (t === 'dark') return true;
          if (t === 'light') return false;
          return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        function applyIcon() {
          var btn = document.getElementById('theme-toggle');
          if (btn) btn.querySelector('.theme-toggle-icon').textContent = isDark() ? '☀' : '☾';
        }
        applyIcon();
        var btn = document.getElementById('theme-toggle');
        if (btn) {
          btn.addEventListener('click', function () {
            var next = isDark() ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
            applyIcon();
          });
        }
      })();
    </script>
  </body>
</html>
`,
  'utf8',
);

// --- CSS -------------------------------------------------------------------

writeFileSync(
  join(assetsDir, 'site.css'),
  `:root {
  --bg: #f7f7f2;
  --fg: #1d1d1b;
  --muted: #5b5a55;
  --line: #ddd8c8;
  --accent: #0e7490;
  --code-bg: #eeeadc;
  --pre-bg: #1d1d1b;
  --pre-fg: #e8e6df;
  --th-bg: #f2efe3;
  --install-cmd-bg: #1d1d1b;
  --install-cmd-fg: #e8e6df;
  --pillar-bg: #fffdf7;
  --before-bg: #faf0f0;
  --before-border: #dfc8c8;
  --before-heading: #7a3535;
  --after-bg: #f0f6f0;
  --after-border: #c0d8c0;
  --after-heading: #2a5a2a;
  --header-bg: rgba(247, 247, 242, 0.92);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1a1a18;
    --fg: #e8e6df;
    --muted: #9b9890;
    --line: #2e2e2a;
    --accent: #22d3ee;
    --code-bg: #2a2a26;
    --pre-bg: #111110;
    --pre-fg: #e8e6df;
    --th-bg: #252520;
    --install-cmd-bg: #0d0d0c;
    --install-cmd-fg: #e8e6df;
    --pillar-bg: #1e1e1a;
    --before-bg: #2a1818;
    --before-border: #4a2a2a;
    --before-heading: #e07070;
    --after-bg: #182a18;
    --after-border: #2a4a2a;
    --after-heading: #70c070;
    --header-bg: rgba(26, 26, 24, 0.92);
  }
}

:root[data-theme="dark"] {
  --bg: #1a1a18;
  --fg: #e8e6df;
  --muted: #9b9890;
  --line: #2e2e2a;
  --accent: #22d3ee;
  --code-bg: #2a2a26;
  --pre-bg: #111110;
  --pre-fg: #e8e6df;
  --th-bg: #252520;
  --install-cmd-bg: #0d0d0c;
  --install-cmd-fg: #e8e6df;
  --pillar-bg: #1e1e1a;
  --before-bg: #2a1818;
  --before-border: #4a2a2a;
  --before-heading: #e07070;
  --after-bg: #182a18;
  --after-border: #2a4a2a;
  --after-heading: #70c070;
  --header-bg: rgba(26, 26, 24, 0.92);
}

/* ---- Base ---- */
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
.shell {
  width: min(920px, calc(100% - 2rem));
  margin: 0 auto;
}

/* ---- Header ---- */
.site-header {
  border-bottom: 1px solid var(--line);
  background: var(--header-bg);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 10;
}
.site-header .shell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 0;
}
.brand {
  color: var(--fg);
  text-decoration: none;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.nav {
  display: flex;
  gap: 1.2rem;
  flex-wrap: wrap;
}
.nav a {
  color: var(--muted);
  text-decoration: none;
  font-size: 0.9rem;
  transition: color 0.15s;
}
.nav a:hover { color: var(--fg); }
.theme-toggle {
  background: none;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  padding: 0.2rem 0.45rem;
  transition: color 0.15s, border-color 0.15s;
}
.theme-toggle:hover { color: var(--fg); border-color: var(--muted); }

/* ---- Content ---- */
.content {
  padding: 2rem 0 4rem;
  line-height: 1.7;
}
.content h1 { margin-top: 0; }
.content h2 {
  margin-top: 2.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.content h2:first-of-type {
  border-top: none;
  padding-top: 0;
}

a { color: var(--accent); }

pre, code {
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 0.88rem;
}
code {
  background: var(--code-bg);
  padding: 0.15rem 0.35rem;
  border-radius: 3px;
}
pre {
  padding: 1.2rem;
  overflow: auto;
  background: var(--pre-bg);
  color: var(--pre-fg);
  border-radius: 6px;
  border: none;
  line-height: 1.5;
}
pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  color: inherit;
}
blockquote {
  margin-left: 0;
  padding-left: 1rem;
  border-left: 3px solid var(--accent);
  color: var(--muted);
}
table {
  border-collapse: collapse;
  width: 100%;
}
td, th {
  border: 1px solid var(--line);
  padding: 0.5rem 0.75rem;
  text-align: left;
}
th { background: var(--th-bg); }
img { max-width: 100%; }

/* ---- Hero (landing page) ---- */
.hero {
  text-align: center;
  padding: 4rem 0 3rem;
  margin-bottom: 2rem;
}
.hero-tagline {
  font-size: 2.4rem;
  line-height: 1.15;
  margin: 0 0 1.5rem;
  letter-spacing: -0.025em;
  font-weight: 800;
}
.hero-subtitle {
  font-size: 1.1rem;
  color: var(--muted);
  max-width: 620px;
  margin: 0 auto 2rem;
  line-height: 1.65;
}
.install-cmd {
  display: inline-block;
  background: var(--install-cmd-bg);
  color: var(--install-cmd-fg);
  padding: 0.65rem 1.5rem;
  border-radius: 6px;
  border: none;
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}
.install-cmd code {
  color: inherit;
  background: none;
  padding: 0;
}
.hero-cta {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  padding: 0.65rem 2rem;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
  transition: opacity 0.15s;
}
.hero-cta:hover {
  opacity: 0.85;
  color: #fff;
}

/* ---- Pillars (four feature cards) ---- */
.pillars {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
  margin: 2rem 0 3rem;
}
@media (max-width: 640px) {
  .pillars { grid-template-columns: 1fr; }
}
.pillar {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1.5rem;
  background: var(--pillar-bg);
}
.pillar h3 {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
}
.pillar-term {
  font-weight: 400;
  color: var(--muted);
  font-size: 0.8rem;
  margin-left: 0.25rem;
}
.pillar-term::before { content: '/ '; }
.pillar-what {
  margin: 0 0 0.4rem;
  font-size: 0.92rem;
  line-height: 1.5;
}
.pillar-why {
  margin: 0;
  font-size: 0.88rem;
  color: var(--muted);
  line-height: 1.5;
}

/* ---- Before / After comparison ---- */
.comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
  margin: 2rem 0 3rem;
}
@media (max-width: 640px) {
  .comparison { grid-template-columns: 1fr; }
}
.comparison-col {
  border-radius: 8px;
  padding: 1.25rem;
}
.comparison-col h3 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}
.comparison-col ul {
  margin: 0;
  padding-left: 1.2rem;
}
.comparison-col li {
  margin-bottom: 0.4rem;
  font-size: 0.9rem;
  line-height: 1.5;
}
.comparison-col--before {
  background: var(--before-bg);
  border: 1px solid var(--before-border);
}
.comparison-col--before h3 { color: var(--before-heading); }
.comparison-col--after {
  background: var(--after-bg);
  border: 1px solid var(--after-border);
}
.comparison-col--after h3 { color: var(--after-heading); }

/* ---- Footer ---- */
.site-footer {
  border-top: 1px solid var(--line);
  padding: 2rem 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.site-footer .shell {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}
.footer-links {
  display: flex;
  gap: 1.2rem;
}
.footer-links a {
  color: var(--muted);
  text-decoration: none;
}
.footer-links a:hover { color: var(--accent); }
`,
  'utf8',
);

// --- Landing page ----------------------------------------------------------

{
  const sourcePath = join(rootDir, landingPage.source);
  const destinationPath = join(siteDir, landingPage.dest);
  ensureDir(dirname(destinationPath));
  const original = readFileSync(sourcePath, 'utf8');
  const rewritten = rewriteLinks(original, landingPage.source, landingPage.dest);
  const title = 'Trustworthy AI-Assisted Development';
  writeFileSync(destinationPath, `${frontmatter(title)}${rewritten}`, 'utf8');
}

// --- Markdown files --------------------------------------------------------

for (const relativePath of markdownFiles) {
  const sourcePath = join(rootDir, relativePath);
  const destinationPath = join(siteDir, relativePath);
  ensureDir(dirname(destinationPath));
  const original = readFileSync(sourcePath, 'utf8');
  const rewritten = rewriteLinks(original, relativePath);
  const title = extractTitle(original, relativePath);
  writeFileSync(destinationPath, `${frontmatter(title)}${rewritten}`, 'utf8');
}

// --- Passthrough files -----------------------------------------------------

for (const relativePath of passthroughFiles) {
  const sourcePath = join(rootDir, relativePath);
  if (!existsSync(sourcePath)) continue;
  const destinationPath = join(siteDir, relativePath);
  ensureDir(dirname(destinationPath));
  copyFileSync(sourcePath, destinationPath);
}
