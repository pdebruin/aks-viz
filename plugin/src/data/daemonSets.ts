import { daemonSetOwner } from './classify';
import { isTerminalPod } from './podRequests';
import { daemonSetShouldRunOnNode } from './scheduling';
import { DaemonSetJson, NodeJson, PodJson } from './types';

export interface DaemonSetCoverage {
  namespace: string;
  name: string;
  uid?: string;
  /** Nodes in scope where selector, affinity and taints allow the DaemonSet. */
  eligibleNodes: string[];
  /** Nodes in scope with a non-terminal pod owned by the DaemonSet. */
  runningNodes: string[];
  /** Eligible but no pod: a gap. */
  missingNodes: string[];
  /** Pod present but our evaluation says not eligible (our rule is incomplete, or a label/taint changed). */
  unexpectedNodes: string[];
  /** True when every node in scope runs a pod of this DaemonSet. */
  onEveryNode: boolean;
  /** True when every eligible node in scope runs a pod of this DaemonSet. */
  onEveryEligibleNode: boolean;
  /** Cluster-wide counters from DaemonSet status, for cross-checking. */
  desiredNumberScheduled?: number;
  currentNumberScheduled?: number;
  numberReady?: number;
}

/**
 * Coverage of each DaemonSet over the given nodes (typically the selected pool).
 * DaemonSets that have neither eligible nor running nodes in scope are omitted.
 * Eligibility evaluates nodeSelector, required node affinity, and taints vs template tolerations
 * plus the tolerations the DaemonSet controller adds. It does not evaluate resource fit.
 */
export function daemonSetCoverage(
  daemonSets: DaemonSetJson[],
  nodesInScope: NodeJson[],
  pods: PodJson[]
): DaemonSetCoverage[] {
  const scope = new Set(nodesInScope.map(n => n.metadata.name));
  const runningByDs = new Map<string, Set<string>>();
  for (const pod of pods) {
    const node = pod.spec?.nodeName;
    if (!node || !scope.has(node) || isTerminalPod(pod)) continue;
    const owner = daemonSetOwner(pod);
    if (!owner) continue;
    const key = owner.uid ?? `${pod.metadata.namespace}/${owner.name}`;
    if (!runningByDs.has(key)) runningByDs.set(key, new Set());
    runningByDs.get(key)!.add(node);
  }

  const result: DaemonSetCoverage[] = [];
  for (const ds of daemonSets) {
    const ns = ds.metadata.namespace ?? '';
    const template = ds.spec?.template?.spec ?? {};
    const running =
      (ds.metadata.uid && runningByDs.get(ds.metadata.uid)) ||
      runningByDs.get(`${ns}/${ds.metadata.name}`) ||
      new Set<string>();
    const eligible = nodesInScope
      .filter(n => daemonSetShouldRunOnNode(n, template))
      .map(n => n.metadata.name);
    if (eligible.length === 0 && running.size === 0) continue;
    const eligibleSet = new Set(eligible);
    const runningNodes = [...running].sort();
    const missingNodes = eligible.filter(n => !running.has(n)).sort();
    result.push({
      namespace: ns,
      name: ds.metadata.name,
      uid: ds.metadata.uid,
      eligibleNodes: [...eligible].sort(),
      runningNodes,
      missingNodes,
      unexpectedNodes: runningNodes.filter(n => !eligibleSet.has(n)),
      onEveryNode: nodesInScope.length > 0 && nodesInScope.every(n => running.has(n.metadata.name)),
      onEveryEligibleNode: missingNodes.length === 0,
      desiredNumberScheduled: ds.status?.desiredNumberScheduled,
      currentNumberScheduled: ds.status?.currentNumberScheduled,
      numberReady: ds.status?.numberReady,
    });
  }
  return result.sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
  );
}
