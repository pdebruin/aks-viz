import {
  NodeJson,
  NodeSelectorRequirement,
  NodeSelectorTerm,
  PodSpecJson,
  Taint,
  Toleration,
} from './types';

function matchRequirement(value: string | undefined, req: NodeSelectorRequirement): boolean {
  const values = req.values ?? [];
  switch (req.operator) {
    case 'In':
      return value !== undefined && values.includes(value);
    case 'NotIn':
      return value === undefined || !values.includes(value);
    case 'Exists':
      return value !== undefined;
    case 'DoesNotExist':
      return value === undefined;
    case 'Gt':
    case 'Lt': {
      if (value === undefined || values.length !== 1) return false;
      const a = Number.parseInt(value, 10);
      const b = Number.parseInt(values[0], 10);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return req.operator === 'Gt' ? a > b : a < b;
    }
    default:
      return false;
  }
}

/** A term matches when all its requirements match. An empty term matches nothing (Kubernetes semantics). */
export function matchNodeSelectorTerm(node: NodeJson, term: NodeSelectorTerm): boolean {
  const exprs = term.matchExpressions ?? [];
  const fields = term.matchFields ?? [];
  if (exprs.length === 0 && fields.length === 0) return false;
  const labels = node.metadata.labels ?? {};
  const labelsOk = exprs.every(r => matchRequirement(labels[r.key], r));
  const fieldsOk = fields.every(r =>
    matchRequirement(r.key === 'metadata.name' ? node.metadata.name : undefined, r)
  );
  return labelsOk && fieldsOk;
}

/** spec.nodeSelector (all pairs) AND required node affinity (any term). */
export function matchesNodeSelectorAndAffinity(node: NodeJson, spec: PodSpecJson): boolean {
  const labels = node.metadata.labels ?? {};
  for (const [k, v] of Object.entries(spec.nodeSelector ?? {})) {
    if (labels[k] !== v) return false;
  }
  const terms =
    spec.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms;
  if (terms && terms.length > 0) {
    return terms.some(t => matchNodeSelectorTerm(node, t));
  }
  return true;
}

export function toleratesTaint(toleration: Toleration, taint: Taint): boolean {
  if (toleration.effect && toleration.effect !== taint.effect) return false;
  const op = toleration.operator ?? 'Equal';
  if (!toleration.key) return op === 'Exists';
  if (toleration.key !== taint.key) return false;
  if (op === 'Exists') return true;
  return (toleration.value ?? '') === (taint.value ?? '');
}

/** Only NoSchedule and NoExecute taints block placement; PreferNoSchedule is a soft preference. */
export function untoleratedTaints(node: NodeJson, tolerations: Toleration[]): Taint[] {
  return (node.spec?.taints ?? []).filter(
    t =>
      (t.effect === 'NoSchedule' || t.effect === 'NoExecute') &&
      !tolerations.some(tol => toleratesTaint(tol, t))
  );
}

/**
 * Tolerations the DaemonSet controller adds to its pods
 * (kubernetes.io, "DaemonSet", section "Taints and tolerations").
 */
export function daemonSetDefaultTolerations(spec: PodSpecJson): Toleration[] {
  const t: Toleration[] = [
    { key: 'node.kubernetes.io/not-ready', operator: 'Exists', effect: 'NoExecute' },
    { key: 'node.kubernetes.io/unreachable', operator: 'Exists', effect: 'NoExecute' },
    { key: 'node.kubernetes.io/disk-pressure', operator: 'Exists', effect: 'NoSchedule' },
    { key: 'node.kubernetes.io/memory-pressure', operator: 'Exists', effect: 'NoSchedule' },
    { key: 'node.kubernetes.io/pid-pressure', operator: 'Exists', effect: 'NoSchedule' },
    { key: 'node.kubernetes.io/unschedulable', operator: 'Exists', effect: 'NoSchedule' },
  ];
  if (spec.hostNetwork) {
    t.push({
      key: 'node.kubernetes.io/network-unavailable',
      operator: 'Exists',
      effect: 'NoSchedule',
    });
  }
  return t;
}

/** Whether a DaemonSet pod template is expected to run on the node (selector, affinity, taints). */
export function daemonSetShouldRunOnNode(node: NodeJson, template: PodSpecJson): boolean {
  if (!matchesNodeSelectorAndAffinity(node, template)) return false;
  const tolerations = [...(template.tolerations ?? []), ...daemonSetDefaultTolerations(template)];
  return untoleratedTaints(node, tolerations).length === 0;
}
