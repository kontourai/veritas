# Veritas Governance Kit

This repository is both the home of the standalone `@kontourai/veritas` engine and a root-valid
Flow Kit repository. Flow Agents installs the kit from Git; the kit then helps a maintainer set
up and operate the engine in a target repository.

## Install from Git

Pin a release tag, branch, or commit through the Git URL fragment or `--ref`:

```bash
npx @kontourai/flow-agents kit install \
  https://github.com/kontourai/veritas.git#v1.8.0 \
  --dest .

npx @kontourai/flow-agents kit activate \
  --dest . \
  --format json
```

Flow Agents shallow-clones the repository, validates the root `kit.json`, records source and
content-hash provenance, and activates the declared flows, skills, and docs. Git installation
does not execute repository scripts, install the Veritas npm package, or provision
host hooks. The activated `setup-governance` skill uses Flow Agents's separate,
reviewed provision step for the declared Codex hook:

```bash
flow-agents kit provision veritas-governance --target . --dry-run
flow-agents kit provision veritas-governance --target .
```

The provision declares `host: codex` and `kind: hook`, so Flow Agents routes its
explicit target through Conduit's Codex adapter and records a content-safe
installation receipt. Its explicit `hooks-json` merge preserves existing host
hooks and refuses a conflicting command definition. Codex itself must trust
the new or changed hook definition before use.

## Set up the engine

Use the activated `setup-governance` skill. It detects the CLI first and requests approval
before installing `@kontourai/veritas`, applying a Repo Standards plan, configuring hooks, or
recording bootstrap authority. The shortest reviewed path is:

```bash
npm install -D @kontourai/veritas
npm exec -- veritas init --explore --output .veritas/init-plans/first-pass.json
# Review and approve the generated plan.
npm exec -- veritas init --apply --plan .veritas/init-plans/first-pass.json
npm exec -- veritas setup repo-hooks
npm exec -- veritas attest bootstrap --actor <authority-id> \
  --approval-ref <human-approval-reference> --non-interactive
npm exec -- veritas readiness --working-tree
```

### Non-npm repositories

Do not add a consumer `package.json` merely to run Veritas. After explicit maintainer approval of
the exact engine release, use the pinned ephemeral invocation for every setup command:

```bash
npm exec --yes --package=@kontourai/veritas@1.8.0 -- veritas --version
npm exec --yes --package=@kontourai/veritas@1.8.0 -- veritas init --explore --output .veritas/init-plans/first-pass.json
# Review and approve the generated plan.
npm exec --yes --package=@kontourai/veritas@1.8.0 -- veritas init --apply --plan .veritas/init-plans/first-pass.json
npm exec --yes --package=@kontourai/veritas@1.8.0 -- veritas readiness --working-tree
```

This invocation uses npm's execution cache without writing the consumer manifest or lockfile.
The exact `1.8.0` version is the approved engine pin in this example; never substitute `latest`,
a range, or a different version without renewed maintainer approval. For a repository without a
package manifest, init configures a Node runtime smoke check so the first readiness run is
runnable. Replace that smoke check with the repository's real evidenceCheck before promoting it.

## Gate canonical readiness

Veritas emits the canonical Hachure trust bundle directly; the kit does not maintain a second
readiness interpretation:

```bash
npm exec -- veritas readiness --check evidence --working-tree \
  --format trust-bundle > readiness.bundle.json

flow init
flow start \
  .kontourai/flow-agents/projections/codex/flows/veritas-governance/veritas-governance.readiness-check.flow.json \
  --run-id readiness
flow attach-evidence readiness --gate gate-check-gate \
  --file readiness.bundle.json --bundle
flow evaluate readiness --gate gate-check-gate --exit-code
```

A failed required standard remains represented in the bundle and causes the Flow gate to block.
Flow consumes the verdict; Veritas alone owns Repo Standards evaluation and readiness semantics.

## Review a standards plan with Survey

The optional Survey interface presents the real init plan, current and proposed
artifact bytes, reasoning, and unresolved owner questions. It records four distinct
outcomes: approve, decline, request changes with a note, or could not confirm.
The review does not provide missing owner answers, apply standards, write an
attestation, attach Flow evidence, or advance a gate.

Use Flow Agents's native review interface with this installed kit. The host
opens Survey and manages the transport; Veritas supplies the current plan queue
and domain admission. After installing and activating the kit in a separate
bootstrap directory, generate the plan in the target repository:

```sh
npm exec -- veritas init --explore --output .veritas/init-plans/proposal.json
mkdir -p /absolute/private/veritas-review-host
chmod 700 /absolute/private/veritas-review-host
```

Write a private review request with absolute paths and your chosen expiry:

```json
{
  "schema": "kontour.kit.review_request",
  "version": "1.0",
  "kit_id": "veritas-governance",
  "input": {
    "rootDir": "/absolute/path/to/project",
    "planPath": "/absolute/path/to/project/.veritas/init-plans/proposal.json",
    "hostRoot": "/absolute/private/veritas-review-host",
    "expiresAt": "2026-10-13T12:00:00Z"
  }
}
```

```sh
flow-agents kit review veritas-governance --dest /absolute/kit-bootstrap \
  --request /absolute/private/governance-review-request.json
```

This requires a Flow Agents release exposing `kit review` and this kit's declared
`review` producer. The existing `veritas review` command and
`serveGovernanceSurveyReview` API remain standalone compatibility interfaces;
new kit use should select the native host. The standalone evaluation engine has
no Flow Agents dependency.

Choose a future expiry for the actual review; the command never renews it. Open
the returned loopback URL, inspect every artifact card, select the disposition,
and send the review to the workflow. The host directory must be outside the
repository and private. It retains the signed queue and disposition separately
from protected standards. The observation covers Git HEAD, tracked and nonignored
untracked file bytes, the exact plan, its local producer integrity record, and
current target bytes. A changed basis or expired review refuses new application.
Admission is bounded to 10,000 source files and 32 MiB of observed bytes; repositories
with symlinks or larger sources need a separately scoped review implementation.

The CLI identifies this as a **host-observed operator interaction**. Approve is a
recommendation until a trusted host resolves authority. A name stored in a session,
a browser click, or an MCP tool call never establishes authenticated human approval.
Decline and could not confirm grant no approval; request changes requires a new
plan and new review. Replaying a consumed session refuses. If only the presentation
application marker is lost, the host returns its original signed disposition.

The same private session can be inspected and decided through Survey's CLI/MCP App:

```sh
npx --yes --package=@kontourai/survey@8.1.0 survey-review-mcp \
  --session /absolute/private/veritas-review-host/RETURNED_SESSION.json
```

MCP records events in the same locked session; application occurs through the
host's console callback. Keep that private session out of Git and public exports.
Ctrl-C closes this command's own server.

### Trusted host integration

The optional producer remains separate from the standalone evaluation engine.
A trusted Flow Agents host supplies identity resolution through a server-side
callback, rather than putting authority in the JSON request:

```js
import {openInstalledKitReview} from '@kontourai/flow-agents/kit-review';

const consoleServer = await openInstalledKitReview({
  kitId: 'veritas-governance', dest: bootstrapDir, requestFile,
  host: {
    resolveAuthority: async request => approvalService.resolveCurrentReviewer(request),
  },
});
```

The root kit manifest declares `prepareKitReview` under
`kontour.kit.review_request@1.0`. The producer returns a private `sessionPath`,
Survey queue `binding`, and domain `apply` callback. Flow Agents checks installed
content integrity before loading it and again before application. Survey keeps
its event/session lock; Veritas rechecks the exact plan, checkout and expiry and
records the disposition. No callback or authority assertion is accepted from the
serialized request or browser.

`approvalService` is a host-owned integration, not supplied by Veritas. It must
authenticate the reviewer, confirm membership and permission for this change,
and resolve a durable approval reference. Its result uses the existing approval
resolver status/expiry contract and must provide `approvedBy`, `authorityRef`,
`evidenceHash`, and `scope.reviewBasisDigest` matching the supplied exact basis.
It is configured server-side; never build it from browser/MCP actor strings or
agent assertions. Source and expiry are checked again after the resolver returns.
The host is responsible for resolver idempotency and downstream policy.

Even a host-resolved review only records a disposition. The existing Veritas
attestation policy and Flow standards-authoring gate still own admission; apply
through the ordinary plan command after those requirements are satisfied. When
an actual Flow gate is paused, a Flow Agents host can use its public
`createSurveyFlowGateAdapter` and `continuePausedFlowGateFromSurvey` contracts
with a current producer-owned queue, authenticated authority and expected run
head. This plan-review console is not a replacement Flow continuation engine.

AI-DLC's requirements checkpoint uses the same Survey transport but its own
signed pending request, artifact basis and original execution budget. Both kits
use Plumb's shared observations; Veritas retains standards evaluation and AI-DLC
retains methodology-specific sensor checks.

The native host supplies `services.survey` from its own installed Survey package
(`bindReviewQueue` and `deriveReviewSessionApplyResultForSnapshot`). The producer
uses those public methods without requiring a separate Survey package next to
the Git-installed kit. This service object is a trusted in-memory argument,
never serialized request data or reviewer authority. Standalone compatibility
hosting still uses its optional Survey peer.
