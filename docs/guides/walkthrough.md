# Walkthrough: Next.js API Change

This walkthrough shows the smallest useful Veritas loop: initialize a repo, make an API change without its companion test, see Veritas fail, add the test, and rerun.

## 1. Install and initialize

```bash
npm install -D @kontourai/veritas
npx veritas init --pack nextjs-typescript
```

Output includes the generated starter files:

```json
{
  "pack": "nextjs-typescript",
  "generatedFiles": [
    ".veritas/README.md",
    ".veritas/GOVERNANCE.md",
    ".veritas/repo.adapter.json",
    ".veritas/policy-packs/default.policy-pack.json",
    ".veritas/team/default.team-profile.json",
    "AGENTS.md",
    "CLAUDE.md"
  ]
}
```

## 2. Change an API route without a test

```bash
mkdir -p app/api/projects
cat > app/api/projects/route.ts <<'EOF'
export async function GET() {
  return Response.json({ projects: [] });
}
EOF
```

Run Veritas:

```bash
npx veritas run --working-tree --skip-proof
```

The `nextjs-typescript` pack reports the missing companion test:

```text
FAIL  api-routes-require-api-tests: Changed files matched app/api/** but no companion changes matched tests/api/**.
      -> app/api/projects/route.ts

1 failure · 0 warnings · run `veritas run --check shadow` for full evidence
```

## 3. Add the companion test

```bash
mkdir -p tests/api
cat > tests/api/projects.test.ts <<'EOF'
import assert from "node:assert/strict";
import test from "node:test";

test("projects route contract", () => {
  assert.deepEqual({ projects: [] }, { projects: [] });
});
EOF
```

Rerun:

```bash
npx veritas run --working-tree --skip-proof
```

Now the companion rule passes:

```text
PASS  api-routes-require-api-tests: Changed files matched app/api/** and included required companion changes under tests/api/**.

0 failures · 0 warnings · run `veritas run --check shadow` for full evidence
```

In a real repo, remove `--skip-proof` and let the adapter proof lane run the project test or verify command.
