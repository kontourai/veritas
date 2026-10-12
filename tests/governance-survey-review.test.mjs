import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildReviewSessionEvents} from '@kontourai/survey/review-workbench';
import {createGovernanceSurveyReview, serveGovernanceSurveyReview} from '../src/governance-review.mjs';

async function fixture(t, action = 'approve', options = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-survey-')), rootDir = path.join(base, 'repo'), hostRoot = path.join(base, 'host');
  fs.mkdirSync(rootDir); fs.mkdirSync(hostRoot, {mode: 0o700});
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const env = {...process.env}; for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  const git = args => execFileSync('git', args, {cwd: rootDir, env, stdio: 'pipe'});
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  fs.writeFileSync(path.join(rootDir, 'README.md'), 'Controlled repository\n'); git(['add', '.']); git(['commit', '-m', 'fixture']);
  execFileSync(process.execPath, [path.resolve('bin/veritas.mjs'), 'init', '--explore', '--root', rootDir, '--output', '.veritas/init-plans/review.json'], {env, stdio: 'pipe'});
  const planPath = path.join(rootDir, '.veritas/init-plans/review.json');
  const review = await createGovernanceSurveyReview({rootDir, hostRoot, planPath, expiresAt: options.expiresAt ?? new Date(Date.now() + 60000).toISOString()});
  const server = await serveGovernanceSurveyReview({hostRoot, sessionPath: review.sessionFile, ...options}); t.after(() => server.close());
  const content = JSON.parse(fs.readFileSync(review.sessionFile));
  const snapshot = {...content.snapshot, decisionsByItemName: Object.fromEntries(content.snapshot.items.map(item => [item.metadata.name, item.metadata.name === 'workflow-decision' ? action === 'could-not-confirm' ? action : 'select-proposed' : 'accept-proposed'])), selectedCandidateIdsByItemName: {'workflow-decision': action}, notesByItemName: {'workflow-decision': action === 'request-changes' || action === 'could-not-confirm' ? 'Resolve the owner question' : ''}};
  const events = buildReviewSessionEvents(snapshot, content.session.metadata.name).filter(event => event.spec.eventType.startsWith('decision-') || event.spec.eventType === 'note-changed');
  const get = async () => (await fetch(server.url + 'api/session')).json();
  const post = (route, body) => fetch(server.url + 'api/' + route, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const saved = await post('events', {baseRevision: (await get()).revision, events}); assert.equal(saved.status, 200, JSON.stringify(await saved.json()));
  return {rootDir, hostRoot, planPath, ...review, content, apply: async () => post('apply', {baseRevision: (await get()).revision}), receipt: () => JSON.parse(fs.readFileSync(path.join(hostRoot, content.session.metadata.name + '.decision.json'))).receipt};
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
  const f = await fixture(t, 'approve', {expiresAt: new Date(Date.now() + 3000).toISOString()});
  await new Promise(resolve => setTimeout(resolve, 3100));
  assert.equal((await f.apply()).status, 409);
  assert.equal(fs.existsSync(path.join(f.hostRoot, f.content.session.metadata.name + '.decision.json')), false);
});
