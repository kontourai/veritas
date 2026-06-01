# Starter Repo Standards Templates

These templates are starting points for common repo shapes. They are examples, not universal policy. Use `veritas init --template <name>` to copy one into the repo's Veritas standards file, then tune it for your repo.

## `nextjs-typescript`

For App Router or API-heavy TypeScript apps. It requires API route changes to include API tests, blocks `console.log` in app code, and pushes environment access into a central `lib/env.ts` module.

## `python-fastapi`

For small FastAPI services. It requires router changes to include router tests, blocks `print(` in application code, and requires `pyproject.toml` so tooling expectations are explicit.

## `monorepo-pnpm`

For pnpm workspaces. It requires workspace governance files, catches package boundary cross-writes through strict surface ownership, and expects release-visible changes to update a root changelog.
