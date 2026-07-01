# Context Map

Veritas has one product context and a few focused subcontexts. The root context names the shared product language; local contexts sharpen terms that only make sense inside one product workflow.

## Contexts

- [Veritas](./CONTEXT.md) - repo and AI-agent governance language shared across the product.
- [Merge Readiness](./src/readiness/CONTEXT.md) - change-level readiness runs and the evidence-backed state they coordinate.
- [Surface Projection](./src/surface/CONTEXT.md) - the Built with Surface projection that makes Veritas readiness state portable.
- [Standards Feedback](./src/standards-feedback/CONTEXT.md) - observed evidence about whether repo standards are helping and how recommendations are formed.
- [Protected Standards Authority](./src/attestations/CONTEXT.md) - authority-backed attestations for protected standards and governance drift.

## Relationships

- **Merge Readiness -> Veritas**: Merge Readiness evaluates Repo Standards and Repo Map context to produce a Readiness Report.
- **Merge Readiness -> Standards Feedback**: each readiness run can create feedback evidence about whether the standards helped the change reach green.
- **Merge Readiness -> Surface Projection**: readiness outcomes are projected into portable trust state without moving Veritas product language into Surface.
- **Protected Standards Authority -> Merge Readiness**: authority state can add, satisfy, or fail requirements when Protected Standards change or drift.
- **Standards Feedback -> Protected Standards Authority**: accepting a standards recommendation can require an attestation because it changes Protected Standards.
