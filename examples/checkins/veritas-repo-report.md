## Veritas Report

- **Adapter:** veritas (repo-adapter)
- **Source:** explicit-files (explicit)
- **Phase:** Phase 0 (Bootstrap)
- **Workstream:** Initial Project Setup
- **Affected nodes:** app.src, docs.docs, governance.guidance, governance.root-manifests, governance.schemas, tooling.bin, verification.tests
- **Affected lanes:** .veritas/**, bin/**, docs/**, root manifests, schemas/**, src/**, tests/**
- **Selected evidenceCheck commands:** `npm run verify, npm run veritas:fallow:advisory`
- **Evidence Check selection:** default
- **Evidence Check items:** 0 total, 0 required, 0 candidate, 0 move-to-test, 0 retiring
- **External tool results:** 1
- **Uncovered path result:** clear
- **Baseline `ci:fast` passed:** yes
- **Report transport:** local-json
- **Policy results:** 7 passed, 0 failed, 0 metadata-only
- **Artifact:** `.veritas/evidence/veritas-repo-check-in.json`

### Policy Results
- required-veritas-operational-artifacts: pass — All required repository artifacts are present.
- required-veritas-cli-artifacts: pass — All required repository artifacts are present.
- required-veritas-reference-artifacts: pass — All required repository artifacts are present.
- required-veritas-schema-artifacts: pass — All required repository artifacts are present.
- ai-instruction-files-synced: pass — All required AI instruction files contain the canonical Veritas governance block.
- prefer-veritas-routed-delivery: pass — All required repository artifacts are present.
- no-console-log-in-src: pass — No matched files contain forbidden pattern console\.log.

### External Tool Results
- fallow:fallow-advisory: warn / advisory — .veritas/external/fallow-audit.json

### Readiness Coverage
- Readiness coverage has owners, review triggers, and no unknown catch-evidence inventories.

- No recommendations.
