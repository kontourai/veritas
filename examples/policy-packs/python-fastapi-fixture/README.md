# Python FastAPI Fixture Snippet

This snippet demonstrates the intended failure:

```text
app/routers/projects.py changed
tests/routers/ unchanged
```

With `python-fastapi.policy-pack.json`, `veritas run --working-tree` warns because router changes require router test changes.
