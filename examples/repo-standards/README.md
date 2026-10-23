# Starter Repo Standards Templates

These templates are starting points for common repo shapes. They are examples, not universal policy. Use `npx --no @kontourai/veritas init --template <name>` to copy one into the repo's Veritas standards file, then tune it for your repo.

## `nextjs-typescript`

For App Router or API-heavy TypeScript apps. Its Guide-level rules warn when API route changes lack companion test changes, app code uses `console.log`, or environment access bypasses `lib/env.ts`. These are advisory findings, not hard failures.

## `python-fastapi`

For small FastAPI services. Its Guide-level rules advise companion router tests and avoiding `print(` in application code. Required-artifact rules also establish the tooling files listed by the template, including `pyproject.toml`.

## `monorepo-pnpm`

For pnpm workspaces. It requires workspace governance artifacts and gives Guide-level boundary and changelog advice. Boundary evaluation depends on the configured map and actor ownership; the template alone does not establish complete package isolation.
