# Veritas on Surface

Veritas is the producer experience. Surface is the product-neutral protocol underneath it.

```text
Repository -> veritas.claims.json -> stable authored claims
Veritas    -> evidence collection  -> per-run proof and policy observations
Surface    -> trust derivation     -> status, fault lines, reports, analytics
```

Veritas registers a Surface extension so local dashboards can use Veritas vocabulary, claim type definitions, and theme. Applications using Veritas do not need to know Surface internals, but the exported `surface.input` remains a valid Surface trust input.

## Runtime Model

1. The repository commits `veritas.claims.json`.
2. A Veritas run loads that store.
3. Veritas matches run observations to authored claim IDs.
4. Veritas emits evidence and verification events for matched claims.
5. Surface derives the authoritative status from evidence, policy, freshness, and fault lines.

If `veritas.claims.json` is missing, projection fails with a migration error. Run `veritas claim init` and commit the resulting store.
