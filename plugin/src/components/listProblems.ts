import { LIST_RETRY_MS, ListedResource, ListFailure, ListState } from '../data/listState';

export interface ListProblem {
  /** Resource the problem is about; 'scope' for the allowed-namespaces note. */
  key: ListedResource | 'scope';
  severity: 'error' | 'warning' | 'info';
  /** What failed: kind, HTTP status and scope. */
  title: string;
  /** What that means for the numbers on the page. */
  consequence: string;
  /** What access would fix it (permission errors only). */
  fix?: string;
  /** The API server's own message, for whoever has to change the RBAC. */
  serverMessage?: string;
}

const LABEL: Record<ListedResource, string> = {
  nodes: 'Nodes',
  pods: 'Pods',
  daemonsets: 'DaemonSets',
};

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** "HTTP 403 Forbidden", or "no HTTP status" when the request did not get an answer. */
export function httpStatusText(status?: number): string {
  if (status === undefined) return 'no HTTP status';
  const text = STATUS_TEXT[status];
  return text ? `HTTP ${status} ${text}` : `HTTP ${status}`;
}

function joinList(items: string[]): string {
  return items.join(', ');
}

/** "HTTP 403 Forbidden (cluster-wide)" or "HTTP 403 Forbidden in a, b; HTTP 500 Internal Server Error in c". */
export function describeFailures(failures: ListFailure[]): string {
  const byStatus = new Map<string, Array<string | undefined>>();
  for (const f of failures) {
    const key = httpStatusText(f.status);
    if (!byStatus.has(key)) byStatus.set(key, []);
    byStatus.get(key)!.push(f.namespace);
  }
  return [...byStatus]
    .map(([status, namespaces]) => {
      const named = [...new Set(namespaces.filter((n): n is string => !!n))].sort();
      return named.length === 0 ? `${status} (cluster-wide)` : `${status} in ${joinList(named)}`;
    })
    .join('; ');
}

function failedNamespaceList(failures: ListFailure[]): string[] {
  return [...new Set(failures.map(f => f.namespace).filter((n): n is string => !!n))].sort();
}

/** RBAC hint for 401/403; undefined for other statuses, which are not permission problems. */
function permissionFix(resource: ListedResource, failures: ListFailure[]): string | undefined {
  if (failures.some(f => f.status === 401)) {
    return 'The cluster rejected your credentials. Sign in to the cluster again.';
  }
  const denied = failures.filter(f => f.status === 403);
  if (denied.length === 0) return undefined;
  if (resource === 'nodes') {
    return 'Needs list and watch on nodes. Nodes are cluster-scoped, so this takes a ClusterRole.';
  }
  const what = resource === 'pods' ? 'pods' : 'daemonsets (API group apps)';
  const ns = failedNamespaceList(denied);
  return ns.length === 0
    ? `Needs list and watch on ${what} in all namespaces (a ClusterRole).`
    : `Needs list and watch on ${what} in ${joinList(ns)}.`;
}

function consequence(resource: ListedResource, state: ListState): string {
  if (state.status === 'failed') {
    switch (resource) {
      case 'nodes':
        return 'The node view is built from the node list, so no node pools or nodes can be shown.';
      case 'pods':
        return 'Nodes are shown without their pods. Pod requests, headroom and node agent coverage are unknown, so they are not shown.';
      case 'daemonsets':
        return 'Node agent coverage is unknown, so no node agent is reported as missing. Agent pods on each node are still shown.';
    }
  }
  const ns = joinList(failedNamespaceList(state.failures));
  return resource === 'pods'
    ? `Pods in ${ns} are not shown, so pod counts and requests may be too low and headroom too high. Node agents in those namespaces are left out of coverage.`
    : `DaemonSets in ${ns} are left out, so gaps in their coverage are not reported.`;
}

const RETRY_NOTE = `Requested again every ${Math.round(
  LIST_RETRY_MS / 1000
)} seconds; the view updates when it succeeds.`;

/** Plain-language problems for the lists the view depends on, most severe first. */
export function describeListProblems(lists: Record<ListedResource, ListState>): ListProblem[] {
  const problems: ListProblem[] = [];
  for (const resource of ['nodes', 'pods', 'daemonsets'] as ListedResource[]) {
    const state = lists[resource];
    if (state.status !== 'failed' && state.status !== 'partial') continue;
    const verb = state.status === 'failed' ? 'could not be listed' : 'could only be partly listed';
    problems.push({
      key: resource,
      severity: resource === 'nodes' ? 'error' : 'warning',
      title: `${LABEL[resource]} ${verb}: ${describeFailures(state.failures)}.`,
      consequence: `${consequence(resource, state)} ${RETRY_NOTE}`,
      fix: permissionFix(resource, state.failures),
      serverMessage: [...new Set(state.failures.map(f => f.message))].join(' '),
    });
  }

  const scoped = lists.pods.status !== 'failed' ? lists.pods.scopedTo : [];
  if (scoped.length > 0) {
    const others = scoped.includes('kube-system')
      ? 'Pods in other namespaces'
      : 'Pods in other namespaces, including kube-system,';
    problems.push({
      key: 'scope',
      severity: 'info',
      title: `Only the allowed namespaces from this cluster's Headlamp settings are listed: ${joinList(
        scoped
      )}.`,
      consequence: `${others} are not counted, so pod counts and requests may be too low and headroom too high.`,
    });
  }
  return problems;
}

/** True when pod-derived numbers on the page may undercount (partial pod list or allowed namespaces). */
export function podsMayBeIncomplete(lists: Record<ListedResource, ListState>): boolean {
  return lists.pods.status === 'partial' || lists.pods.scopedTo.length > 0;
}
