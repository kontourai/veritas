# Try a policy on an API change

This walkthrough demonstrates a companion-test policy: changing an API route should include a test change. The shipped Next.js template uses `Guide`, so a missing companion produces a warning. It does not prove that a test is meaningful; the test runner provides separate behavioral evidence.

Use a disposable Git repository with Node.js 22 or newer. These commands use npm and JavaScript modules so no Next.js server or TypeScript loader is needed:

```bash
git init veritas-policy-demo
cd veritas-policy-demo
npm init -y
npm pkg set 'scripts.test=node --test'
npm install -D @kontourai/veritas
npx --no @kontourai/veritas init --template nextjs-typescript --evidence-check "npm test"
```

Review the generated policy and commands. For a real project, record the owner's bootstrap approval as described in [setup](getting-started.md#2-review-the-generated-configuration). This demonstration does not invent an approval or remove approval warnings.

Commit the setup before demonstrating a source change, using your configured Git identity:

```bash
git add .
git commit -m "chore: initialize policy demonstration"
```

## 1. Add a route without a test

```bash
mkdir -p app/api/projects
cat > app/api/projects/route.mjs <<'JS'
export async function GET() {
  return Response.json({ projects: [] });
}
JS
npx --no @kontourai/veritas plan app/api/projects/route.mjs
npx --no @kontourai/veritas readiness --working-tree
```

Look for the `api-routes-require-api-tests` finding. Its relevant line is:

```text
WARN  api-routes-require-api-tests: Changed files matched app/api/** but no companion changes matched tests/api/**.
```

Other setup or evidence findings may also appear. This warning is advisory because the template uses `Guide`. The configured test command runs separately; passing with no tests is not behavioral coverage.

## 2. Add a test that calls the route

```bash
mkdir -p tests/api
cat > tests/api/projects.test.mjs <<'JS'
import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../../app/api/projects/route.mjs';

test('projects route returns the project list', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { projects: [] });
});
JS
npx --no @kontourai/veritas readiness --working-tree
```

The companion-path assertion now reports:

```text
PASS  api-routes-require-api-tests: Changed files matched app/api/** and included required companion changes under tests/api/**.
```

Separately, `npm test` executes the handler assertion. To confirm that test is useful in this disposable repository, temporarily change the response to `{ projects: ['unexpected'] }`: the test must fail. Restore the original response and rerun green.

The distinction matters: the companion policy checks which paths changed; the behavioral test checks the returned response. Neither covers the entire application. Before promoting this policy to `Require`, assess false positives and obtain the approval required for protected policy changes.

Next: [connect a detector-backed policy](code-hygiene.md) or [add agent guidance](agent-runtime-integrations.md).
