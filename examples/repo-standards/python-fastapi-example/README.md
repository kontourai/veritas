# Python FastAPI Example Snippet

This snippet demonstrates the intended failure:

```text
app/routers/projects.py changed
tests/routers/ unchanged
```

With `python-fastapi.repo-standards.json`, `veritas readiness --working-tree` warns because router changes require router test changes.
