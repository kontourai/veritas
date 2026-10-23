# Set up Veritas

Start with one project check and one policy that catches a recurring review problem. You can add more policies after the first one is useful.

The everyday loop is **plan → edit → check readiness**. Setup connects that loop to your repository.

## 1. Connect an existing check

You need Node.js 22 or newer and a Git repository. Install with the package manager your repository already uses. With npm:

```bash
npm install -D @kontourai/veritas
npx --no @kontourai/veritas init --evidence-check "npm test"
```

Replace `npm test` with a real test, lint or verification command. Initialization can infer common package scripts, but inspect the selected command. The fallback `node -e "process.exit(0)"` checks only that Node runs; it provides no evidence about your project.

`init` currently prints JSON describing the generated files, detected repository structure and selected check. It is not an interactive wizard. In particular, `--guided --answers answers.json` consumes answers supplied by you or an agent; it does not conduct a conversation.

If the repository already has Veritas configuration, inspect it first. Do not use `--force` as a routine setup step.

## 2. Review the generated configuration

| File | Review |
| --- | --- |
| `.veritas/repo-map.json` | Source/test paths, work areas and selected check commands |
| `.veritas/repo-standards/default.repo-standards.json` | Applicable rules, their advice and enforcement levels |
| `.veritas/authority/default.authority-settings.json` | Approval-reference requirements and rollout/review preferences for protected changes |
| `.veritas/README.md` | Repository-specific setup notes and suggested wiring |

Initialization also creates supporting governance and claim files and may update detected AI instruction files. See the [artifact reference](../reference/artifacts-and-schemas.md) for the full inventory. Generated output belongs under the ignored `.kontourai/` directory.

Readiness runs configured commands with your local permissions. Review those commands before execution. Leave uncertain policies at `Observe` or `Guide`; promote a policy to `Require` after proving its check catches violations and permits valid code.

After the owner reviews the protected configuration, record that actual approval:

```bash
npx --no @kontourai/veritas attest bootstrap --actor <authority-id> --approval-ref <human-approval-reference> --non-interactive
```

The maintainer must choose an actually authorized person and a reference to the real approval. The settings do not define an actor membership allowlist or authenticate the supplied name. The default mode records the reference without independently resolving it. The [approval guide](attestation.md) explains stronger resolution and what an attestation establishes.

## 3. Preview an edit

Choose a real or proposed path in your repository:

```bash
npx --no @kontourai/veritas plan src/example.ts
```

The plan shows matching guidance and selected checks. It does not execute them or establish readiness. Use `explain --file src/example.ts` for more detail about a path's rules.

If no useful policy matches, add one before expanding the setup. The [walkthrough](walkthrough.md) demonstrates companion-test guidance; [code hygiene](code-hygiene.md) shows how to connect a policy to a detector or test command.

## 4. Check the change

After editing:

```bash
npx --no @kontourai/veritas readiness --working-tree
```

Read the outcome and affected paths:

- `PASS`: the reported assertion or check passed within its stated scope.
- `WARN`: advisory guidance or a coverage gap needs attention.
- `FAIL`: a required policy or check is unmet; follow its remediation.

A passing smoke command, a companion file change and a passing behavioral test establish different things. Judge the check's coverage before relying on its result. Readiness does not certify correctness or decide how much review to remove.

For committed branch changes, use `--changed-from <ref> --changed-to HEAD` instead of `--working-tree`. Use `--format json` for automation. The [CLI reference](../reference/cli.md) documents exact flags and output.

## 5. Make the first policy useful

Demonstrate a known violation, confirm Veritas reports the intended finding, restore the valid code and confirm it passes. Keep this experiment isolated from other work. Only then decide whether to require the policy in CI.

Next, add [agent hooks](agent-runtime-integrations.md) or [CI integration](repo-conformance.md). Review [feedback and recommendations](recommendations.md) later, once real usage provides evidence of noisy or missing policies.

## Optional setup paths

For a reviewable proposal before active policy files are written:

```bash
npx --no @kontourai/veritas init --explore
```

Review `.veritas/init-plans/explore.json`. It is generated offline from repository signals. The [CLI reference](../reference/cli.md#init) explains supplied answers, plan integrity, applying a reviewed plan and overwrite behavior.

For an existing repository with substantial verification, follow [brownfield adoption](brownfield-adoption.md). Use the [Governance Kit](governance-kit.md) only if you want Flow Agents to distribute setup workflows and hooks; it is optional for the standalone CLI.
