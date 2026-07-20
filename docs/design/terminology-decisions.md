# Terminology Decisions

This document records durable terminology decisions that keep the product language stable while
implementation names and compatibility paths evolve.

## Repo Map remains the canonical user-facing term

**Decision:** Use **Repo Map** for the repo-local model of work areas, boundaries, protected
areas, ownership context, and dependency relationships.

**Why:** The glossary, CLI reference, guides, and product architecture consistently describe this
artifact as a Repo Map. That is stronger repository evidence than older implementation labels
such as `adapter`, `surface`, or generic configuration names.

**Compatibility:** Internal schemas, JSON keys, file paths, and migration code may retain their
current names when a rename would break a stored artifact or public compatibility contract. Those
implementation names are not alternate product vocabulary. User-facing commands, documentation,
recommendations, and generated explanations should say Repo Map unless they must show an exact
field, path, or API identifier.

**Consequences:**

- Keep `.veritas/repo-map.json` as the precise path when setup or schema accuracy requires it.
- Explain that path to users as the Repo Map rather than exposing an internal compatibility label.
- Revisit this decision only when repository-wide product evidence establishes a clearer,
  materially different canonical term.
