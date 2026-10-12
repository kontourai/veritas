import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash, createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {isApprovalResolverResultAccepted, summarizeApprovalResolverResult} from './approval-resolvers.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const actions = ['approve', 'request-changes', 'decline'];
const maxBytes = 32 * 1024 * 1024;

function privateRoot(hostRoot, rootDir) {
  const root = fs.realpathSync(hostRoot), repo = fs.realpathSync(rootDir);
  requireValue(root !== repo && !root.startsWith(repo + path.sep), 'Review host root must be outside the repository');
  requireValue((fs.statSync(root).mode & 0o077) === 0, 'Review host root must be private (mode 0700)');
  return root;
}
function key(hostRoot, create = false) {
  const file = path.join(hostRoot, 'review-key');
  if (create && !fs.existsSync(file)) {
    try { fs.writeFileSync(file, randomBytes(32), {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  requireValue(!fs.lstatSync(file).isSymbolicLink() && (fs.statSync(file).mode & 0o077) === 0, 'Review key must be a private regular file');
  const bytes = fs.readFileSync(file); requireValue(bytes.length === 32, 'Invalid review key'); return bytes;
}
const sign = (hostRoot, value) => createHmac('sha256', key(hostRoot)).update(JSON.stringify(value)).digest('hex');
function verify(hostRoot, value, signature) {
  const expected = Buffer.from(sign(hostRoot, value), 'hex'), actual = Buffer.from(signature ?? '', 'hex');
  requireValue(actual.length === expected.length && timingSafeEqual(actual, expected), 'Review producer binding changed');
}

/** Observe real Git checkout bytes, including nonignored untracked source. */
function observe(rootDir, planPath) {
  const root = fs.realpathSync(rootDir), file = fs.realpathSync(planPath);
  requireValue(file.startsWith(path.join(root, '.veritas', 'init-plans') + path.sep), 'Review requires a repository-local init plan');
  const planBytes = fs.readFileSync(file); requireValue(planBytes.length <= maxBytes, 'Plan exceeds review byte budget');
  const plan = JSON.parse(planBytes.toString('utf8'));
  requireValue(plan.schema_version === 2 && plan.artifact_payloads && Array.isArray(plan.required_artifact_paths), 'Expected a Veritas version-2 init recommendation');
  const payloadHashes = Object.fromEntries(Object.entries(plan.artifact_payloads).map(([name, text]) => {
    requireValue(typeof text === 'string' && !path.isAbsolute(name) && !path.relative(root, path.resolve(root, name)).startsWith('..'), 'Unsafe plan artifact');
    return [name, hash(text)];
  }));
  const integrityFile = path.join(root, '.kontourai/veritas/init-plan-integrity', hash(path.relative(root, file).replaceAll('\\', '/')) + '.json');
  const integrity = read(integrityFile).artifact_payload_hashes;
  requireValue(JSON.stringify(Object.entries(payloadHashes).sort()) === JSON.stringify(Object.entries(integrity ?? {}).sort()), 'Plan differs from its local producer integrity record');
  requireValue(JSON.stringify(Object.keys(payloadHashes).sort()) === JSON.stringify([...plan.required_artifact_paths].sort()), 'Plan artifact inventory changed');
  const env = {...process.env};
  for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
  const git = args => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', maxBuffer: maxBytes, env});
  const head = git(['rev-parse', 'HEAD']).trim();
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
  requireValue(files.length <= 10000, 'Checkout exceeds review file budget');
  let total = planBytes.length;
  const source = files.filter(name => !name.startsWith('.kontourai/') && !name.startsWith('.veritas/init-plans/')).map(name => {
    const target = path.join(root, name);
    if (!fs.existsSync(target)) return [name, null];
    requireValue(!fs.lstatSync(target).isSymbolicLink() && fs.statSync(target).isFile(), 'Review source must be regular files');
    total += fs.statSync(target).size; requireValue(total <= maxBytes, 'Checkout exceeds review byte budget');
    return [name, hash(fs.readFileSync(target))];
  });
  const targets = Object.keys(payloadHashes).sort().map(name => {
    const target = path.join(root, name);
    if (!fs.existsSync(target)) return [name, null];
    requireValue(fs.realpathSync(target).startsWith(root + path.sep) && !fs.lstatSync(target).isSymbolicLink() && fs.statSync(target).isFile(), 'Plan target must be a repository-local regular file');
    total += fs.statSync(target).size; requireValue(total <= maxBytes, 'Plan targets exceed review byte budget');
    return [name, hash(fs.readFileSync(target))];
  });
  const basis = {root, planPath: file, head, source, targets, planDigest: hash(planBytes), integrityDigest: hash(fs.readFileSync(integrityFile))};
  return {basis, basisDigest: hash(JSON.stringify(basis)), plan};
}

export async function createGovernanceSurveyReview({rootDir, planPath, hostRoot, expiresAt}) {
  const root = fs.realpathSync(rootDir), host = privateRoot(hostRoot, root);
  const deadline = Date.parse(expiresAt);
  requireValue(Number.isFinite(deadline) && deadline > Date.now(), 'A future review expiry is required');
  const observed = observe(root, path.resolve(root, planPath));
  const api = await import('@kontourai/survey/review-workbench');
  key(host, true);
  const id = randomUUID(), at = new Date().toISOString();
  const candidate = (name, value, target) => ({id: name, role: 'proposed', value,
    source: {sourceId: id, sourceRef: `veritas-plan:${observed.basis.planDigest}`, kind: 'manual-entry', observedAt: at, locatorScheme: 'structured-field'},
    extraction: {extractionId: name, target, extractor: 'veritas-plan-observer', extractedAt: at}, locator: {scheme: 'structured-field'},
    claimTarget: {claimId: name, subjectType: 'repo-governance-change', subjectId: observed.basisDigest, facet: 'workflow', claimType: 'standards-plan-review', fieldOrBehavior: target, impactLevel: 'high', collectedBy: 'veritas-governance'}});
  const card = (name, target, candidates, rationale, extra = {}) => ({apiVersion: 'survey.kontourai.io/v1alpha1', kind: 'ReviewItem', metadata: {name, producer: {displayName: `Veritas standards plan — expires ${expiresAt}`}}, spec: {target, candidates, editable: false, rationale, ...extra}});
  const items = [card('plan-context', 'Reasoning and unresolved owner questions', [candidate('context', JSON.stringify({reasoning: observed.plan.reasoning_summary, owner_questions: observed.plan.owner_questions, owner_answers: observed.plan.owner_answers}, null, 2), 'context')], 'Review owner questions separately; this interface does not supply missing answers.')];
  for (const [name, text] of Object.entries(observed.plan.artifact_payloads)) {
    const current = path.join(root, name);
    const before = fs.existsSync(current) ? fs.readFileSync(current, 'utf8') : '(new file)';
    const value = `CURRENT ${name}\n${before}\n\nPROPOSED ${name}\n${text}`;
    items.push(card(`artifact-${items.length}`, name, [{...candidate(name, value, name), locator: {scheme: 'structured-field', excerpt: value}}], 'Inspect the current and proposed bytes. Accepting this card acknowledges inspection; the separate decision controls disposition.'));
  }
  items.push(card('workflow-decision', 'Decision for this exact standards proposal', actions.map(action => candidate(action, action, action)), 'Approve recommends this plan. A trusted host must independently resolve human authority before it can authorize application. Request changes needs a correction note; Could not confirm leaves approval unresolved.', {candidateSetStatus: 'conflict'}));
  const snapshot = {items, activeItemName: items[0].metadata.name, notesByItemName: {}, decisionsByItemName: {}, reviewedAt: at, actorId: 'host-observed:local-operator'};
  const domain = {id, rootDir: root, planPath: observed.basis.planPath, basisDigest: observed.basisDigest, expiresAt, snapshot, binding: api.bindReviewQueue(snapshot, {sessionName: id})};
  const sessionFile = path.join(host, `${id}.json`);
  fs.writeFileSync(sessionFile, JSON.stringify({session: {apiVersion: 'survey.kontourai.io/v1alpha1', kind: 'ReviewSession', metadata: {name: id}}, snapshot, events: [], veritas: {domain, signature: sign(host, domain)}}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return {sessionFile, basisDigest: domain.basisDigest, expiresAt, decisionKind: 'host-observed-operator-interaction'};
}

function session(hostRoot, sessionPath) {
  const file = fs.realpathSync(sessionPath), host = fs.realpathSync(hostRoot);
  requireValue(path.dirname(file) === host, 'Review session must stay in its private host root');
  const content = read(file), domain = content.veritas?.domain;
  verify(host, domain, content.veritas?.signature);
  privateRoot(host, domain.rootDir);
  requireValue(JSON.stringify(content.snapshot) === JSON.stringify(domain.snapshot) && content.session.metadata.name === domain.id, 'Review snapshot or actor changed');
  return {file, host, content, domain};
}

/** Optional host resolver is configured server-side, never through browser/MCP input.
 * This records a disposition; it never applies standards or creates an attestation.
 */
async function governanceReviewProducer({hostRoot, sessionPath, resolveAuthority}) {
  const initial = session(hostRoot, sessionPath);
  const api = await import('@kontourai/survey/review-workbench');
  return {sessionPath: initial.file, binding: initial.domain.binding, apply: async () => {
    const {host, content, domain} = session(hostRoot, sessionPath);
    const derived = api.deriveReviewSessionApplyResultForSnapshot({snapshot: domain.snapshot, events: content.events, requiredResolvedItems: 'all'});
    requireValue(derived.ok, 'Resolve every review item');
    const choice = derived.results.find(item => item.reviewItemName === 'workflow-decision');
    const uncertain = derived.results.filter(item => item.decision === 'could-not-confirm');
    const action = uncertain.length ? 'could-not-confirm' : choice?.selectedCandidateId;
    requireValue(action === 'could-not-confirm' || (actions.includes(action) && choice.decision === 'select-proposed' && derived.results.filter(item => item !== choice).every(item => item.decision === 'accept-proposed')), 'Select an explicit disposition after inspecting every artifact');
    const note = uncertain.length ? uncertain.map(item => item.reviewDecision?.spec?.rationale ?? '').join('\n') : choice.reviewDecision?.spec?.rationale ?? '';
    requireValue(note.length <= 4096 && (action !== 'request-changes' || note.trim()), 'Request changes requires a bounded correction note');
    const receiptPath = path.join(host, `${domain.id}.decision.json`), intent = {action, note, basisDigest: domain.basisDigest};
    if (fs.existsSync(receiptPath)) {
      const prior = read(receiptPath); verify(host, prior.receipt, prior.signature);
      requireValue(JSON.stringify(prior.receipt.intent) === JSON.stringify(intent), 'A different disposition is already recorded');
      return {reference: `veritas-review:${domain.id}`, summary: prior.receipt.summary};
    }
    const current = () => {
      requireValue(Date.parse(domain.expiresAt) > Date.now(), 'Review expired');
      requireValue(observe(domain.rootDir, domain.planPath).basisDigest === domain.basisDigest, 'Plan or checkout changed while review was open');
    };
    current();
    let authority = null;
    if (action === 'approve' && resolveAuthority) {
      authority = await resolveAuthority(Object.freeze({reviewId: domain.id, basisDigest: domain.basisDigest, rootDir: domain.rootDir, planPath: domain.planPath, expiresAt: domain.expiresAt}));
      requireValue(authority?.scope?.reviewBasisDigest === domain.basisDigest && authority.approvedBy && authority.authorityRef && authority.evidenceHash && isApprovalResolverResultAccepted(authority, {now: new Date().toISOString()}), 'Host authority must resolve an approved identity and this exact review basis');
      for (const field of ['approvedBy', 'authorityRef', 'evidenceHash']) requireValue(typeof authority[field] === 'string' && authority[field].trim() && authority[field].length <= 512, 'Host authority identity and evidence references must be bounded strings');
      // Persist the approval contract, not arbitrary resolver transport metadata.
      authority = {...summarizeApprovalResolverResult(authority), scope: {reviewBasisDigest: domain.basisDigest}};
      current();
    }
    const summary = action === 'approve' ? (authority ? 'Plan review recorded with host-resolved authority; apply through the existing governance workflow' : 'Plan approval recommended; human authority remains unresolved and application is not authorized') : action === 'request-changes' ? 'Correction requested; regenerate the plan and obtain a new review' : action === 'decline' ? 'Plan declined; application is not authorized' : 'Could not confirm; application is not authorized';
    const receipt = {schemaVersion: 1, id: domain.id, intent, authority, decisionKind: authority ? 'host-resolved-approval' : 'host-observed-operator-interaction', recordedAt: new Date().toISOString(), expiresAt: domain.expiresAt, summary};
    fs.writeFileSync(receiptPath, JSON.stringify({receipt, signature: sign(host, receipt)}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    return {reference: `veritas-review:${domain.id}`, summary};
  }};
}


/** Domain producer for the native Flow Agents kit review host. */
export async function prepareKitReview({input, host = {}}) {
  const fields = ['rootDir', 'planPath', 'hostRoot', 'expiresAt'];
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Review input must be an object');
  requireValue(Object.keys(input).every(name => fields.includes(name)), 'Unsupported governance review input; authority comes only from the trusted host');
  for (const name of fields) requireValue(typeof input[name] === 'string' && input[name].trim() && input[name].length <= 4096, `Review requires a bounded ${name}`);
  requireValue(host && typeof host === 'object' && Object.keys(host).every(name => name === 'resolveAuthority'), 'Unsupported trusted review host context');
  requireValue(host.resolveAuthority === undefined || typeof host.resolveAuthority === 'function', 'Host authority resolver must be a function');
  const created = await createGovernanceSurveyReview(input);
  return governanceReviewProducer({hostRoot: input.hostRoot, sessionPath: created.sessionFile, resolveAuthority: host.resolveAuthority});
}

/** Compatibility transport for existing standalone consumers. New hosts use
 * prepareKitReview through Flow Agents rather than kit-specific servers.
 */
export async function serveGovernanceSurveyReview({hostRoot, sessionPath, port = 0, resolveAuthority}) {
  const producer = await governanceReviewProducer({hostRoot, sessionPath, resolveAuthority});
  const {startReviewConsoleServer} = await import('@kontourai/survey/review-console');
  return startReviewConsoleServer({sessionPath: producer.sessionPath, port, producerApply: {binding: producer.binding, apply: producer.apply}});
}
