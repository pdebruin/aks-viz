import { PodJson } from './types';

export const SYSTEM_NAMESPACES: readonly string[] = [
  'kube-system',
  'kube-node-lease',
  'kube-public',
  'gatekeeper-system',
  'calico-system',
  'tigera-operator',
  'app-routing-system',
];

export const SYSTEM_NAMESPACE_PREFIXES: readonly string[] = ['aks-', 'kube-'];

export type PodClass = 'system' | 'user';

/**
 * Pragmatic system vs user split (v1):
 * a pod is "system" if its namespace is in SYSTEM_NAMESPACES, starts with a prefix in
 * SYSTEM_NAMESPACE_PREFIXES, or the pod is owned by a DaemonSet (node-level agents).
 * Everything else is "user". A user-deployed DaemonSet therefore counts as system; that is intended,
 * because it behaves like per-node infrastructure in the view.
 */
export function classifyPod(pod: PodJson): PodClass {
  const ns = pod.metadata.namespace ?? '';
  if (SYSTEM_NAMESPACES.includes(ns)) return 'system';
  if (SYSTEM_NAMESPACE_PREFIXES.some(p => ns.startsWith(p))) return 'system';
  if ((pod.metadata.ownerReferences ?? []).some(o => o.kind === 'DaemonSet')) return 'system';
  return 'user';
}

export function daemonSetOwner(pod: PodJson): { name: string; uid?: string } | undefined {
  const ref = (pod.metadata.ownerReferences ?? []).find(o => o.kind === 'DaemonSet');
  return ref ? { name: ref.name, uid: ref.uid } : undefined;
}
