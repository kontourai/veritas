# pnpm Monorepo Fixture Snippet

This snippet demonstrates the intended failure:

```text
packages/catalog/src/index.ts changed
CHANGELOG.md unchanged
```

With `monorepo-pnpm.policy-pack.json`, `veritas run --working-tree` warns because package changes should include a release-visible changelog update.
