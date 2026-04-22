# Veritas Starter Kit

This repo was bootstrapped for `veritas` with a conservative starter kit for agent-guided development.

This copy is intentionally tracked and slightly tightened for the framework repo itself, so self-hosting covers `bin/`, `schemas/`, `adapters/`, `policy-packs/`, and `examples/` instead of sending those areas straight to manual review.

The repo-level check-in commands live in `package.json`:

- `npm run veritas:checkin:report`
- `npm run veritas:checkin:shadow`
- `npm run veritas:checkin`
- `npm run veritas:checkin:examples`
- `npm run veritas:checkin:prove`

## Generated Files

- `.veritas/repo.adapter.json`
- `.veritas/policy-packs/default.policy-pack.json`
- `.veritas/team/default.team-profile.json`

## Inferred Repo Shape

- Repo kind: `application`
- Source roots: `src/`, `docs/`
- Tooling roots: `scripts/`
- Test roots: `tests/`
- GitHub workflows detected: `no`
- Matching scripts seen: `verify`, `test`

## What To Do Next

1. Confirm the inferred source/test roots match the real repo layout.
2. Replace the suggested proof lane if a stronger project health command exists.
3. Keep the team profile in `shadow` mode until you have enough evidence to tighten rules.

## Suggested Commands

```bash
npm exec -- veritas print package-scripts
npm exec -- veritas print ci-snippet
npm exec -- veritas apply package-scripts
npm exec -- veritas apply ci-snippet
npm exec -- veritas runtime status
npm exec -- veritas report package.json
```

If you prefer explicit paths:

```bash
npm exec -- veritas report \
  --adapter ./.veritas/repo.adapter.json \
  --policy-pack ./.veritas/policy-packs/default.policy-pack.json \
  package.json
```

## Suggested Proof Lane

`npm run verify`

## Surface-Aware Routing

This repo shape justifies surface-aware proof routing, so the starter adapter also includes `defaultProofLanes` and `uncoveredPathPolicy` alongside the legacy flat proof lane for compatibility.

## Why This Exists

The goal is to give any compatible agent just-in-time repo guidance from day one, while keeping review and CI grounded in the same starter rules.
