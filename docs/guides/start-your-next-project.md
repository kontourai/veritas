# Start a new project

Follow [Set up Veritas](getting-started.md) for the installation, configuration review and approval steps. For a new repository, keep the initial policy set small:

- Connect the first real test or lint command.
- Define a rule for one recurring review problem.
- Preview a proposed source path with `veritas plan`.
- Demonstrate a violation and a valid case before requiring the rule.

Do not model speculative work areas or require test commands that do not exist yet. Initialization can infer common source/test roots and package scripts, but its guesses need review. The fallback Node smoke command does not test your project.

Use `Observe` or `Guide` for uncertain rules. Add agent hooks and CI enforcement after the local loop is useful. [Code hygiene](code-hygiene.md) shows a policy connected to a real detector; [brownfield adoption](brownfield-adoption.md) covers importing existing verification as the project grows.
