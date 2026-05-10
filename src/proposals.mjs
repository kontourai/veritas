import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadAdapterConfig, loadPolicyPack } from './load.mjs';
import { resolveVeritasPaths } from './report.mjs';
import { createAttestation } from './attestations.mjs';

export const PROPOSAL_STATUS = {
  proposed: 'proposed',
  accepted: 'accepted',
  rejected: 'rejected',
};

function proposalsDir(rootDir) {
  return resolve(rootDir, '.veritas/proposals');
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function readHistory(rootDir) {
  const path = resolve(rootDir, '.veritas/evals/history.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function proposalPath(rootDir, id) {
  return resolve(proposalsDir(rootDir), `${safeId(id)}.proposal.json`);
}

export function listProposals({ rootDir, status = 'proposed' } = {}) {
  const dir = proposalsDir(rootDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.proposal.json'))
    .map((file) => JSON.parse(readFileSync(resolve(dir, file), 'utf8')))
    .filter((proposal) => status === 'all' || proposal.status === status)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function loadProposal(rootDir, id) {
  const path = proposalPath(rootDir, id);
  if (!existsSync(path)) throw new Error(`Proposal not found: ${id}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildProposal({ type, target, rationale, evidenceRunIds, diff, now }) {
  const id = `proposal.${safeId(type)}.${safeId(target)}.${digest({ type, target, diff })}`;
  return {
    schemaVersion: 1,
    id,
    type,
    status: PROPOSAL_STATUS.proposed,
    target,
    createdAt: now,
    updatedAt: now,
    rationale,
    evidenceRunIds,
    surface: {
      claimId: `veritas.proposal.${id}`,
      status: 'proposed',
    },
    diff,
  };
}

function uniqueById(proposals) {
  const seen = new Set();
  return proposals.filter((proposal) => {
    if (seen.has(proposal.id)) return false;
    seen.add(proposal.id);
    return true;
  });
}

function proposalCooldownKey(proposal) {
  return `${proposal.type}:${proposal.target}`;
}

function recentRejectedProposalKeys(rootDir, now, cooldownDays) {
  const nowMs = Date.parse(now);
  const cooldownMs = cooldownDays * 86_400_000;
  return new Set(
    listProposals({ rootDir, status: PROPOSAL_STATUS.rejected })
      .filter((proposal) => {
        const updatedMs = Date.parse(proposal.updatedAt ?? proposal.createdAt ?? '');
        return Number.isFinite(updatedMs) && Number.isFinite(nowMs) && nowMs - updatedMs <= cooldownMs;
      })
      .map(proposalCooldownKey),
  );
}

export function generateRuleProposals({
  rootDir,
  policyPackPath,
  adapterPath,
  now = new Date().toISOString(),
  inactiveRunThreshold = 5,
  rejectionCooldownDays = 14,
} = {}) {
  const { policyPackPath: resolvedPolicyPackPath, adapterPath: resolvedAdapterPath } =
    resolveVeritasPaths({ rootDir, policyPackPath, adapterPath }, { rootDir });
  const policyPack = loadPolicyPack(resolvedPolicyPackPath);
  const adapter = loadAdapterConfig(resolvedAdapterPath);
  const history = readHistory(rootDir);
  const proposals = [];

  for (const rule of policyPack.rules ?? []) {
    const ruleRecords = history.filter((record) =>
      (record.policy_results ?? []).some((result) => result.rule_id === rule.id),
    );
    const failedRecords = ruleRecords.filter((record) =>
      (record.policy_results ?? []).some((result) => result.rule_id === rule.id && result.passed === false),
    );
    const overrideRecords = failedRecords.filter((record) =>
      (record.overrides ?? []).some((override) => override.ruleId === rule.id),
    );
    if (failedRecords.length > 0 && overrideRecords.length / failedRecords.length > 0.4) {
      proposals.push(buildProposal({
        type: 'rule-enforcement-relaxation',
        target: rule.id,
        now,
        evidenceRunIds: overrideRecords.map((record) => record.run_id),
        rationale: `Rule ${rule.id} failed ${failedRecords.length} time(s) and was overridden ${overrideRecords.length} time(s).`,
        diff: {
          policyPackPath: relative(rootDir, resolvedPolicyPackPath).replaceAll('\\', '/'),
          ruleId: rule.id,
          changes: {
            enforcement: 'lint',
            stage: rule.stage === 'block' ? 'warn' : rule.stage,
          },
        },
      }));
    }

    const warnFailures = failedRecords.filter((record) =>
      (record.policy_results ?? []).some((result) => result.rule_id === rule.id && result.stage === 'warn') &&
      record.required_followup === false,
    );
    if (warnFailures.length > 0) {
      proposals.push(buildProposal({
        type: 'rule-stage-downgrade',
        target: rule.id,
        now,
        evidenceRunIds: warnFailures.map((record) => record.run_id),
        rationale: `Warn rule ${rule.id} failed without follow-up edits in ${warnFailures.length} eval(s).`,
        diff: {
          policyPackPath: relative(rootDir, resolvedPolicyPackPath).replaceAll('\\', '/'),
          ruleId: rule.id,
          changes: { stage: 'advise' },
        },
      }));
    }

    if (history.length >= inactiveRunThreshold && failedRecords.length === 0) {
      proposals.push(buildProposal({
        type: 'rule-retirement',
        target: rule.id,
        now,
        evidenceRunIds: history.slice(-inactiveRunThreshold).map((record) => record.run_id),
        rationale: `Rule ${rule.id} did not fail in the last ${inactiveRunThreshold} eval(s).`,
        diff: {
          policyPackPath: relative(rootDir, resolvedPolicyPackPath).replaceAll('\\', '/'),
          ruleId: rule.id,
          changes: { x_status: 'deprecated' },
        },
      }));
    }
  }

  const unmatchedCounts = new Map();
  for (const record of history) {
    for (const file of record.unresolved_files ?? []) {
      unmatchedCounts.set(file, (unmatchedCounts.get(file) ?? 0) + 1);
    }
  }
  for (const [file, count] of unmatchedCounts.entries()) {
    if (count < 2) continue;
    proposals.push(buildProposal({
      type: 'surface-node-addition',
      target: file,
      now,
      evidenceRunIds: history.filter((record) => (record.unresolved_files ?? []).includes(file)).map((record) => record.run_id),
      rationale: `Path ${file} matched no surface node in ${count} eval(s).`,
      diff: {
        adapterPath: relative(rootDir, resolvedAdapterPath).replaceAll('\\', '/'),
        node: {
          id: `proposed.${safeId(file)}`,
          label: file,
          kind: 'product-surface',
          patterns: [file],
          owners: ['shared'],
          boundary: 'advisory',
        },
      },
    }));
  }

  const rejectedKeys = recentRejectedProposalKeys(rootDir, now, rejectionCooldownDays);
  return uniqueById(proposals).filter((proposal) => !rejectedKeys.has(proposalCooldownKey(proposal)));
}

export function writeGeneratedProposals({ rootDir, proposals, force = false } = {}) {
  const dir = proposalsDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const proposal of proposals) {
    const path = proposalPath(rootDir, proposal.id);
    if (existsSync(path) && !force) continue;
    writeFileSync(path, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
    written.push(relative(rootDir, path).replaceAll('\\', '/'));
  }
  return written;
}

export function generateAndWriteProposals(options = {}, defaults = {}) {
  const rootDir = resolve(options.rootDir ?? defaults.rootDir ?? process.cwd());
  const proposals = generateRuleProposals({ ...options, rootDir });
  const written = options.write === false
    ? []
    : writeGeneratedProposals({ rootDir, proposals, force: options.force ?? false });
  return { rootDir, proposals, written };
}

export function applyProposal({ rootDir, id, actor, accept, reject, message = '' } = {}) {
  const proposal = loadProposal(rootDir, id);
  if (proposal.status !== PROPOSAL_STATUS.proposed) {
    throw new Error(`Proposal ${id} is already ${proposal.status}`);
  }
  if (accept === reject) throw new Error('Choose exactly one of --accept or --reject');

  const updated = {
    ...proposal,
    status: accept ? PROPOSAL_STATUS.accepted : PROPOSAL_STATUS.rejected,
    updatedAt: new Date().toISOString(),
    decision: {
      actor,
      message,
    },
  };

  if (accept && proposal.diff?.ruleId && proposal.diff?.policyPackPath) {
    const policyPackPath = resolve(rootDir, proposal.diff.policyPackPath);
    const policyPack = JSON.parse(readFileSync(policyPackPath, 'utf8'));
    const rule = (policyPack.rules ?? []).find((item) => item.id === proposal.diff.ruleId);
    if (!rule) throw new Error(`Rule not found for proposal ${id}: ${proposal.diff.ruleId}`);
    Object.assign(rule, proposal.diff.changes ?? {});
    writeFileSync(policyPackPath, `${JSON.stringify(policyPack, null, 2)}\n`, 'utf8');
    updated.attestation = createAttestation({
      rootDir,
      kind: 'proposal-acceptance',
      actor,
      notes: message || `Accepted proposal ${id}`,
    }).attestation;
  }

  const path = proposalPath(rootDir, id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}
