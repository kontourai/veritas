## Veritas Eval Draft

- **Run ID:** veritas-repo-check-in
- **Mode:** shadow
- **Team profile:** veritas-default
- **Evidence artifact:** `.veritas/evidence/veritas-repo-check-in.json`
- **Draft artifact:** `.veritas/eval-drafts/veritas-repo-check-in.json`
- **Missing confirmation fields:** accepted_without_major_rewrite, required_followup

### Next Step

`npm exec -- veritas eval record --draft .veritas/eval-drafts/veritas-repo-check-in.json --accepted-without-major-rewrite '<true|false>' --required-followup '<true|false>' --reviewer-confidence high --time-to-green-minutes 12 --override-count 0 --note 'This example is generated from the Veritas repo using its tracked .veritas config.' --note 'The goal is to show a self-hosted report and eval flow without making local evidence outputs part of the distributed package.'`
