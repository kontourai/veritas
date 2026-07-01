## Veritas Standards Feedback Draft

- **Run ID:** veritas-repo-conformance
- **Mode:** observe
- **Authority settings:** veritas-default
- **Evidence artifact:** `.kontourai/veritas/evidence/veritas-repo-conformance.json`
- **Draft artifact:** `.kontourai/veritas/standards-feedback-drafts/veritas-repo-conformance.json`
- **Missing confirmation fields:** accepted_without_major_rewrite, required_followup
- **Governance paths:** .veritas/GOVERNANCE.md, .veritas/repo-map.json, .veritas/repo-standards/default.repo-standards.json, .veritas/authority/default.authority-settings.json
- **Protected standards touched:** yes
- **Governance classification:** unknown
- **Human governance review required:** no

### Next Step

`npm exec -- veritas feedback record --draft .kontourai/veritas/standards-feedback-drafts/veritas-repo-conformance.json --accepted-without-major-rewrite '<true|false>' --required-followup '<true|false>' --reviewer-confidence high --time-to-green-minutes 12 --exception-count 0 --note 'This example is generated from the Veritas repo using its tracked .veritas config.' --note 'The goal is to show a self-hosted report and standards feedback flow without making local evidence outputs part of the distributed package.'`
