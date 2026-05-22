# Veritas Starter Kit

This repo was bootstrapped for `veritas` with a conservative starter kit for agent-guided development.

This copy is intentionally tracked and slightly tightened for the Veritas product repo itself, so self-hosting covers `bin/`, `schemas/`, adapters, Repo Standards, and examples instead of sending those areas straight to manual review.

The repo-level check-in commands live in `package.json`:

- `npm run veritas:checkin:report`
- `npm run veritas:checkin:readiness`
- `npm run veritas:checkin`
- `npm run veritas:checkin:examples`
- `npm run veritas:checkin:verify`

## Generated Files

- `.veritas/GOVERNANCE.md`
- `.veritas/repo.adapter.json`
- `.veritas/repo-standards/default.repo-standards.json`
- `.veritas/team/default.team-profile.json`

## Inferred Repo Shape

- Repo kind: `application`
- Source roots: `src/`, `docs/`
- Tooling roots: `scripts/`
- Test roots: `tests/`
- GitHub workflows detected: `yes`
- Matching scripts seen: `verify`, `test`

## What To Do Next

1. Confirm the inferred source/test roots match the real repo layout.
2. Replace the suggested evidenceCheck if a stronger project health command exists.
3. Keep uncertain requirements in Observe or Guide until you have enough evidence to tighten them.

## Suggested Commands

```bash
npx @kontourai/veritas readiness --working-tree
npx @kontourai/veritas readiness --check coverage --working-tree
npx @kontourai/veritas attest status
npx @kontourai/veritas attest bootstrap --actor <authority-id> --non-interactive
```

If you prefer explicit paths:

```bash
npx @kontourai/veritas readiness --check evidence \
  --adapter ./.veritas/repo.adapter.json \
  --repo-standards ./.veritas/repo-standards/default.repo-standards.json \
  package.json
```

## Suggested Evidence Check

`npm run verify`

## Work-Area Evidence Routing

This repo shape justifies work-area evidence routing, so the starter Repo Map includes explicit evidenceChecks, default check ids, and an uncovered-path policy.

## Why This Exists

The goal is to give developers and agents just-in-time repo guidance from day one, while keeping review and CI grounded in the same starter standards.
