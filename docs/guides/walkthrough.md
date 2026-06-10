# Walkthrough: Next.js API Change

This walkthrough shows the smallest useful Veritas loop: initialize a repo, make an API change without its companion test, see the requirement fail, add the test, and rerun.

## 1. Install And Initialize

```bash
npm install -D @kontourai/veritas
npx veritas init --template nextjs-typescript
```

`--template` is the current CLI flag for selecting a starter template. The product concept is a Repo Standards Template.

Output includes generated starter files:

```json
{
  "template": "nextjs-typescript",
  "generatedFiles": [
    ".veritas/README.md",
    ".veritas/GOVERNANCE.md",
    ".veritas/repo-map.json",
    ".veritas/repo-standards/default.repo-standards.json",
    ".veritas/authority/default.authority-settings.json",
    "AGENTS.md",
    "CLAUDE.md"
  ]
}
```

Together, these generated files represent starter Repo Standards, a Repo Map, and protected standards metadata.

## 2. Change An API Route Without A Test

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
npx veritas readiness --working-tree --skip-evidence-check
```

`--skip-evidence-check` skips the configured evidence-check command (e.g. `npm test`) so this walkthrough can focus on the standards output. In a real repo, omit this flag and let Veritas run the project tests.

The starter standards report the missing companion test requirement:

```text
FAIL  api-routes-require-api-tests: Changed files matched app/api/** but no companion changes matched tests/api/**.
      -> app/api/projects/route.ts

1 failure · 0 warnings · run `veritas readiness --check evidence` for full evidence
```

## 3. Add The Companion Test

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
npx veritas readiness --working-tree --skip-evidence-check
```

Now the requirement passes:

```text
PASS  api-routes-require-api-tests: Changed files matched app/api/** and included required companion changes under tests/api/**.

0 failures · 0 warnings · run `veritas readiness --check evidence` for full evidence
```

In a real repo, remove `--skip-evidence-check` and let the configured evidenceCheck run the project test or verify command.
