/** How often a failed list is requested again, so the view recovers when access is granted. */
export const LIST_RETRY_MS = 30_000;

/** The three lists the node view is built from. */
export type ListedResource = 'nodes' | 'pods' | 'daemonsets';

/** One failed list request, from Headlamp's ApiError (status, namespace) or any thrown error. */
export interface ListFailure {
  /** HTTP status code, when the API server answered. */
  status?: number;
  /** Set when the failed request was for one namespace; undefined for a cluster-wide request. */
  namespace?: string;
  message: string;
}

/**
 * loading: no answer yet. ok: complete. partial: some namespace requests failed, items are the rest.
 * failed: no usable items; anything derived from this list is unknown.
 */
export type ListStatus = 'loading' | 'ok' | 'partial' | 'failed';

export interface ListState {
  status: ListStatus;
  failures: ListFailure[];
  /**
   * Namespaces the list was limited to by Headlamp's allowed-namespaces cluster setting.
   * Empty when the list covers all namespaces (or the resource is cluster-scoped).
   */
  scopedTo: string[];
  /** True while a failed list is being requested again; status and failures are from the last attempt. */
  retrying?: boolean;
}

export interface ListResult<T> {
  /** Null while loading or when the list failed. */
  items: T[] | null;
  state: ListState;
}

export function toListFailure(e: unknown): ListFailure {
  if (typeof e === 'string') return { message: e };
  const err = (e ?? {}) as { status?: unknown; namespace?: unknown; message?: unknown };
  return {
    status: typeof err.status === 'number' ? err.status : undefined,
    namespace: typeof err.namespace === 'string' && err.namespace ? err.namespace : undefined,
    message: typeof err.message === 'string' && err.message ? err.message : String(e),
  };
}

/**
 * Interprets one Headlamp useList result. useList returns items: [] (not null) once any request
 * has failed, so an empty list cannot be trusted on its own; this decides from the errors instead.
 *
 * @param items - useList items
 * @param errors - useList errors (ApiError has status and, for per-namespace requests, namespace)
 * @param allowedNamespaces - Headlamp's allowed namespaces for the cluster; one request per namespace
 * @param namespaced - whether the resource is namespaced (allowed namespaces do not apply otherwise)
 */
export function toListResult<T>(
  items: T[] | null | undefined,
  errors: unknown[] | null | undefined,
  allowedNamespaces: string[],
  namespaced: boolean
): ListResult<T> {
  const scopedTo = namespaced ? [...allowedNamespaces].sort() : [];
  const failures = (errors ?? []).filter(e => e !== null && e !== undefined).map(toListFailure);
  if (failures.length === 0) {
    return items
      ? { items, state: { status: 'ok', failures, scopedTo } }
      : { items: null, state: { status: 'loading', failures, scopedTo } };
  }
  const requests = scopedTo.length || 1;
  const failedNamespaces = new Set(failures.map(f => f.namespace));
  const allFailed =
    failures.some(f => f.namespace === undefined) || failedNamespaces.size >= requests;
  if (allFailed) return { items: null, state: { status: 'failed', failures, scopedTo } };
  return { items: items ?? [], state: { status: 'partial', failures, scopedTo } };
}

/**
 * Keeps the last failure visible while a failed list is retried. Without this the retry
 * (which starts as a fresh, pending query) would flip the view back to a loading state.
 */
export function mergeListUpdate<T>(prev: ListResult<T>, next: ListResult<T>): ListResult<T> {
  const prevFailed = prev.state.status === 'failed' || prev.state.status === 'partial';
  if (next.state.status === 'loading' && prevFailed) {
    return { items: prev.items, state: { ...prev.state, retrying: true } };
  }
  return next;
}

/** Namespaces in which a list request failed. Empty when the cluster-wide request failed. */
export function failedNamespaces(state: ListState): string[] {
  return [...new Set(state.failures.map(f => f.namespace).filter((n): n is string => !!n))].sort();
}
