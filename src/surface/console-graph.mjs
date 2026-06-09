export function buildConsoleGraph({ claims, evidence, events, policiesById, transparencyGaps }) {
  const nodes = new Map();
  const edges = [];
  const addNode = (node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge) => {
    edges.push(edge);
  };

  for (const claim of claims) {
    addNode({
      id: claim.id,
      kind: 'claim',
      label: claim.fieldOrBehavior,
      claimType: claim.claimType,
    });
    addNode({
      id: `subject:${claim.subjectType}:${claim.subjectId}`,
      kind: 'subject',
      label: claim.subjectId,
      subjectType: claim.subjectType,
    });
    addEdge({ from: claim.id, to: `subject:${claim.subjectType}:${claim.subjectId}`, kind: 'about' });
    if (claim.verificationPolicyId) {
      addNode({
        id: `policy:${claim.verificationPolicyId}`,
        kind: 'policy',
        label: claim.verificationPolicyId,
        claimType: policiesById.get(claim.verificationPolicyId)?.claimType ?? null,
      });
      addEdge({ from: `policy:${claim.verificationPolicyId}`, to: claim.id, kind: 'validates' });
    }
    for (const parentId of claim.derivedFrom ?? []) {
      addEdge({ from: claim.id, to: parentId, kind: 'derived-from' });
    }
  }

  for (const item of evidence) {
    addNode({ id: `evidence:${item.id}`, kind: 'evidence', label: item.evidenceType, method: item.method });
    addEdge({ from: `evidence:${item.id}`, to: item.claimId, kind: 'supports' });
  }

  for (const event of events) {
    addNode({ id: `event:${event.id}`, kind: 'event', label: event.status, method: event.method });
    addEdge({ from: `event:${event.id}`, to: event.claimId, kind: 'updates-status' });
  }

  for (const transparencyGap of transparencyGaps) {
    addNode({
      id: `transparency-gap:${transparencyGap.id}`,
      kind: 'transparency-gap',
      label: transparencyGap.type,
      severity: transparencyGap.severity,
    });
    addEdge({ from: `transparency-gap:${transparencyGap.id}`, to: transparencyGap.claimId, kind: 'flags' });
  }

  return {
    nodes: [...nodes.values()],
    edges,
  };
}
