# Reference Adapters

The files in this directory are reference examples for other repo shapes.

They are not the active adapter for the `veritas` repo itself.

Current examples:

- `work-agent.adapter.json` models the external `work-agent` repository shape
- `demo-docs-site.adapter.json` models a smaller documentation-site repository shape

Dogfooding for this repository uses the tracked repo-local adapter at:

- `.veritas/repo.adapter.json`

That repo-local adapter is the one used by the self-hosting check-in flow, local `veritas report` / `shadow run` usage, and the verification examples under `examples/checkins/`.
