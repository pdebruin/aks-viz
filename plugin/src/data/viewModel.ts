import { classifyPod, daemonSetOwner, PodClass } from './classify';
import { DaemonSetCoverage, daemonSetCoverage } from './daemonSets';
import { failedNamespaces, ListState } from './listState';
import {
  listNodePools,
  nodeModeOf,
  NodePoolInfo,
  nodePoolOf,
  PoolMode,
  selectDefaultPool,
} from './nodePools';
import { isTerminalPod, podEffectiveRequests } from './podRequests';
import { addCpuMem, cpuMemFromResources, subCpuMem, ZERO } from './quantity';
import { CpuMem, DaemonSetJson, NodeJson, PodJson, Taint } from './types';

export interface PodView {
  name: string;
  namespace: string;
  uid?: string;
  nodeName: string;
  phase: string;
  podClass: PodClass;
  ownerKind?: string;
  ownerName?: string;
  /** Set when the pod is owned by a DaemonSet. */
  daemonSetName?: string;
  terminating: boolean;
  /** Effective requests; counted in the node sum unless the pod is Succeeded or Failed. */
  requests: CpuMem;
  countsTowardRequests: boolean;
}

export interface NodeView {
  name: string;
  poolId: string;
  poolName: string;
  mode: PoolMode;
  ready: boolean;
  unschedulable: boolean;
  taints: Taint[];
  allocatable: CpuMem;
  /** False when the pod list failed: requests are unknown and the pod lists are empty, not zero. */
  podsKnown: boolean;
  /** Null when podsKnown is false. */
  requested: CpuMem | null;
  /** allocatable minus requested; can be negative only if data is inconsistent. Null when podsKnown is false. */
  unallocated: CpuMem | null;
  systemPods: PodView[];
  userPods: PodView[];
}

export interface NodePoolView {
  pools: NodePoolInfo[];
  defaultPoolId?: string;
  /** The pool actually shown: the requested one if it exists, else the default. */
  selectedPoolId?: string;
  nodes: NodeView[];
  /** Null when coverage is unknown: the DaemonSet list or the pod list failed. */
  daemonSets: DaemonSetCoverage[] | null;
}

/** Groups pods by spec.nodeName. Pods without a nodeName (unscheduled) are skipped. */
export function groupPodsByNode(pods: PodJson[]): Map<string, PodJson[]> {
  const map = new Map<string, PodJson[]>();
  for (const pod of pods) {
    const node = pod.spec?.nodeName;
    if (!node) continue;
    if (!map.has(node)) map.set(node, []);
    map.get(node)!.push(pod);
  }
  return map;
}

export function toPodView(pod: PodJson): PodView {
  const owner =
    (pod.metadata.ownerReferences ?? []).find(o => o.controller) ??
    pod.metadata.ownerReferences?.[0];
  const counts = !isTerminalPod(pod);
  return {
    name: pod.metadata.name,
    namespace: pod.metadata.namespace ?? '',
    uid: pod.metadata.uid,
    nodeName: pod.spec?.nodeName ?? '',
    phase: pod.status?.phase ?? 'Unknown',
    podClass: classifyPod(pod),
    ownerKind: owner?.kind,
    ownerName: owner?.name,
    daemonSetName: daemonSetOwner(pod)?.name,
    terminating: !!pod.metadata.deletionTimestamp,
    requests: podEffectiveRequests(pod),
    countsTowardRequests: counts,
  };
}

function byNamespaceThenName(a: PodView, b: PodView) {
  return a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
}

/** podsOnNode null means the pod list failed: requests are reported as unknown, not as zero. */
export function toNodeView(node: NodeJson, podsOnNode: PodJson[] | null): NodeView {
  const pool = nodePoolOf(node);
  const views = (podsOnNode ?? []).map(toPodView);
  const requested = views
    .filter(v => v.countsTowardRequests)
    .reduce((acc, v) => addCpuMem(acc, v.requests), ZERO);
  const allocatable = cpuMemFromResources(node.status?.allocatable);
  return {
    name: node.metadata.name,
    poolId: pool.id,
    poolName: pool.name,
    mode: nodeModeOf(node),
    ready: (node.status?.conditions ?? []).some(c => c.type === 'Ready' && c.status === 'True'),
    unschedulable: !!node.spec?.unschedulable,
    taints: node.spec?.taints ?? [],
    allocatable,
    podsKnown: podsOnNode !== null,
    requested: podsOnNode ? requested : null,
    unallocated: podsOnNode ? subCpuMem(allocatable, requested) : null,
    systemPods: views.filter(v => v.podClass === 'system').sort(byNamespaceThenName),
    userPods: views.filter(v => v.podClass === 'user').sort(byNamespaceThenName),
  };
}

/**
 * Builds everything the node view needs for one pool. Pure: same input, same output.
 * selectedPoolId falls back to the default pool when absent or unknown.
 * pods or daemonSets null means that list failed: derived values (requests, coverage) are null.
 * podsState, when the pod list is partial, drops DaemonSets in namespaces whose pods could not be
 * listed, so a permission gap is not reported as a missing node agent.
 */
export function buildNodePoolView(
  nodes: NodeJson[],
  pods: PodJson[] | null,
  daemonSets: DaemonSetJson[] | null,
  selectedPoolId?: string,
  podsState?: ListState
): NodePoolView {
  const pools = listNodePools(nodes);
  const defaultPoolId = selectDefaultPool(pools)?.id;
  const selected = pools.some(p => p.id === selectedPoolId) ? selectedPoolId : defaultPoolId;
  const poolNodes = nodes
    .filter(n => nodePoolOf(n).id === selected)
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  const byNode = pods ? groupPodsByNode(pods) : null;
  const podsDenied = new Set(podsState ? failedNamespaces(podsState) : []);
  return {
    pools,
    defaultPoolId,
    selectedPoolId: selected,
    nodes: poolNodes.map(n => toNodeView(n, byNode ? byNode.get(n.metadata.name) ?? [] : null)),
    daemonSets:
      pods && daemonSets
        ? daemonSetCoverage(
            daemonSets.filter(d => !podsDenied.has(d.metadata.namespace ?? '')),
            poolNodes,
            pods
          )
        : null,
  };
}
