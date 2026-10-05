/**
 * Pure presentation helpers for the node view: formatting, pod status, sort order, coverage text.
 * No Headlamp or React imports so they can be unit tested.
 */
import type { CpuMem, DaemonSetCoverage, NodePoolInfo, NodeView, PodView } from '../data';

const GIB = 2 ** 30;
const MIB = 2 ** 20;

/** Status keys accepted by Headlamp's StatusLabel. '' renders grey. */
export type UiStatus = 'success' | 'warning' | 'error' | '';

function trimNumber(n: number, decimals: number): string {
  return Number(n.toFixed(decimals)).toString();
}

/** Millicores as cores with one decimal, two below one core: 1234 -> "1.2", 250 -> "0.25". */
export function formatCores(millicores: number): string {
  const cores = millicores / 1000;
  return trimNumber(cores, Math.abs(cores) < 1 ? 2 : 1);
}

/** Bytes as GiB with one decimal, two below 1 GiB: 3.14 GiB -> "3.1". */
export function formatGiB(bytes: number): string {
  const gib = bytes / GIB;
  return trimNumber(gib, Math.abs(gib) < 1 ? 2 : 1);
}

/** Pod-level CPU request in manifest style: 250 -> "250m", 2000 -> "2". */
export function formatPodCpu(millicores: number): string {
  if (millicores <= 0) return '0';
  if (millicores % 1000 === 0) return String(millicores / 1000);
  return `${Math.round(millicores)}m`;
}

/** Pod-level memory request in manifest style: Mi below 1 GiB, else Gi with up to one decimal. */
export function formatPodMemory(bytes: number): string {
  if (bytes <= 0) return '0';
  if (bytes < GIB) return `${Math.round(bytes / MIB)}Mi`;
  return `${trimNumber(bytes / GIB, 1)}Gi`;
}

/** Short request text for a pod card or tooltip: "250m CPU, 128Mi" or "no requests". */
export function formatPodRequests(r: CpuMem): string {
  if (r.cpuMillicores <= 0 && r.memoryBytes <= 0) return 'no requests';
  return `${formatPodCpu(r.cpuMillicores)} CPU, ${formatPodMemory(r.memoryBytes)}`;
}

export type ResourceKind = 'cpu' | 'memory';

/**
 * Node header text, for example "1.2 / 3.8 cores requested, 2.6 unallocated".
 * Unallocated = allocatable minus requests. When requests exceed allocatable it says "over by".
 */
export function formatNodeResource(
  kind: ResourceKind,
  requested: CpuMem,
  allocatable: CpuMem,
  unallocated: CpuMem
): string {
  const fmt = kind === 'cpu' ? formatCores : formatGiB;
  const unit = kind === 'cpu' ? 'cores' : 'GiB';
  const pick = (c: CpuMem) => (kind === 'cpu' ? c.cpuMillicores : c.memoryBytes);
  const free = pick(unallocated);
  const tail = free < 0 ? `over by ${fmt(-free)}` : `${fmt(free)} unallocated`;
  return `${fmt(pick(requested))} / ${fmt(pick(allocatable))} ${unit} requested, ${tail}`;
}

/** Node header text when requests are unknown (pod list failed), for example "requests unknown, 3.8 cores allocatable". */
export function formatNodeResourceUnknown(kind: ResourceKind, allocatable: CpuMem): string {
  return kind === 'cpu'
    ? `requests unknown, ${formatCores(allocatable.cpuMillicores)} cores allocatable`
    : `requests unknown, ${formatGiB(allocatable.memoryBytes)} GiB allocatable`;
}

/** Requested share of allocatable, clamped to 0..100. Returns 0 when allocatable is 0. */
export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

/** The pod status fields Headlamp's pod status mapping reads. Structural, so plain JSON works. */
export interface PodStatusJson {
  metadata?: { deletionTimestamp?: string };
  status?: {
    phase?: string;
    reason?: string;
    conditions?: Array<{ type: string; status: string }>;
    containerStatuses?: ContainerStatusJson[];
    initContainerStatuses?: ContainerStatusJson[];
  };
}

interface ContainerStatusJson {
  name?: string;
  ready?: boolean;
  restartCount?: number;
  state?: {
    waiting?: { reason?: string };
    running?: unknown;
    terminated?: { reason?: string; exitCode?: number };
  };
}

export interface PodUiStatus {
  /** Same mapping as Headlamp's Pods list (getPodStatus in pod/List.tsx). */
  status: UiStatus;
  /** Short reason, for example Running, CrashLoopBackOff, Init:ImagePullBackOff, Terminating. */
  reason: string;
  restarts: number;
}

/**
 * Headlamp's pod status mapping: Failed is error; Succeeded, or Running with Ready=True, is success;
 * Running without Ready is warning (this is where CrashLoopBackOff lands); anything else is ''.
 * The reason is a simplified version of Headlamp's Pod.getDetailedStatus.
 */
export function podUiStatus(pod: PodStatusJson | undefined): PodUiStatus {
  const st = pod?.status ?? {};
  const phase = st.phase ?? 'Unknown';
  let status: UiStatus = '';
  if (phase === 'Failed') {
    status = 'error';
  } else if (phase === 'Succeeded' || phase === 'Running') {
    const ready = (st.conditions ?? []).find(c => c.type === 'Ready');
    status = ready?.status === 'True' || phase === 'Succeeded' ? 'success' : 'warning';
  }

  const containers = st.containerStatuses ?? [];
  const inits = st.initContainerStatuses ?? [];
  const restarts = [...containers, ...inits].reduce((n, c) => n + (c.restartCount ?? 0), 0);

  let reason = st.reason || phase;
  const initProblem = inits
    .map(c => c.state?.waiting?.reason ?? failedTerminationReason(c))
    .find(r => !!r && r !== 'PodInitializing');
  const containerProblem = containers
    .map(c => c.state?.waiting?.reason ?? failedTerminationReason(c))
    .find(r => !!r);
  if (initProblem) {
    reason = `Init:${initProblem}`;
  } else if (containerProblem) {
    reason = containerProblem;
  }
  if (pod?.metadata?.deletionTimestamp) {
    reason = 'Terminating';
  }
  return { status, reason, restarts };
}

function failedTerminationReason(c: ContainerStatusJson): string | undefined {
  const t = c.state?.terminated;
  if (!t || t.exitCode === 0) return undefined;
  return t.reason || `ExitCode:${t.exitCode}`;
}

/** Stable key for a pod, matching how React lists and status maps are keyed. */
export function podKey(p: { uid?: string; namespace: string; name: string }): string {
  return p.uid ?? `${p.namespace}/${p.name}`;
}

const STATUS_RANK: Record<UiStatus, number> = { error: 0, warning: 1, '': 2, success: 3 };

export interface CoverageSummary {
  /** "On every node", "On 3 of 4 eligible nodes", ... */
  text: string;
  status: UiStatus;
  /** Extra detail such as missing node names. Empty when nothing to flag. */
  detail: string;
}

/** Coverage text for one DaemonSet in the selected pool of totalNodes nodes. */
export function describeCoverage(ds: DaemonSetCoverage, totalNodes: number): CoverageSummary {
  const eligible = ds.eligibleNodes.length;
  const runningEligible = eligible - ds.missingNodes.length;
  const details: string[] = [];
  if (ds.missingNodes.length) details.push(`Missing on ${ds.missingNodes.join(', ')}`);
  if (ds.unexpectedNodes.length) {
    details.push(`Also on ${ds.unexpectedNodes.length} node(s) not evaluated as eligible`);
  }

  let text: string;
  if (ds.onEveryNode) {
    text = 'On every node';
  } else if (eligible === totalNodes) {
    text = `On ${runningEligible} of ${totalNodes} nodes`;
  } else {
    text = `On ${runningEligible} of ${eligible} eligible (${totalNodes} nodes in pool)`;
  }
  const status: UiStatus = ds.missingNodes.length ? 'warning' : 'success';
  return { text, status, detail: details.join('. ') };
}

/** DaemonSets with gaps first, then namespace, then name. */
export function sortCoverage(list: DaemonSetCoverage[]): DaemonSetCoverage[] {
  return [...list].sort(
    (a, b) =>
      Number(b.missingNodes.length > 0) - Number(a.missingNodes.length > 0) ||
      a.namespace.localeCompare(b.namespace) ||
      a.name.localeCompare(b.name)
  );
}

/** Reads the pool query parameter from a location search string. */
export function poolFromSearch(search: string): string | undefined {
  return new URLSearchParams(search).get('pool') || undefined;
}

/** Returns a search string with the pool parameter set, keeping other parameters. */
export function searchWithPool(search: string, poolId: string | undefined): string {
  const params = new URLSearchParams(search);
  if (poolId) params.set('pool', poolId);
  else params.delete('pool');
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** "1 node", "3 nodes". Pass the plural form when it is not word + "s". */
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/**
 * Pool selector label, for example "hostedpool (default) · agent pool, System, 3 nodes".
 * The default marker is left out when the pool is already named "default", so the word appears once.
 */
export function poolLabel(p: NodePoolInfo, defaultPoolId?: string): string {
  const source = p.source === 'nap' ? 'NAP' : p.source === 'agentpool' ? 'agent pool' : p.source;
  const marker = p.id === defaultPoolId && p.name !== 'default' ? ' (default)' : '';
  return `${p.name}${marker} · ${source}, ${p.mode}, ${plural(p.nodeNames.length, 'node')}`;
}

/**
 * ReplicaSet names end in the pod-template-hash. Kubernetes encodes it with an alphabet without
 * vowels (bcdfghjklmnpqrstvwxz2456789), so a suffix with a vowel is never stripped.
 */
const TEMPLATE_HASH_SUFFIX = /-[bcdfghjklmnpqrstvwxz2456789]{5,10}$/;
/** Jobs created by a CronJob end in the scheduled time in minutes. */
const CRONJOB_SUFFIX = /-\d{8,}$/;

export interface WorkloadName {
  /** Name a person recognizes: Deployment, StatefulSet, DaemonSet, Job or pod name. */
  name: string;
  /** What is left of the pod name after the workload name, for example "2ch9b" or "0". */
  instance: string;
}

/**
 * Workload name of a pod: the ReplicaSet name without its hash (the Deployment), the DaemonSet,
 * StatefulSet or Job name, the static pod name without the node suffix, or the pod name itself.
 */
export function workloadName(p: PodView): WorkloadName {
  let name = p.name;
  if (p.daemonSetName) {
    name = p.daemonSetName;
  } else if (p.ownerKind === 'ReplicaSet' && p.ownerName) {
    name = p.ownerName.replace(TEMPLATE_HASH_SUFFIX, '');
  } else if (p.ownerKind === 'Job' && p.ownerName) {
    name = p.ownerName.replace(CRONJOB_SUFFIX, '');
  } else if (p.ownerKind === 'Node') {
    const suffix = `-${p.nodeName}`;
    if (p.name.endsWith(suffix)) name = p.name.slice(0, -suffix.length);
  } else if (p.ownerName) {
    name = p.ownerName;
  }
  let instance = '';
  if (name !== p.name && p.name.startsWith(`${name}-`)) {
    instance = p.name.slice(name.length + 1);
    // Drop the ReplicaSet hash from the instance too: "754ccbf9b5-2ch9b" -> "2ch9b".
    const dash = instance.lastIndexOf('-');
    if (dash >= 0 && p.ownerKind === 'ReplicaSet') instance = instance.slice(dash + 1);
  } else if (p.ownerKind === 'Node' && name !== p.name) {
    instance = p.nodeName;
  }
  return { name, instance };
}

/** Same key for every replica of a workload, on any node. */
export function workloadKey(p: PodView): string {
  return `${p.namespace}/${workloadName(p).name}`;
}

/**
 * Identity colors for workloads. Hues stay away from Headlamp's status green, orange and red so
 * they never read as a status, and are far enough apart to tell side by side. Contrast against
 * white is at least 3:1 for a 4px rail. Six colors: a pool rarely has more multi-node workloads.
 */
export const WORKLOAD_COLORS: readonly string[] = [
  '#2f6fde', // blue
  '#0e7f8c', // teal
  '#c2418c', // magenta
  '#6a3fbf', // violet
  '#37474f', // charcoal
  '#1f8fc4', // sky
];

/**
 * FNV-1a, 32 bit, with a murmur3 finalizer so the low bits (used for the palette index) mix well.
 * Small and stable across runs and browsers.
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Deterministic identity color for a workload key. */
export function workloadColor(key: string): string {
  return WORKLOAD_COLORS[hashString(key) % WORKLOAD_COLORS.length];
}

/**
 * Identity colors for the workloads in view. Each key starts at its hashed palette slot and moves to
 * the next free slot on a collision, in key order, so colors stay stable for a given set of
 * workloads and stay distinct until the palette runs out (then colors repeat).
 */
export function assignWorkloadColors(keys: Iterable<string>): Map<string, string> {
  const n = WORKLOAD_COLORS.length;
  const used = new Set<number>();
  const result = new Map<string, string>();
  for (const key of [...new Set(keys)].sort()) {
    const start = hashString(key) % n;
    let slot = start;
    if (used.size < n) {
      while (used.has(slot)) slot = (slot + 1) % n;
    }
    used.add(slot);
    result.set(key, WORKLOAD_COLORS[slot]);
  }
  return result;
}

/** Number of nodes in the shown pool that run at least one pod of each workload (non-agent pods). */
export function workloadNodeCounts(nodes: NodeView[]): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const n of nodes) {
    for (const p of [...n.userPods, ...n.systemPods]) {
      if (p.daemonSetName) continue;
      const k = workloadKey(p);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k)!.add(n.name);
    }
  }
  return new Map([...seen].map(([k, s]) => [k, s.size]));
}

export interface NodePodGroups {
  /** DaemonSet pods. Identical across eligible nodes. */
  agents: PodView[];
  /** Pods of other workloads in user namespaces. */
  user: PodView[];
  /** Pods of other workloads in system namespaces. */
  system: PodView[];
}

/** Splits a node's pods by kind: node agents (DaemonSet pods), then user and system workloads. */
export function groupNodePods(node: NodeView): NodePodGroups {
  const all = [...node.userPods, ...node.systemPods];
  return {
    agents: all.filter(p => !!p.daemonSetName),
    user: node.userPods.filter(p => !p.daemonSetName),
    system: node.systemPods.filter(p => !p.daemonSetName),
  };
}

/** Workload row order: problems first (error, warning, other), then workload name, then pod name. */
export function sortWorkloadPods(pods: PodView[], statusOf: (p: PodView) => UiStatus): PodView[] {
  return [...pods].sort(
    (a, b) =>
      STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)] ||
      workloadName(a).name.localeCompare(workloadName(b).name) ||
      a.namespace.localeCompare(b.namespace) ||
      a.name.localeCompare(b.name)
  );
}

/** Sum of requests of the pods that count toward the node total (not Succeeded or Failed). */
export function sumRequests(pods: PodView[]): CpuMem {
  return pods
    .filter(p => p.countsTowardRequests)
    .reduce(
      (acc, p) => ({
        cpuMillicores: acc.cpuMillicores + p.requests.cpuMillicores,
        memoryBytes: acc.memoryBytes + p.requests.memoryBytes,
      }),
      { cpuMillicores: 0, memoryBytes: 0 }
    );
}

/** Group total for a section header: "0.4 cores, 0.62 GiB". */
export function formatRequestTotal(r: CpuMem): string {
  return `${formatCores(r.cpuMillicores)} cores, ${formatGiB(r.memoryBytes)} GiB`;
}

/** Compact pod requests for a row: "100m · 70Mi", "none". */
export function formatPodRequestsShort(r: CpuMem): string {
  if (r.cpuMillicores <= 0 && r.memoryBytes <= 0) return 'none';
  return `${formatPodCpu(r.cpuMillicores)} · ${formatPodMemory(r.memoryBytes)}`;
}

/**
 * One row in a node's agent list. Every node lists the same DaemonSets in the same order, so an
 * agent sits in the same position in every column: a pod, a gap (eligible, no pod) or not eligible.
 */
export type AgentRow =
  | { kind: 'pod'; dsName: string; namespace: string; pod: PodView }
  | { kind: 'missing'; dsName: string; namespace: string }
  | { kind: 'ineligible'; dsName: string; namespace: string };

/** Agent rows for one node, ordered by DaemonSet name then namespace. */
export function nodeAgentRows(
  nodeName: string,
  agents: PodView[],
  daemonSets: DaemonSetCoverage[]
): AgentRow[] {
  const rows: AgentRow[] = [];
  const covered = new Set<string>();
  for (const ds of daemonSets) {
    const id = `${ds.namespace}/${ds.name}`;
    covered.add(id);
    const pods = agents.filter(p => p.namespace === ds.namespace && p.daemonSetName === ds.name);
    if (pods.length) {
      pods.forEach(p =>
        rows.push({ kind: 'pod', dsName: ds.name, namespace: ds.namespace, pod: p })
      );
    } else if (ds.missingNodes.includes(nodeName)) {
      rows.push({ kind: 'missing', dsName: ds.name, namespace: ds.namespace });
    } else {
      rows.push({ kind: 'ineligible', dsName: ds.name, namespace: ds.namespace });
    }
  }
  // Agent pods whose DaemonSet is not in the coverage list (for example not visible to this user).
  for (const p of agents) {
    if (!covered.has(`${p.namespace}/${p.daemonSetName}`)) {
      rows.push({ kind: 'pod', dsName: p.daemonSetName ?? p.name, namespace: p.namespace, pod: p });
    }
  }
  return rows.sort(
    (a, b) =>
      a.dsName.localeCompare(b.dsName) ||
      a.namespace.localeCompare(b.namespace) ||
      (a.kind === 'pod' && b.kind === 'pod' ? a.pod.name.localeCompare(b.pod.name) : 0)
  );
}

/** True for rows that need attention: a gap, or an agent pod that is not ready. */
export function isAgentProblem(row: AgentRow, statusOf: (p: PodView) => UiStatus): boolean {
  if (row.kind === 'missing') return true;
  if (row.kind === 'ineligible') return false;
  return statusOf(row.pod) !== 'success';
}

export interface AgentSummary {
  /** Agent pods on the node, shown as the group count. */
  count: number;
  /** "all running", "1 not ready, 1 missing", "none". */
  text: string;
  status: UiStatus;
}

/** Status of the agents on a node, for the group header "Node agents (11) all running". */
export function summarizeNodeAgents(
  rows: AgentRow[],
  statusOf: (p: PodView) => UiStatus
): AgentSummary {
  const pods = rows.filter((r): r is Extract<AgentRow, { kind: 'pod' }> => r.kind === 'pod');
  const count = pods.length;
  const missing = rows.filter(r => r.kind === 'missing').length;
  const notReady = pods.filter(r => statusOf(r.pod) !== 'success').length;
  if (count === 0 && missing === 0) return { count, text: 'none', status: '' };
  if (!missing && !notReady) {
    return { count, text: count === 1 ? 'running' : 'all running', status: 'success' };
  }
  const parts: string[] = [];
  if (notReady) parts.push(`${notReady} not ready`);
  if (missing) parts.push(`${missing} missing`);
  return { count, text: parts.join(', '), status: 'warning' };
}

export interface PoolAgentSummary {
  /** For example "11 node agents on every node. 33 of 33 agent pods ready." */
  text: string;
  status: UiStatus;
  /** DaemonSets with a gap (eligible node without a pod), with their coverage text. */
  gaps: Array<{ ds: DaemonSetCoverage; text: string }>;
  /** DaemonSets that only target some nodes by design (selector, affinity or taints). */
  partial: Array<{ ds: DaemonSetCoverage; text: string }>;
}

/**
 * Pool-level agent line. All counts are scoped to the nodes in the selected pool,
 * never to cluster-wide DaemonSet status.
 */
export function summarizePoolAgents(
  daemonSets: DaemonSetCoverage[],
  nodes: NodeView[],
  statusOf: (p: PodView) => UiStatus
): PoolAgentSummary {
  const agentPods = nodes.flatMap(n => groupNodePods(n).agents);
  const ready = agentPods.filter(p => statusOf(p) === 'success').length;
  const gaps = sortCoverage(daemonSets.filter(d => d.missingNodes.length > 0)).map(ds => ({
    ds,
    text: describeCoverage(ds, nodes.length).detail,
  }));
  const partial = daemonSets
    .filter(d => d.missingNodes.length === 0 && !d.onEveryNode)
    .map(ds => ({ ds, text: describeCoverage(ds, nodes.length).text }));
  const everywhere = daemonSets.length - gaps.length - partial.length;
  if (daemonSets.length === 0) {
    return { text: 'No node agents (DaemonSets) target this pool.', status: '', gaps, partial };
  }
  const where =
    everywhere === daemonSets.length
      ? `${plural(daemonSets.length, 'node agent')} on every node.`
      : `${plural(daemonSets.length, 'node agent')}, ${everywhere} on every node.`;
  const readyText = `${ready} of ${plural(agentPods.length, 'agent pod')} ready.`;
  const status: UiStatus = gaps.length || ready < agentPods.length ? 'warning' : 'success';
  return { text: `${where} ${readyText}`, status, gaps, partial };
}

/** The namespace shared by all pods, or undefined when they span more than one. */
export function commonNamespace(pods: PodView[]): string | undefined {
  const set = new Set(pods.map(p => p.namespace));
  return set.size === 1 ? [...set][0] : undefined;
}
