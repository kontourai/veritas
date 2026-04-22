## Veritas Report

- **Adapter:** veritas (repo-adapter)
- **Source:** explicit-files (explicit)
- **Phase:** Phase 0 (Bootstrap)
- **Workstream:** Initial Project Setup
- **Affected nodes:** app.src, docs.docs, governance.guidance, governance.root-manifests, governance.schemas, tooling.bin, verification.tests
- **Affected lanes:** .veritas/**, bin/**, docs/**, root manifests, schemas/**, src/**, tests/**
- **Selected proof commands:** `npm run verify`
- **Proof resolution source:** default
- **Uncovered path result:** clear
- **Baseline `ci:fast` passed:** yes
- **Report transport:** local-json
- **Policy results:** 4 passed, 0 failed, 1 metadata-only
- **Artifact:** `.veritas/evidence/veritas-repo-dogfood.json`

### Policy Results
- required-veritas-dogfood-artifacts: pass — All required repository artifacts are present.
- required-veritas-cli-artifacts: pass — All required repository artifacts are present.
- required-veritas-reference-artifacts: pass — All required repository artifacts are present.
- required-veritas-schema-artifacts: pass — All required repository artifacts are present.
- prefer-veritas-routed-delivery: metadata-only — Rule prefer-veritas-routed-delivery is metadata-only in the current framework.

- No recommendations.
