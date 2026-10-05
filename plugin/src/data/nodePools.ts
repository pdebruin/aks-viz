import { NodeJson } from './types';

export const LABEL_AGENTPOOL = 'kubernetes.azure.com/agentpool';
export const LABEL_NAP_NODEPOOL = 'karpenter.sh/nodepool';
export const LABEL_MODE = 'kubernetes.azure.com/mode';

export type PoolSource = 'nap' | 'agentpool' | 'unknown';
export type PoolMode = 'System' | 'User' | 'Unknown';

export interface NodePoolRef {
  /** Stable key, `<source>/<name>`, so a NAP NodePool and an agent pool with the same name stay apart. */
  id: string;
  name: string;
  source: PoolSource;
}

export interface NodePoolInfo extends NodePoolRef {
  /** System if any node in the pool reports mode system (case-insensitive), else User if any reports user. */
  mode: PoolMode;
  nodeNames: string[];
}

export const UNKNOWN_POOL_NAME = '(no pool label)';

/**
 * Pool of a node. karpenter.sh/nodepool wins when non-empty: NAP nodes on AKS also carry
 * kubernetes.azure.com/agentpool with an empty value (observed on my-aks-automatic).
 */
export function nodePoolOf(node: NodeJson): NodePoolRef {
  const labels = node.metadata.labels ?? {};
  const nap = labels[LABEL_NAP_NODEPOOL];
  if (nap) return { id: `nap/${nap}`, name: nap, source: 'nap' };
  const ap = labels[LABEL_AGENTPOOL];
  if (ap) return { id: `agentpool/${ap}`, name: ap, source: 'agentpool' };
  return { id: `unknown/${UNKNOWN_POOL_NAME}`, name: UNKNOWN_POOL_NAME, source: 'unknown' };
}

/** Mode label compared case-insensitively; AKS docs list both "System" and "system". */
export function nodeModeOf(node: NodeJson): PoolMode {
  const v = (node.metadata.labels?.[LABEL_MODE] ?? '').toLowerCase();
  if (v === 'system') return 'System';
  if (v === 'user') return 'User';
  return 'Unknown';
}

/** Pools sorted by name, then source. */
export function listNodePools(nodes: NodeJson[]): NodePoolInfo[] {
  const byId = new Map<string, NodePoolInfo>();
  for (const node of nodes) {
    const ref = nodePoolOf(node);
    let pool = byId.get(ref.id);
    if (!pool) {
      pool = { ...ref, mode: 'Unknown', nodeNames: [] };
      byId.set(ref.id, pool);
    }
    pool.nodeNames.push(node.metadata.name);
    const mode = nodeModeOf(node);
    if (mode === 'System' || (mode === 'User' && pool.mode === 'Unknown')) pool.mode = mode;
  }
  for (const p of byId.values()) p.nodeNames.sort();
  return [...byId.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source)
  );
}

/**
 * Default pool: the NAP NodePool named "default" if present, else the first System-mode agent pool by name,
 * else the first pool by name. Returns undefined when there are no pools.
 */
export function selectDefaultPool(pools: NodePoolInfo[]): NodePoolInfo | undefined {
  const sorted = [...pools].sort((a, b) => a.name.localeCompare(b.name));
  return (
    sorted.find(p => p.source === 'nap' && p.name === 'default') ??
    sorted.find(p => p.source === 'agentpool' && p.mode === 'System') ??
    sorted[0]
  );
}
