# Next.js TypeScript Fixture Snippet

This snippet demonstrates the intended failure:

```text
app/api/projects/route.ts changed
tests/api/ unchanged
```

With `nextjs-typescript.repo-standards.json`, `veritas readiness --working-tree` warns because `app/api/**` changes require `tests/api/**` changes.
