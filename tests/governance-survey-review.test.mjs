import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {buildReviewSessionEvents, renderReviewWorkbenchHtml} from '@kontourai/survey/review-workbench';
import {startReviewConsoleServer} from '@kontourai/survey/review-console';
import {createGovernanceSurveyReview, serveGovernanceSurveyReview, prepareKitReview} from '../src/governance-review.mjs';
import { tempDir } from './temp-dir.mjs';

async function fixture(t, action = 'approve', options = {}) {
  const base = tempDir(t, 'veritas-survey-'), rootDir = path.join(base, 'repo'), hostRoot = path.join(base, 'host');
  fs.mkdirSync(rootDir); fs.mkdirSync(hostRoot, {mode: 0o700});
  const env = {...process.env}; for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  const git = args => execFileSync('git', args, {cwd: rootDir, env, stdio: 'pipe'});
  git(['init']); git(['config', 'maintenance.auto', 'false']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  fs.writeFileSync(path.join(rootDir, 'README.md'), 'Controlled repository\n'); git(['add', '.']); git(['commit', '-m', 'fixture']);
  execFileSync(process.execPath, [path.resolve('bin/veritas.mjs'), 'init', '--explore', '--root', rootDir, '--output', '.veritas/init-plans/review.json'], {env, stdio: 'pipe'});
  const planPath = path.join(rootDir, '.veritas/init-plans/review.json');
  const input = {rootDir, hostRoot, planPath, expiresAt: options.expiresAt ?? new Date(Date.now() + 60000).toISOString()};
  const producer = await prepareKitReview({input, host: options.resolveAuthority ? {resolveAuthority: options.resolveAuthority} : {}});
  const contentBeforeServing = JSON.parse(fs.readFileSync(producer.sessionPath));
  if (options.legacy) {
    delete contentBeforeServing.veritas.domain.presentation;
    contentBeforeServing.veritas.signature = createHmac('sha256', fs.readFileSync(path.join(hostRoot, 'review-key'))).update(JSON.stringify(contentBeforeServing.veritas.domain)).digest('hex');
    fs.writeFileSync(producer.sessionPath, JSON.stringify(contentBeforeServing));
  }
  const review = {sessionFile: producer.sessionPath, basisDigest: contentBeforeServing.veritas.domain.basisDigest};
  const server = options.compatibility
    ? await serveGovernanceSurveyReview({hostRoot, sessionPath: review.sessionFile, ...options})
    : await startReviewConsoleServer({sessionPath: producer.sessionPath, presentation: producer.presentation, producerApply: {binding: producer.binding, apply: producer.apply}});
  t.after(() => server.close());
  const content = JSON.parse(fs.readFileSync(review.sessionFile));
  const snapshot = {...content.snapshot, decisionsByItemName: Object.fromEntries(content.snapshot.items.map(item => [item.metadata.name, item.metadata.name === 'workflow-decision' ? action === 'could-not-confirm' ? action : 'select-proposed' : 'accept-proposed'])), selectedCandidateIdsByItemName: {'workflow-decision': action}, notesByItemName: {'workflow-decision': action === 'request-changes' || action === 'could-not-confirm' ? 'Resolve the owner question' : ''}};
  const events = buildReviewSessionEvents(snapshot, content.session.metadata.name).filter(event => event.spec.eventType.startsWith('decision-') || event.spec.eventType === 'note-changed');
  const get = async () => (await fetch(server.url + 'api/session')).json();
  const post = (route, body) => fetch(server.url + 'api/' + route, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const saved = await post('events', {baseRevision: (await get()).revision, events}); assert.equal(saved.status, 200, JSON.stringify(await saved.json()));
  return {rootDir, hostRoot, planPath, ...review, content, producer, get, apply: async () => post('apply', {baseRevision: (await get()).revision}), receipt: () => JSON.parse(fs.readFileSync(path.join(hostRoot, content.session.metadata.name + '.decision.json'))).receipt};
}

for (const action of ['approve', 'decline', 'request-changes', 'could-not-confirm']) test(`Survey retains distinct ${action} without applying protected standards`, async t => {
  const f = await fixture(t, action); const result = await f.apply(); assert.equal(result.status, 200, JSON.stringify(await result.json()));
  assert.equal(f.receipt().intent.action, action); assert.equal(f.receipt().decisionKind, 'host-observed-operator-interaction'); assert.equal(f.receipt().authority, null);
  assert.equal(fs.existsSync(path.join(f.rootDir, '.veritas/repo-map.json')), false); assert.equal((await f.apply()).status, 409);
});

for (const kind of ['plan', 'source', 'actor', 'integrity']) test(`Survey rejects ${kind} drift before recording a governance disposition`, async t => {
  const f = await fixture(t);
  if (kind === 'plan') fs.appendFileSync(f.planPath, '\n');
  if (kind === 'source') fs.writeFileSync(path.join(f.rootDir, 'README.md'), 'Different actual source bytes');
  if (kind === 'integrity') fs.writeFileSync(path.join(f.rootDir, '.kontourai/veritas/init-plan-integrity', fs.readdirSync(path.join(f.rootDir, '.kontourai/veritas/init-plan-integrity'))[0]), '{}');
  if (kind === 'actor') { const content = JSON.parse(fs.readFileSync(f.sessionFile)); content.snapshot.actorId = 'human'; fs.writeFileSync(f.sessionFile, JSON.stringify(content)); }
  assert.equal((await f.apply()).status, 409); assert.equal(fs.existsSync(path.join(f.hostRoot, f.content.session.metadata.name + '.decision.json')), false);
});

test('only a server-configured resolver can bind authority to the exact review basis', async t => {
  let request;
  const f = await fixture(t, 'approve', {resolveAuthority: async input => { request = input; return {status: 'approved', approvedBy: 'test-host-resolved-identity', authorityRef: 'controlled-host-fixture', evidenceHash: 'sha256:fixture', scope: {reviewBasisDigest: input.basisDigest}}; }});
  assert.equal((await f.apply()).status, 200); assert.equal(request.basisDigest, f.basisDigest); assert.equal(f.receipt().decisionKind, 'host-resolved-approval');
  assert.equal(fs.existsSync(path.join(f.rootDir, '.veritas/repo-map.json')), false);
});

test('foreign or unavailable authority cannot authorize the plan', async t => {
  const f = await fixture(t, 'approve', {resolveAuthority: async () => ({status: 'approved', approvedBy: 'caller-name', authorityRef: 'fixture', evidenceHash: 'fixture', scope: {reviewBasisDigest: 'foreign'}})});
  assert.equal((await f.apply()).status, 409);
});

test('source drift during asynchronous host authority resolution refuses before receipt publication', async t => {
  const f = await fixture(t, 'approve', {resolveAuthority: async input => {
    fs.writeFileSync(path.join(input.rootDir, 'README.md'), 'Changed while resolving authority');
    return {status: 'approved', approvedBy: 'controlled-identity', authorityRef: 'fixture', evidenceHash: 'fixture', scope: {reviewBasisDigest: input.basisDigest}};
  }});
  assert.equal((await f.apply()).status, 409);
  assert.equal(fs.existsSync(path.join(f.hostRoot, f.content.session.metadata.name + '.decision.json')), false);
});

test('an expired host authority result cannot authorize the exact plan', async t => {
  const f = await fixture(t, 'approve', {resolveAuthority: async input => ({status: 'approved', approvedBy: 'controlled-identity', authorityRef: 'fixture', evidenceHash: 'fixture', expiresAt: new Date(Date.now() - 1000).toISOString(), scope: {reviewBasisDigest: input.basisDigest}})});
  assert.equal((await f.apply()).status, 409);
});

test('canonical receipt recovers presentation-store loss without a second authority resolution', async t => {
  let calls = 0;
  const f = await fixture(t, 'approve', {resolveAuthority: async input => { calls++; return {status: 'approved', approvedBy: 'controlled-identity', authorityRef: 'fixture', evidenceHash: 'fixture', scope: {reviewBasisDigest: input.basisDigest}}; }});
  assert.equal((await f.apply()).status, 200); const content = JSON.parse(fs.readFileSync(f.sessionFile)); delete content.producerApplication; fs.writeFileSync(f.sessionFile, JSON.stringify(content));
  assert.equal((await f.apply()).status, 200); assert.equal(calls, 1);
});


test('the original review deadline expires without renewal or a decision', async t => {
  const now = Date.now();
  t.mock.timers.enable({apis: ['Date'], now});
  const f = await fixture(t, 'approve', {expiresAt: new Date(now + 3000).toISOString()});
  t.mock.timers.setTime(now + 3100);
  assert.equal((await f.apply()).status, 409);
  assert.equal(fs.existsSync(path.join(f.hostRoot, f.content.session.metadata.name + '.decision.json')), false);
});


test('standalone compatibility server uses the same admitted producer disposition', async t => {
  const f = await fixture(t, 'approve', {compatibility: true});
  assert.equal((await f.apply()).status, 200);
  assert.equal(f.receipt().decisionKind, 'host-observed-operator-interaction');
});

test('request JSON cannot inject host approval or arbitrary review fields', async () => {
  await assert.rejects(() => prepareKitReview({input: {rootDir: '/tmp', planPath: 'plan', hostRoot: '/tmp', expiresAt: 'date', resolveAuthority: {approvedBy: 'human'}}}), /authority comes only/);
  await assert.rejects(() => prepareKitReview({input: {rootDir: '/tmp', planPath: 'plan', hostRoot: '/tmp', expiresAt: 'date'}, host: {resolveAuthority: {status: 'approved'}}}), /must be a function/);
});

for (const compatibility of [false, true]) test(`sealed plan presentation reaches ${compatibility ? 'standalone' : 'native'} review without changing canonical candidates`, async t => {
  const f = await fixture(t, 'request-changes', {compatibility});
  const presentation = (await f.get()).presentation;
  assert.equal(presentation.title, 'Standards plan review');
  assert.deepEqual(presentation, f.content.veritas.domain.presentation);
  assert.match(presentation.context, /Plan: \.veritas\/init-plans\/review.json/);
  assert.match(presentation.context, new RegExp(f.content.veritas.domain.expiresAt));
  assert.match(presentation.context, /does not apply standards or create an attestation/);
  for (const line of JSON.parse(fs.readFileSync(f.planPath)).reasoning_summary) assert.ok(presentation.context.includes(line));
  assert.deepEqual(presentation.items['workflow-decision'], {title: 'Decision', kind: 'choice', candidateLabels: {approve: 'Approve', 'request-changes': 'Request changes', decline: 'Decline'}});
  for (const item of f.content.snapshot.items.filter(item => item.metadata.name !== 'workflow-decision')) {
    assert.equal(presentation.items[item.metadata.name].kind, 'acknowledgment');
    assert.equal(presentation.items[item.metadata.name].title, item.metadata.name === 'plan-context' ? 'Reasoning and owner questions' : path.basename(item.spec.target));
  }
  const html = renderReviewWorkbenchHtml(f.content.snapshot, undefined, {queuePresentation: presentation, hideApply: true});
  assert.match(html, /Mark reviewed/); assert.match(html, /aria-label="Request changes"/); assert.doesNotMatch(html, /Conflict: 3 values/);
  assert.equal((await f.apply()).status, 200);
  assert.match(f.receipt().summary, /Correction request recorded/);
  const selected = JSON.parse(fs.readFileSync(f.sessionFile)).events.find(event => event.spec.candidateId === 'request-changes');
  assert.equal(selected.spec.data.workbenchDecision, 'select-proposed');
  assert.equal(fs.existsSync(path.join(f.rootDir, '.veritas/repo-map.json')), false);
});

for (const field of ['context', 'action-label']) test(`changed retained ${field} cannot record a governance disposition`, async t => {
  const f = await fixture(t);
  const content = JSON.parse(fs.readFileSync(f.sessionFile));
  if (field === 'context') content.veritas.domain.presentation.context = 'Fabricated findings cleared';
  else content.veritas.domain.presentation.items['workflow-decision'].candidateLabels.approve = 'Skip authority';
  fs.writeFileSync(f.sessionFile, JSON.stringify(content));
  assert.equal((await f.apply()).status, 409);
  assert.equal(fs.existsSync(path.join(f.hostRoot, f.content.session.metadata.name + '.decision.json')), false);
});

test('an already sealed legacy session without display hints still records its original disposition', async t => {
  const f = await fixture(t, 'decline', {compatibility: true, legacy: true});
  assert.equal((await f.get()).presentation, undefined);
  assert.equal((await f.apply()).status, 200);
  assert.equal(f.receipt().intent.action, 'decline');
});
