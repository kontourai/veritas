# pnpm Monorepo Fixture Snippet

This snippet demonstrates the intended failure:

```text
packages/catalog/src/index.ts changed
CHANGELOG.md unchanged
```

With `monorepo-pnpm.repo-standards.json`, `veritas readiness --working-tree` warns because package changes should include a release-visible changelog update.
